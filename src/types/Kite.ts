import EventEmitter from "node:events";
import { isMainThread } from "node:worker_threads";

import { ComponentDefine } from "../composables/defineComponent";
import { ServiceDefine } from "../composables/defineService";
import { useWorker, useWorkers } from "../composables/useWorkers";
import { MiddlewareDefine, MiddlewareHandler, composeMiddlewares } from "../composables/defineMiddleware";

import { Service } from "./Service";
import { Router, TypeRouter } from "./Router";
import { EventHandler, KiteEvent, Request, Response } from "./Event";
import { Component } from "./Component";
import { Middleware } from "./Middlware";
import { CreateInfo } from "./CreateInfo";
import { Module } from "./Module";

import { splitCreate, splitServiceCreate } from "../utils/splitCreate";
import { getNestedValue } from "../utils/getNestedValue"
import { toTypeRouter } from "../utils/toTypeRouter";
import { hashRouter } from "../utils/hashRouter";
import { buildDependency } from "../utils/buildDependency";

export type BootDefine = {
    services: Array<Router | [Router, any]>;
    middlewares: Array<CreateInfo>;
}

export type BootCallback = () => BootDefine

export class Kite extends EventEmitter {

    reses: Record<string, any> = {};

    services: Record<string, Record<string | number, Service>> = {};
    keepAlives: Record<string, Record<string | number, Service>> = {};

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
            const { index, send, threads } = useWorkers({
                onMessage: this.onWorkerMessage.bind(this),
                onExit: this.onWorkerExit.bind(this),
                threads: workerCount!,
            })

