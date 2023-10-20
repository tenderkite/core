import EventEmitter from "node:events";
import { ComponentDefine } from "../composables/defineComponent";
import { ServiceDefine } from "../composables/defineService";
import { useWorker, useWorkers } from "../composables/useWorkers";

import { Service } from "./Service";
import { Router, TypeRouter } from "./Router";
import { EventHandler, KiteEvent, Request, Response } from "./Event";
import { Component } from "./Component";
import { MiddlewareDefine, MiddlewareHandler, composeMiddlewares } from "../composables/defineMiddleware";
import { Middleware } from "./Middlware";
import { CreateInfo, ServiceCreateInfo } from "./CreateInfo";
import { Module } from "./Module";
import { splitCreate, splitServiceCreate } from "../utils/splitCreate";
import { getNestedValue } from "../utils/getNestedValue"
import { toTypeRouter } from "../utils/toTypeRouter";
import { isMainThread } from "node:worker_threads";
import { hashRouter } from "../utils/hashRouter";

export type BootDefine = {
    services: Array<Router | [Router, any]>;
    middlewares: Array<CreateInfo>;
}

export type BootCallback = () => BootDefine

export class Kite extends EventEmitter {

    reses: Record<string, any> = {};

    services: Record<string, Record<string | number, Service>> = {};
    cachingServices: Record<string, Record<string | number, Service>> = {};

    middlewares: Array<MiddlewareHandler> = [];
    composedMiddleware!: MiddlewareHandler

    //module的定制：最好配置是从一个大的config来
    modules: Array<Module> = [];

    serviceDefines: Record<string, ServiceDefine> = {};
    componentDefines: Record<string, ComponentDefine> = {};
    middlewareDefines: Record<string, MiddlewareDefine> = {};

    globalEvents: Record<string, Set<Service>> = {};

    workerIndex: number = 0;
    workerCount: number = 0;

    session = 0;
    sessions: Record<number, { resolve: Function, reject: Function }> = {}

    sendWorker!: (index: number, message: any) => void;

    [key: string]: any;

    constructor() { super() }

    async regist(name: string) {

        const module = new Module(this)
        await module.load(name)
        this.modules.push(module)
    }

    collect(module: Module) {

        for (const child of module.modules) {
            this.collect(child)
        }

        this.serviceDefines = { ...this.serviceDefines, ...module.services }
        this.componentDefines = { ...this.componentDefines, ...module.components }
        this.middlewareDefines = { ...this.middlewareDefines, ...module.middlewares }
    }

    resource(dir: string, callback: () => any) {

    }

    async start(workerCount?: number) {

        for (const module of this.modules) {
            this.collect(module)
        }

        if (isMainThread) {
            const { index, send, threads } = useWorkers(this.onWorkerMessage.bind(this), workerCount)

            this.sendWorker = send
            this.workerIndex = index
            this.workerCount = threads
        }
        else {
            const { index, send, threads } = useWorker(this.onWorkerMessage.bind(this))
            this.sendWorker = send
            this.workerIndex = index
            this.workerCount = threads
        }

        const listeners = this.listeners("boot") as Array<BootCallback>

        const serviceCreates: Array<ServiceCreateInfo> = []

        for (const callback of listeners) {
            const boot = callback()
            if (boot == null) {
                continue
            }

            //create middleware
            for (const createInfo of boot.middlewares ?? []) {
                const { name, options } = splitCreate(createInfo)
                const middlewareDefine = this.middlewareDefines[name]
                if (middlewareDefine == null) {
                    throw new Error(`no such middleware:` + name)
                }

                const middleware = new Middleware()

                middleware.name = name

                const event = new KiteEvent()

                event.request.path = `middlewares/${name}`
                event.request.method = "setup"
                event.request.body = options
                event.middleware = middleware

                const handler = await middlewareDefine.setup.call(middleware, event)

                this.middlewares.push(handler.bind(middleware))
            }

            //0号线程派发，这样可以解决那些有前后依赖关系的问题
            //但是：与此同时也会有串行效率低的问题，不过就交给使用方自己搞定了
            if (this.workerIndex == 0) {
                serviceCreates.push(...boot.services)
            }
        }

        //合并成一个
        this.middlewares.push(this.serviceMiddlewares.bind(this))

        this.composedMiddleware = composeMiddlewares(this.middlewares)

        for (const one of serviceCreates) {
            const { router, options } = splitServiceCreate(one)
            await this.createService(router, options)
        }
    }

