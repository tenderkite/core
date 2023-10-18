import EventEmitter from "node:events";
import { ComponentDefine, ServiceDefine } from "../composables";
import { Service } from "./Service";
import { Router, TypeRouter } from "./Router";
import { EventHandler, KiteEvent, Request } from "./Event";
import { Component } from "./Component";
import { MiddlewareDefine, MiddlewareHandler, composeMiddlewares } from "../composables/defineMiddleware";
import { Middleware } from "./Middlware";
import { CreateInfo } from "./CreateInfo";
import { Module } from "./Module";
import { splitCreate, splitServiceCreate } from "../utils/splitCreate";
import { getNestedValue } from "../utils/getNestedValue"
import { toTypeRouter } from "../utils/toTypeRouter";

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

    async start() {

        for (const module of this.modules) {
            this.collect(module)
        }

        const listeners = this.listeners("boot") as Array<BootCallback>

        for (const callback of listeners) {
            const boot = callback()
            if (boot == null) {
                continue
            }
            for (const one of boot.services) {

                let { router, options } = splitServiceCreate(one)

                await this.create(router, options)
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

                event.request.path = "@middleware"
                event.request.body = options
                event.middleware = middleware

                const { handler } = await middlewareDefine.setup.call(middleware, event)

                this.middlewares.push(handler)
            }

            this.middlewares.push(this.requestMiddleware.bind(this))
        }

        //合并成一个
        this.composedMiddleware = composeMiddlewares(this.middlewares)
    }

    async stop() {
    }

    async create(router: Router, options: any) {

        const tpRouter = toTypeRouter(router)

        let serviceDefine = this.serviceDefines[tpRouter.type]
        if (serviceDefine == null) {
            throw new Error("now such service:" + tpRouter.type)
        }

        const service = new Service()

        service.router = tpRouter
        service.define = serviceDefine

        await this.setup(service, options)

        let tpService = this.services[service.router.type]
        if (tpService == null) {
            this.services[service.router.type] = tpService = {}
        }

        tpService[service.router.id] = service

        return service
    }

    async destroy(router: Router) {

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

        this.unsetup(service)

        if (service.define.cache?.period) {
            //Todo
        }

    }

    async setup(service: Service, options: any) {

        let serviceDefine = service.define

        const blacks = ["components", "middlewares", "handlers", "setup", "timers"]

        for (const name in serviceDefine) {
            if (blacks.includes(name)) {
                continue
            }

            const val = serviceDefine[name]
            service[name] = val
        }

        Object.assign(service, serviceDefine.handlers)

        const event: KiteEvent = new KiteEvent()

        event.path = "@service"
        event.service = service
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

            Object.assign(component, componentDefine.handlers)

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

            middleware.name = `${service.router.type}/${name}`

            const clone = { ...event, request: { body: options }, service } as KiteEvent

            const { handler } = await middlewareDefine.setup.call(middleware, clone)

            service.middlewares.push(handler)
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
            const componentDefine = this.searchComponent(serviceDefine, name)!
            const component = service.components[name]!

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
                if (name.startsWith("@"))    //root event
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
            if (name.startsWith("@"))    //root event
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

                timerEvent.path = "@timer"
                timerEvent.service = service
                timerEvent.component = component

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

            timerEvent.path = "@timer"
            timerEvent.service = service

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
                if (name.startsWith("@"))    //root event
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

            let rootEvent = false
            if (name.startsWith("@"))    //root event
            {
                rootEvent = true
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

    async fetch(router: TypeRouter, request: Partial<Request>) {
        const service = this.getService(router)
        if (service == null) {
            throw new Error("no such service:" + router.type)
        }

        const event = new KiteEvent()

        event.to = router
        event.service = service

        Object.assign(event.request, request)

        async function throwNoHandler() {
            throw new Error("no such handler:" + event.request.path)
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

    private async requestMiddleware(event: KiteEvent, next: () => Promise<void>) {

        const { service } = event
        const { path } = event.request

        //调用service自己的middleware
        await service!.composedMiddleware(event, async () => {

            let handler: (...args: any[]) => void | undefined
            let callthis: any = service

            if (path.startsWith("@")) {     //调用的是component,格式：@/{componentName}/test

                const sep = path.indexOf("/")
                const componentName = path.substring(1, sep)
                const handlerName = path.substring(sep)

                const component = service!.components[componentName]

                callthis = component
                handler = component?.[handlerName]
            }
            else {      // 例子： remotes/test
                handler = getNestedValue(service!, path, undefined, "/")
            }
            //check method
            if (!handler) {
                return await next()
            }

            //@ts-ignore
            if (handler.__kite)      //kites' event handler
            {
                return await (handler as EventHandler).call(callthis, event)
            }
            else {
                event.body = await handler.call(callthis, ...(event.request.body as Array<any> || []))
            }
        })
    }
}