            this.sendWorker = send
            this.workerIndex = index
            this.workerCount = threads
        }
        else {
            const { index, send, threads } = useWorker({
                onMessage: this.onWorkerMessage.bind(this),
            })

            this.sendWorker = send
            this.workerIndex = index
            this.workerCount = threads
        }

        const listeners = this.listeners("boot") as Array<BootCallback>
        const serviceCreates: Record<string, Array<[TypeRouter, any]>> = {}

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

            //排序，为构建依赖做准备
            if (this.workerIndex == 0) {

                for (const createInfo of boot.services) {

                    const { router, options } = splitServiceCreate(createInfo)

                    let exists = serviceCreates[router.type]
                    if (exists == null) {
                        exists = serviceCreates[router.type] = []
                    }

                    exists.push([router, options])
                }
            }
        }

        //合并成一个
        this.middlewares.push(this.serviceMiddlewares.bind(this))

        this.composedMiddleware = composeMiddlewares(this.middlewares)

        const dependenciesConfig: Record<string, string[]> = {}

        for (const name in serviceCreates) {

            const define = this.getServiceDefine(name)
            if (define.depends == null) {
                dependenciesConfig[name] = []
            }
            else if (typeof define.depends == "string") {
                dependenciesConfig[name] = [define.depends]
            }
            else {
                dependenciesConfig[name] = [...define.depends]
            }
        }

        const dependencies = buildDependency(dependenciesConfig)

        const promises = []

        //[ [ 'b', 'd', 'a', 'e' ], [ 'f', 'c' ] ]
        for (const one of dependencies) {   //不同位置元素之间没有关系
            promises.push(new Promise<void>(async (resolve) => {
                // 元素数组中，后面的依赖前面的
                for (const name of one) {
                    const creates = serviceCreates[name]
                    for (const create of creates!) {
                        await this.createService(create[0], create[1])
                    }
                }
                resolve()
            }))
        }

        await Promise.all(promises)
    }

    async stop() {

        if (this.workerIndex != 0) {
            this.notifyWorker(0, "manageStop")
            return
        }

        await this.manageStop()
    }

    private async manageStop() {

        //收集已有类型
        const names = new Set<string>

        for (let index = 0; index < this.workerCount; ++index) {
            const ones = await this.callWorker(index, "collectNames") as unknown as Array<string>
            ones.forEach((name) => {
                names.add(name)
            })
        }

        const dependenciesConfig: Record<string, string[]> = {}

        // 建立索引
        for (const name of names) {

            const define = this.getServiceDefine(name)
            if (define.depends == null) {
                dependenciesConfig[name] = []
            }
            else if (typeof define.depends == "string") {
                dependenciesConfig[name] = [define.depends]
            }
            else {
                dependenciesConfig[name] = [...define.depends]
            }
        }

        const dependencies = buildDependency(dependenciesConfig)

        for (const one of dependencies) {
            for (let index = 0; index < this.workerCount; ++index) {
                await this.callWorker(index, "realStopManyServices", one, true)
            }
        }

        //查漏补缺
        for (let index = 0; index < this.workerCount; ++index) {
            await this.callWorker(index, "realStop")
        }

        await this.realStop()

        setTimeout(process.exit, 1000, 0)
    }

    private async realStop() {

        if (this.debug) {
            console.log(this.workerIndex, "realStop")
        }

        for (const name in this.keepAlives) {
            const services = this.keepAlives[name]
            for (const id in services) {
                const service = services[id]
                await this.destroyService(service!)
            }
        }

        this.keepAlives = {}

        for (const name in this.services) {
            const services = this.services[name]
            for (const name in services) {
                const service = services[name]
                await this.realStopService(service!.router, true)
            }
        }
    }

    private async collectNames() {
        const result = []
        for (const name in this.services) {
            result.push(name)
        }
        return result
    }

    async createService(router: Router, options: any) {

        const tpRouter = toTypeRouter(router)

        let serviceDefine = this.serviceDefines[tpRouter.type]
        if (serviceDefine == null) {
            throw new Error("now such service:" + tpRouter.type)
        }

        const hash = hashRouter(tpRouter)
        const index = hash % this.workerCount

        return await this.callWorker(index, "realCreateService", tpRouter, options)
    }

    async stopService(router: Router) {
        const tpRouter = toTypeRouter(router)

        let serviceDefine = this.serviceDefines[tpRouter.type]
        if (serviceDefine == null) {
            throw new Error("now such service:" + tpRouter.type)
        }

        const hash = hashRouter(tpRouter)
        const index = hash % this.workerCount

        return await this.callWorker(index, "realStopService", tpRouter)
    }

    private async realCreateService(router: TypeRouter, options: any) {

        let serviceDefine = this.serviceDefines[router.type]
        if (serviceDefine == null) {
            throw new Error("now such service:" + router.type)
        }

        let service

        if (serviceDefine.keepAlive) {
            const tpService = this.keepAlives[router.type]
            if (tpService) {
                service = tpService[router.id]
                delete tpService[router.id]
            }

            if (service?.keepAlive) {
                clearTimeout(service?.keepAlive)
            }
        }

        if (service == null) {
            service = new Service()

            service.router = router
            service.define = serviceDefine

            await this.setupService(service, options)
        }

        await this.onStartService(service)

        let tpService = this.services[service.router.type]
        if (tpService == null) {
            this.services[service.router.type] = tpService = {}
        }

        tpService[service.router.id] = service

        if (this.debug) {
            console.log(this.workerIndex, "create service", service.router.type, service.router.id)
        }
    }

    private async realStopService(router: TypeRouter, forceDestroy = false) {

        let tpService = this.services[router.type]
        if (tpService == null) {
            return
        }

        const service = tpService[router.id]
        if (service == null) {
            return
        }

        delete tpService[router.id]

        await this.onStopService(service)

        if (service.define.keepAlive && !forceDestroy) {
            this.keepAliveService(service);
        }
        else {
            await this.destroyService(service)
        }
    }

    /**
     * 按照类型关闭services
     * 数组中，后面的依赖前面的，所以按照逆序关闭
     * 
     * @param names 
     * @param forceDestroy 
     * @returns 
     */
    private async realStopManyServices(names: Array<string>, forceDestroy = false) {

        for (let i = names.length - 1; i >= 0; i--) {
            const name = names[i]
            let tpService = this.services[name!]
            if (tpService == null) {
                continue
            }

            for (let id in tpService) {
                const service = tpService[id]
                await this.realStopService(service!.router, forceDestroy)
            }
        }
    }

    async destroyService(service: Service) {

        if (this.debug) {
            console.log(this.workerIndex, "start destroy service", service.router.type, service.router.id)
        }

        if (service.keepAlive) {
            clearTimeout(service.keepAlive)
            service.keepAlive = null
        }

        for (const name in service.components) {
            const component = service.components[name]

            const event = new KiteEvent()

            event.service = service
            event.component = component!
            event.request.path = `services/${service.router.type}/components/${name}/onDestroy`

            await component?.define.hooks?.onDestroy?.call(component, event)
        }

        {
            const event = new KiteEvent()

            event.service = service
            event.request.path = `services/${service.router.type}/onDestroy`

            await service.define.hooks?.onDestroy?.call(service, event)
        }

        if (this.debug) {
            console.log(this.workerIndex, "destroy service done", service.router.type, service.router.id)
        }
    }

    async setupService(service: Service, options: any) {

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
            const componentDefine = this.getComponentDefine(serviceDefine, name)
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
            const middlewareDefine = this.getMiddlewareDefine(serviceDefine, name)
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
    }

    private keepAliveService(service: Service) {
        let tpService = this.keepAlives[service.router.type];
        if (tpService == null) {
            this.keepAlives[service.router.type] = tpService = {};
        }

        tpService[service.router.id] = service;
        service.keepAlive = setTimeout(async () => {

            delete service.keepAlive;
            delete tpService?.[service.router.id];

            await this.destroyService(service);

        }, service.define.keepAlive! * 1000);
    }

    async onStartService(service: Service) {

        for (const name in service.components) {
            const component = service.components[name]

            const event = new KiteEvent()

            event.service = service
            event.component = component!
            event.request.path = `services/${service.router.type}/components/${name}/onStart`

            await component?.define.hooks?.onStart?.call(component, event)
        }

        {
            const event = new KiteEvent()

            event.service = service
            event.request.path = `services/${service.router.type}/onStart`

            await service.define.hooks?.onStart?.call(service, event)
        }

        this.attachEvents(service)
        this.attachTimers(service)
    }

    async onStopService(service: Service) {

        for (const name in service.components) {
            const component = service.components[name]

            const event = new KiteEvent()

            event.service = service
            event.component = component!
            event.request.path = `services/${service.router.type}/components/${name}/onStop`

            await component?.define.hooks?.onStop?.call(component, event)
        }

        {
            const event = new KiteEvent()

            event.service = service
            event.request.path = `services/${service.router.type}/onStop`

            await service.define.hooks?.onStop?.call(service, event)
        }

        this.unattachTimers(service)
        this.unattachEvents(service)
    }
    attachTimers(service: Service) {

        for (let name in service.components) {
            const componentDefine = this.getComponentDefine(service.define, name)!
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

    unattachTimers(service: Service) {
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
        }

        for (let name in service.define.timers) {

            const timer = service.define.timers[name]!
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
    }

    attachEvents(service: Service) {
        //regist timers
        const globalEvents = []

        for (let name in service.components) {
            const componentDefine = this.getComponentDefine(service.define, name)!
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

    unattachEvents(service: Service) {
        let globalEvents = []
        for (let name in service.components) {
            const component = service.components[name]!
            const componentDefine = component.define

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

    getServiceDefine(name: string) {
        let serviceDefine = this.serviceDefines[name]
        if (serviceDefine == null) {
            throw new Error("now such service:" + name)
        }

        return serviceDefine
    }

    getComponentDefine(serviceDefine: ServiceDefine, name: string) {
        let exists = serviceDefine.components?.[name]
        if (exists) {
            return exists
        }
        return this.componentDefines[name]
    }

    getMiddlewareDefine(serviceDefine: ServiceDefine, name: string) {
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

        const define = this.getServiceDefine(router.type)
        if (define == null) {
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

    private async onFetch(router: TypeRouter, request: Partial<Request>) {
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

        if (this.debug) {
            console.log(this.workerIndex, "onWorkerMessage from", index, name)
        }

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

    private async onWorkerExit(index: number) {
        console.log("worker exit", index)
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