    async stop() {

        if (this.workerIndex != 0) {
            return
        }

        for (let index = 0; index < this.workerCount; ++index) {
            await this.callWorker(index, "onStop")
        }
    }

    private async onStop() {
        for (const name in this.services) {
            const services = this.services[name]
            for (const name in services) {
                const service = services[name]

                this.unsetup(service!)
            }
        }
    }

    async createService(router: Router, options: any) {

        const tpRouter = toTypeRouter(router)

        let serviceDefine = this.serviceDefines[tpRouter.type]
        if (serviceDefine == null) {
            throw new Error("now such service:" + tpRouter.type)
        }

        const hash = hashRouter(tpRouter)
        const index = hash % this.workerCount

        return await this.callWorker(index, "onCreateService", router, options)
    }

    private async onCreateService(router: TypeRouter, options: any) {

        let serviceDefine = this.serviceDefines[router.type]
        if (serviceDefine == null) {
            throw new Error("now such service:" + router.type)
        }

        const service = new Service()

        service.router = router
        service.define = serviceDefine

        await this.setup(service, options)

        let tpService = this.services[service.router.type]
        if (tpService == null) {
            this.services[service.router.type] = tpService = {}
        }

        tpService[service.router.id] = service
    }

    async destroyService(router: Router) {

        const tpRouter = toTypeRouter(router)
        let tpService = this.services[tpRouter.type]
        if (tpService == null) {
            return
        }

        const service = tpService[tpRouter.id]
        if (service == null) {
            return
        }

        delete tpService[tpRouter.id]

        //Todo

    }

    async setup(service: Service, options: any) {

        let serviceDefine = service.define

        Object.assign(service, serviceDefine.methods)

        const event: KiteEvent = new KiteEvent()

        event.service = service

        event.request.path = `services/${service.router.type}/setup`
        event.request.method = "call"
        event.request.body = options

        let runtime = await serviceDefine.setup?.call(service, event)

        if (runtime == null) {
            runtime = { //Todo sort by name
                props: {},
                components: Object.keys(serviceDefine.components!),
                middlewares: Object.keys(serviceDefine.middlewares!),
            }
        }

        Object.assign(service.props, runtime.props)

        //create components
        for (const createInfo of runtime.components ?? []) {
            const { name, options } = splitCreate(createInfo)
            const componentDefine = this.searchComponent(serviceDefine, name)
            if (componentDefine == null) {
                throw new Error(`no such component:` + name)
            }

            const component = new Component(service)

            component.define = componentDefine

            Object.assign(component, componentDefine.methods)

            const clone = { ...event, request: { body: options }, component } as KiteEvent

            const runtime = await componentDefine.setup?.call(component, clone)
            if (runtime) {
                Object.assign(component.props, runtime.props)
            }

            service.components[name] = component
        }

        //create middleware
        for (const createInfo of runtime.middlewares ?? []) {
            const { name, options } = splitCreate(createInfo)
            const middlewareDefine = this.searchMiddleware(serviceDefine, name)
            if (middlewareDefine == null) {
                throw new Error(`no such middleware:` + name)
            }

            const middleware = new Middleware()

            middleware.name = `${service.router.type}/middlewares/${name}/setup`

            const clone = {
                ...event,
                service,
                request: {
                    method: "call",
                    path: `${service.router.type}/middlewares/${name}/setup`,
                    body: options
                }
            } as KiteEvent

            const handler = await middlewareDefine.setup.call(middleware, clone)

            service.middlewares.push(handler.bind(middleware))
        }

        service.composedMiddleware = composeMiddlewares(service.middlewares)

        this.attachTimers(service)
        this.attachEvents(service)
    }

    async unsetup(service: Service) {

        let serviceDefine = service.define

        // clear component timer
        let globalEvents = []
        for (let name in service.components) {
            const component = service.components[name]!
            const componentDefine = component.define

            for (const name in componentDefine.timers) {
                const timer = componentDefine.timers[name]!
                const exists = component.timers[name]

                if (!exists) {
                    continue
                }

                if (timer.delay) {
                    //@ts-ignore
                    clearTimeout(exists)
                }
                else {
                    //@ts-ignore
                    clearInterval(exists)
                }

                delete component.timers[name]
            }

            for (const name in componentDefine.events) {

                let eventName = name
                if (name.startsWith("~"))    //root event
                {
                    eventName = name.substring(1)
                    globalEvents.push(eventName)
                }

                const exists = component.events[name]

                component.off(eventName, exists)

                delete component.events[name]
            }
        }

        for (let name in serviceDefine.timers) {

            const timer = serviceDefine.timers[name]!
            const exists = service.timers[name]

            if (!exists) {
                continue
            }

            delete service.timers[name]

            if (timer.delay) {
                //@ts-ignore
                clearTimeout(exists)
            }
            else {
                //@ts-ignore
                clearInterval(exists)
            }
        }

        for (const name in service.events) {

            let eventName = name
            if (name.startsWith("~"))    //root event
            {
                eventName = name.substring(1)
                globalEvents.push(eventName)
            }

            const exists = service.events[name]
            // @ts-ignore
            service.off(eventName, exists)

            delete service.events[name]
        }

        for (const name of globalEvents) {
            const sets = this.globalEvents[name]
            if (sets == null) {
                continue
            }
            sets.delete(service)
        }
    }

    attachTimers(service: Service) {

        //regist timers
        for (let name in service.components) {
            const componentDefine = this.searchComponent(service.define, name)!
            const component = service.components[name]!

            for (const name in componentDefine.timers) {

                const timer = componentDefine.timers[name]!
                const exists = component.timers[name]

                if (exists || exists === false) {       //已经存在或者已经执行完了
                    continue
                }

                const { delay, interval } = timer

                const timerEvent = new KiteEvent()

                timerEvent.service = service
                timerEvent.component = component
                timerEvent.request.path = `services/${service.router.type}/components/${name}/timers/${name}`
                timerEvent.request.method = "notify"

                if (delay) {
                    component.timers[name] = setTimeout(async () => {
                        const handler = componentDefine.timers?.[name]
                        component.timers[name] = false
                        await handler?.setup.call(component, timerEvent)
                    }, delay)
                }
                else if (interval) {
                    component.timers[name] = setInterval(async () => {
                        const handler = componentDefine.timers?.[name]
                        await handler?.setup.call(component, timerEvent)
                    })
                }
            }
        }

        for (let name in service.define.timers) {

            const timer = service.define.timers[name]!
            const exists = service.timers[name]

            if (exists || exists === false) {       //已经存在或者已经执行完了
                continue
            }

            const { delay, interval } = timer
            const timerEvent = new KiteEvent()

            timerEvent.service = service
            timerEvent.request.path = `services/${service.router.type}/timers/${name}`
            timerEvent.request.method = "notify"

            if (delay) {
                service.timers[name] = setTimeout(async () => {
                    const handler = service.define.timers?.[name]
                    service.timers[name] = false
                    await handler?.setup.call(service, timerEvent)
                }, delay)
            }
            else if (interval) {
                service.timers[name] = setInterval(async () => {
                    const handler = service.define.timers?.[name]
                    await handler?.setup.call(service, timerEvent)
                }, interval)
            }
        }
    }

    attachEvents(service: Service) {
        //regist timers
        const globalEvents = []

        for (let name in service.components) {
            const componentDefine = this.searchComponent(service.define, name)!
            const component = service.components[name]!

            for (const name in componentDefine.events) {

                let eventName = name
                const handler = componentDefine.events[name]!

                let rootEvent = false
                if (name.startsWith("~"))    //root event
                {
                    rootEvent = true
                    eventName = name.substring(1)

                    globalEvents.push(eventName)
                }

                const exists = component.events[name]
                if (exists) {
                    component.off(eventName, exists)
                }

                component.on(eventName, handler)
                component.events[eventName] = handler
            }
        }

        for (let name in service.define.events) {

            let eventName = name
            const handler = service.define.events[name]!

            if (name.startsWith("~"))    //root event
            {
                eventName = name.substring(1)
                globalEvents.push(eventName)
            }

            const exists = service.events[name]
            if (exists) {
                //@ts-ignore
                service.off(eventName, exists)
            }

            service.on(eventName, handler)
            service.events[eventName] = handler
        }

        if (globalEvents.length == 0) {
            return
        }

        for (let name of globalEvents) {
            let sets = this.globalEvents[name]
            if (sets == null) {
                this.globalEvents[name] = sets = new Set<Service>()
            }
            sets.add(service)
        }
    }

    getService(router: Router) {
        //@ts-ignore
        const type = router.type || router
        //@ts-ignore
        const id = router.id || ""

        const tpService = this.services[type]
        if (tpService == null) {
            return
        }
        return tpService[id]
    }

    searchService(name: string) {
        let serviceDefine = this.serviceDefines[name]
        if (serviceDefine == null) {
            throw new Error("now such service:" + name)
        }

        return serviceDefine
    }

    searchComponent(serviceDefine: ServiceDefine, name: string) {
        let exists = serviceDefine.components?.[name]
        if (exists) {
            return exists
        }
        return this.componentDefines[name]
    }

    searchMiddleware(serviceDefine: ServiceDefine, name: string) {
        let exists = serviceDefine.middlewares?.[name]
        if (exists) {
            return exists
        }
        return this.middlewareDefines[name]
    }

    /**
     * 发送请求
     * @param router 
     * @param request 
     * @returns 
     */
    async fetch(router: TypeRouter, request: Partial<Request>): Promise<Response> {

        const service = this.getService(router)
        if (service == null) {
            throw new Error("no such service:" + router.type)
        }

        const hash = hashRouter(router)
        const index = hash % this.workerCount

        try {

            const response = await this.callWorker(index, "onFetch", router, request)

            return response as Response
        }
        catch (e) {
            const response = new Response()

            response.status = 502
            response.statusMessage = String(e)

            return response
        }

    }

    async onFetch(router: TypeRouter, request: Partial<Request>) {
        const service = this.getService(router)
        if (service == null) {
            throw new Error("no such service:" + router.type)
        }

        const event = new KiteEvent()

        event.target = router
        event.service = service

        Object.assign(event.request, request)

        async function throwNoHandler() {

            event.response.status = 404
            event.response.statusMessage = "no such handler:" + request.path
        }

        await this.composedMiddleware(event, throwNoHandler)

        return event.response
    }

    /**
     * emit all
     * @param name 
     * @param option 
     */
    globalEmit(eventName: string, ...args: any[]) {

        for (const name in this.globalEvents) {
            const sets = this.globalEvents[name]
            for (const service of sets!) {
                service.emit(eventName, ...args)
            }
        }
    }


    /**
     * 调用service自己的middleware
     * @param event 
     * @param next 
     * @returns 
     */
    private async serviceMiddlewares(event: KiteEvent, next: () => Promise<void>) {

        const { service } = event
        let { path } = event.request

        if (service == null) {
            return next()
        }

        await service.composedMiddleware(event, async () => {
            /**
             * 例子： 
             * serviceType/remotes/test,
             * serviceType/handlers/test
             */
            const index = path.indexOf("/")
            const realPath = path.substring(index + 1)
            const handler = getNestedValue(service.define, realPath, undefined, "/")

            //check method
            if (!handler) {
                return next()
            }
            return await (handler as EventHandler).call(service, event)
        })
    }

    private notifyWorker(index: number, name: string, ...args: any[]) {
        this.sendWorker(index, { name, args })
    }

    private async callWorker(index: number, name: string, ...args: any[]) {

        const session = ++this.session

        return new Promise((resolve, reject) => {
            this.sendWorker(index, { session, name, args })
            this.sessions[session] = { resolve, reject }
        })
    }

    private async onWorkerMessage(index: number, message: { name: string, args: any[], session?: number }) {

        const { session, name, args } = message

        try {
            const result = await this[name](...args)
            if (session) {
                this.notifyWorker(index, "onResp", session, result)
            }
        }
        catch (e) {
            if (session) {
                this.notifyWorker(index, "onError", session, e)
            }
        }
    }

    private async onResp(id: number, result: any, error: any) {

        const session = this.sessions[id]
        if (session == null) {
            return
        }

        delete this.sessions[id]

        session.resolve(result)
    }

    private async onError(id: number, error: any) {
        const session = this.sessions[id]
        if (session == null) {
            return
        }

        delete this.sessions[id]
        session.reject(error)
    }
}