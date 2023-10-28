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
import { PassThrough, Readable, Stream } from "node:stream";

export type BootDefine = {
    services: Array<Router | [Router, any]>;
    middlewares: Array<CreateInfo>;
}

export type BootCallback = () => BootDefine

export class Kite extends EventEmitter {

    workerIndex: number = 0;
    workerCount: number = 0;
    sendWorker!: (index: number, message: any) => void;     //用于发送 worker的函数

    session = 0;
    sessions: Record<number, { resolve: Function, reject: Function, stream?: Readable }> = {}

    reses: Record<string, any> = {};
    resesCreator: Array<{ name: string, creator: () => any }> = [];

    // virtuals: Record<string, (router: TypeRouter) => TypeRouter> = {};

    //创建service是一个耗时长的过程，用这个方式避免竞争
    createQueue: Record<string, Record<string | number, any>> = {};

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

    [key: string]: any;

    constructor() { super() }

    /**
     * 注册模块
     * @param name 
     */
    async regist(name: string) {

        const module = new Module(this)
        await module.load(name)
        this.modules.push(module)
    }

    private collect(module: Module) {

        for (const child of module.modules) {
            this.collect(child)
        }

        this.serviceDefines = { ...this.serviceDefines, ...module.services }
        this.componentDefines = { ...this.componentDefines, ...module.components }
        this.middlewareDefines = { ...this.middlewareDefines, ...module.middlewares }
    }

    /**
     * 添加资源生成器
     * @param name 
     * @param creator 
     */
    resource(name: string, creator: any | (() => any)) {
        if (typeof creator == "function") {
            this.resesCreator.push({
                name,
                creator
            })
        }
        else {
            this.resesCreator.push({
                name,
                creator: () => {
                    return creator
                }
            })
        }
    }

    // /**
    //  * 将一个 路由 改成另外一个路由
    //  * @param name 
    //  * @param transform 
    //  */
    // virtual(name: string, transform: (router: Router) => TypeRouter) {
    //     this.virtuals[name] = transform
    // }

    /**
     * 获得资源
     * @param name 
     * @returns 
     */
    getRes<T = any>(name: string) {
        const value = this.reses[name]
        if (value == null) {
            return
        }

        return value as T
    }
    /**
     * 启动
     * 
     * @param workerCount worker的数量
     */
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

        // 创建资源
        for (const { name, creator } of this.resesCreator) {
            this.reses[name] = creator()
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

                event.request.path = `setup`
                event.request.method = "fetch"
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

        // 添加 service 的中间件处理函数
        this.middlewares.push(this.routeToService.bind(this))

        // 合并中间件
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

        // 例子：[ [ 'b', 'd', 'a', 'e' ], [ 'f', 'c' ] ]
        // 不同位置元素之间没有关系，
        // [ 'b', 'd', 'a', 'e' ] 中 后面的对前面的有依赖
        for (const one of dependencies) {
            promises.push(new Promise<void>(async (resolve) => {
                // 元素数组中，后面的依赖前面的
                for (const name of one) {
                    const creates = serviceCreates[name]
                    for (const create of creates!) {
                        const req = new Request()
                        req.target = create[0]
                        req.body = create[1]
                        await this.createService(req)
                    }
                }
                resolve()
            }))
        }

        await Promise.all(promises)
    }

    /**
     * 退出
     * @returns 
     */
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

        // 建立依赖
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
            await this.callWorkers("realStopManyServices", one, true)
        }

        //查漏补缺
        await this.callWorkers("realStopAll")

        setTimeout(process.exit, 1000, 0)
    }

    private async realStopAll() {

        if (this.debug) {
            console.log(this.workerIndex, "realStopAll")
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

        this.services = {}
    }

    /**
     * 收集当前种类的 service
     * @returns 
     */
    private async collectNames() {
        return Object.keys(this.services)
    }

    /**
     * 创建 service
     * @param req 
     * @param options 
     * @returns 
     */
    async createService(req: Request) {
        // const target = this.virtuals[req.target.type]?.(req.target) || req.target
        const target = req.target
        const hash = hashRouter(target)
        const index = hash % this.workerCount

        return await this.callWorker(index, "realCreateService", req, target)
    }

    /**
     * 根据 autoCreate 标志来决定是否创建 service
     * 检查是否自动创建service
     */
    private async autoCreateService(target: TypeRouter) {

        const define = this.getServiceDefine(target.type)
        if (define == null) {
            return
        }

        if (!define.autoCreate) {
            return
        }

        const req = new Request()

        req.target = target

        await this.realCreateService(req, target)

        return this.getService(target)
    }

    /**
     * 停止 service
     * @param router 
     * @param forceDestroy 无视 keepalive，强制销毁
     * @returns 
     */
    async stopService(router: TypeRouter, forceDestroy = false) {

        // const target = this.virtuals[router.type]?.(router) || router
        const target = router
        const hash = hashRouter(target)
        const index = hash % this.workerCount

        return await this.callWorker(index, "realStopService", target, forceDestroy)
    }

    /**
     * 
     * @param req 
     * @param target 有可能是经过 virtual 之后的
     */
    private async realCreateService(req: Request, target: TypeRouter) {

        let serviceDefine = this.serviceDefines[target.type]
        if (serviceDefine == null) {
            throw new Error("now such service:" + req.target.type)
        }

        const result = await this.waitInQueue(target)

        if (result) {
            return result as Service
        }

        let service
        let fromKeepAlive = false

        if (serviceDefine.keepAlive) {
            const tpService = this.keepAlives[target.type]
            if (tpService) {
                service = tpService[target.id]
                delete tpService[target.id]
            }

            if (service?.keepAlive) {
                fromKeepAlive = true
                clearTimeout(service.keepAlive)
                delete service.keepAlive
            }
        }

        if (service == null) {
            service = new Service(this)

            service.router = target
            service.define = serviceDefine

            await this.setupService(service, req)
        }

        await this.onStartService(service, fromKeepAlive)

        let tpService = this.services[service.router.type]
        if (tpService == null) {
            this.services[service.router.type] = tpService = {}
        }

        tpService[service.router.id] = service

        if (this.debug) {
            console.log(this.workerIndex, "create service done", service.router.type, service.router.id)
        }

        this.releaseQueue(target, service)
    }

    private async waitInQueue(target: TypeRouter) {
        let tps = this.createQueue[target.type]
        if (tps == null) {
            this.createQueue[target.type] = tps = {}
        }

        let waiting = tps[target.id]
        if (waiting == null) {
            waiting = tps[target.id] = []       //留空，表明自己是第一个
        }
        else {
            return new Promise((resolve, reject) => {
                waiting.push({ resolve, reject })
            })
        }
    }

    private async releaseQueue(target: TypeRouter, result?: Service) {
        let tps = this.createQueue[target.type]
        if (tps == null) {
            return
        }

        let waiting = tps[target.id]
        if (waiting == null) {
            return
        }

        delete tps[target.id]

        for (const one of waiting) {
            one.resolve(result)
        }
    }

    private async realStopService(target: TypeRouter, forceDestroy = false) {

        let tpService = this.services[target.type]
        if (tpService == null) {
            return
        }

        const service = tpService[target.id]
        if (service == null) {
            return
        }

        delete tpService[target.id]

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

    /**
     * 销毁 service,调用这个接口之前，先将这个 service 从列表中摘掉
     * 业务层不提供这个接口
     * @param service 
     */
    private async destroyService(service: Service) {

        if (this.debug) {
            console.log(this.workerIndex, "start destroy service", service.router.type, service.router.id)
        }

        if (service.keepAlive) {
            clearTimeout(service.keepAlive)
            delete service.keepAlive
        }

        for (const name in service.components) {
            const component = service.components[name]

            const event = new KiteEvent()

            event.service = service
            event.component = component!
            event.request.path = `hooks/onDestroy`
            event.request.method = "fetch"

            await component?.define.hooks?.onDestroy?.call(component, event)
        }

        {
            const event = new KiteEvent()

            event.service = service
            event.request.path = `hooks/onDestroy`
            event.request.method = "fetch"

            await service.define.hooks?.onDestroy?.call(service, event)
        }

        if (this.debug) {
            console.log(this.workerIndex, "destroy service done", service.router.type, service.router.id)
        }
    }

    /**
     * 安装 service
     * @param service 
     * @param req 
     */
    private async setupService(service: Service, req: Request) {

        let serviceDefine = service.define

        Object.assign(service, serviceDefine.methods)

        const event: KiteEvent = new KiteEvent(req)

        event.service = service

        event.request.path = `setup`
        event.request.method = "fetch"

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

            const clone = new KiteEvent()

            clone.component = component

            clone.request.path = "setup"
            clone.request.method = "fetch"
            clone.request.body = options

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

            const clone = new KiteEvent()

            clone.service = service

            clone.request.path = "setup"
            clone.request.method = "fetch"
            clone.request.body = options

            const handler = await middlewareDefine.setup.call(middleware, clone)

            service.middlewares.push(handler.bind(middleware))
        }

        service.composedMiddleware = composeMiddlewares(service.middlewares)
    }

    /**
     * 将 service 放入 keepalive 列表中
     * @param service 
     */
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

    private async onStartService(service: Service, fromKeepAlive: boolean) {

        for (const name in service.components) {
            const component = service.components[name]

            const event = new KiteEvent()

            event.service = service
            event.keepAlive = fromKeepAlive
            event.component = component!

            event.request.path = `hooks/onStart`
            event.request.method = "fetch"

            await component?.define.hooks?.onStart?.call(component, event)
        }

        {
            const event = new KiteEvent()

            event.service = service
            event.keepAlive = fromKeepAlive

            event.request.path = `hooks/onStart`
            event.request.method = "fetch"

            await service.define.hooks?.onStart?.call(service, event)
        }

        this.attachEvents(service)
        this.attachTimers(service)
    }

    private async onStopService(service: Service) {

        for (const name in service.components) {
            const component = service.components[name]

            const event = new KiteEvent()

            event.service = service
            event.component = component!
            event.request.path = `hooks/onStop`
            event.request.method = "fetch"

            await component?.define.hooks?.onStop?.call(component, event)
        }

        {
            const event = new KiteEvent()

            event.service = service
            event.request.path = `hooks/onStop`
            event.request.method = "fetch"

            await service.define.hooks?.onStop?.call(service, event)
        }

        this.unattachTimers(service)
        this.unattachEvents(service)
    }

    private attachTimers(service: Service) {

        for (let name in service.components) {
            const component = service.components[name]!
            for (const name in component.define.timers) {

                const timer = component.define.timers[name]!
                const exists = component.timers[name]

                if (exists || exists === false) {       //已经存在或者已经执行完了
                    continue
                }

                const { delay, interval } = timer

                const timerEvent = new KiteEvent()

                timerEvent.service = service
                timerEvent.component = component
                timerEvent.request.path = `timers/${name}`
                timerEvent.request.method = "notify"

                if (delay) {
                    component.timers[name] = setTimeout(async () => {
                        const handler = component.define.timers?.[name]
                        component.timers[name] = false

                        try {
                            await handler?.setup.call(component, timerEvent)
                        }
                        catch (e) {
                            this.emit("error", e)
                        }

                    }, delay)
                }
                else if (interval) {
                    component.timers[name] = setInterval(async () => {
                        const handler = component.define.timers?.[name]

                        try {
                            await handler?.setup.call(component, timerEvent)
                        }
                        catch (e) {
                            this.emit("error", e)
                        }
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
            timerEvent.request.path = `timers/${name}`
            timerEvent.request.method = "notify"

            if (delay) {
                service.timers[name] = setTimeout(async () => {
                    const handler = service.define.timers?.[name]
                    service.timers[name] = false
                    try {
                        await handler?.setup.call(service, timerEvent)
                    }
                    catch (e) {
                        this.emit("error", e)
                    }
                }, delay)
            }
            else if (interval) {
                service.timers[name] = setInterval(async () => {
                    const handler = service.define.timers?.[name]
                    try {
                        await handler?.setup.call(service, timerEvent)
                    }
                    catch (e) {
                        this.emit("error", e)
                    }
                }, interval)
            }
        }
    }

    private unattachTimers(service: Service) {
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

    private attachEvents(service: Service) {
        //regist timers
        const globalEvents = []

        for (let name in service.components) {
            const component = service.components[name]!
            for (const name in component.define.events) {

                let eventName = name
                const handler = component.define.events[name]!

                if (name.startsWith("~"))    //global event
                {
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

    private unattachEvents(service: Service) {
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

    /**
     * 获取 service 实例
     * @param target 
     * @returns 
     */
    getService(target: TypeRouter) {

        const tpService = this.services[target.type]
        if (tpService == null) {
            return
        }
        return tpService[target.id]
    }

    /**
     * 获取 service 定义
     * @param name 
     * @returns 
     */
    getServiceDefine(name: string) {
        let serviceDefine = this.serviceDefines[name]
        if (serviceDefine == null) {
            throw new Error("now such service:" + name)
        }
        return serviceDefine
    }

    /**
     * 获取 组件 定义
     * @param serviceDefine 
     * @param name 
     * @returns 
     */
    getComponentDefine(serviceDefine: ServiceDefine, name: string) {
        let exists = serviceDefine.components?.[name]
        if (exists) {
            return exists
        }
        return this.componentDefines[name]
    }

    /**
     * 获取 中间件 定义
     * @param serviceDefine 
     * @param name 
     * @returns 
     */
    getMiddlewareDefine(serviceDefine: ServiceDefine, name: string) {
        let exists = serviceDefine.middlewares?.[name]
        if (exists) {
            return exists
        }
        return this.middlewareDefines[name]
    }

    /**
     * 获取所有的 remotes 
     */
    getServiceRemotes() {
        const results = {} as Record<string, Array<string>>
        for (const name in this.serviceDefines) {
            const define = this.serviceDefines[name]
            results[name] = Object.keys(define?.remotes)
        }
        return results
    }

    /**
     * 等待远端结果
     * @param request 
     * @returns 
     */
    async fetch(request: Request): Promise<Response> {

        // const router = this.virtuals[request.target.type]?.(request.target) || request.target

        const target = request.target
        const hash = hashRouter(target)
        const index = hash % this.workerCount

        try {
            request.method = "fetch"

            const response = await this.callWorker(index, "realFetch", request)

            return response as Response
        }
        catch (e: any) {
            const response = new Response()

            response.status = 502
            response.statusMessage = e.stack ?? e.message ?? String(e)

            return response
        }
    }

    /**
     * 通知请求,不等待返回
     * @param request 
     */
    async notify(request: Request) {

        // const router = this.virtuals[request.target.type]?.(request.target) || request.target
        const target = request.target
        const hash = hashRouter(target)
        const index = hash % this.workerCount

        request.method = "notify"

        this.notifyWorker(index, "realFetch", request)
    }

    private async realFetch(request: Request) {

        // const router = this.virtuals[request.target.type]?.(request.target) || request.target
        const target = request.target
        let service = this.getService(target)

        const event = new KiteEvent(request)

        if (service == null) {
            service = await this.autoCreateService(target)
        }

        if (service == null) {
            event.response.status = 404
            event.response.statusMessage = "no such handler:" + event.request.path
            return event.response
        }

        event.service = service

        await this.handleEvent(event)

        return event.response
    }

    private async handleEvent(event: KiteEvent) {

        async function throwNoHandler() {
            event.response.status = 404
            event.response.statusMessage = "no such handler:" + event.request.path
        }

        await this.composedMiddleware(event, throwNoHandler)
    }

    /**
     * 全局广播事件
     * @param name 
     * @param option 
     */
    broadEvent(source: TypeRouter, eventName: string, ...args: any[]) {
        this.notifyWorkers("realBroadEvent", source, eventName, ...args)
    }

    /**
     * 全局广播，只有那些 用 ~前缀的事件才会受到调用
     * @param _ 
     * @param eventName 
     * @param args 
     */
    private realBroadEvent(_: TypeRouter, eventName: string, ...args: any[]) {
        for (const name in this.globalEvents) {
            const sets = this.globalEvents[name]
            for (const service of sets!) {
                service.emit(eventName, ...args)
            }
        }
    }

    /**
     * 所有具有相同名字的 service 都会收到调用
     * @param source 发送的来源
     * @param serviceName service 的名称
     * @param path 路径，例子： handlers/test;remotes/test
     * @param args 
     */
    notifyAll(source: TypeRouter, serviceName: string, path: string, ...args: any[]) {
        this.notifyWorkers("realNotifyAll", source, serviceName, path, ...args)
    }

    private realNotifyAll(source: TypeRouter, serviceName: string, path: string, ...args: any[]) {
        const typeServices = this.services[serviceName]
        for (const id in typeServices) {

            const service = typeServices[id]
            if (service == null) {
                continue
            }

            const event = new KiteEvent()

            event.service = service!
            event.request.path = path
            event.request.method = "notify"
            event.request.body = args
            event.request.source = source
            event.request.target = service?.router

            this.handleEvent(event)
        }
    }

    /**
     * 调用service自己的middleware
     * @param event 
     * @param next 
     * @returns 
     */
    private async routeToService(event: KiteEvent, next: () => Promise<void>) {

        const { service } = event
        const { path } = event.request

        if (service == null) {
            return next()
        }

        await service.composedMiddleware(event, async () => {
            /**
             * 例子： 
             * remotes/test,
             * handlers/test
             */
            const handler = getNestedValue(service.define, path, undefined, "/")

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

    private async callWorkers(name: string, ...args: any[]) {
        const promises = []
        for (let i = 0; i < this.workerCount; ++i) {
            promises.push(this.callWorker(i, name, ...args))
        }
        return await Promise.all(promises)
    }

    private async notifyWorkers(name: string, ...args: any[]) {
        for (let i = 0; i < this.workerCount; ++i) {
            this.notifyWorker(i, name, ...args)
        }
    }

    private async onWorkerMessage(index: number, message: { name: string, args: any[], session?: number }) {

        const { session, name, args } = message

        if (this.debug) {
            console.log(this.workerIndex, "onWorkerMessage from", index, name)
        }

        try {
            const result = await this[name](...args)
            if (session == null) {
                return
            }
            if (result instanceof Readable) {
                this.notifyWorker(index, "onRespStreamCreate", session)
                result.on("data", (data) => {
                    this.notifyWorker(index, "onRespStreamData", session, data)
                })
                result.on("close", () => {
                    this.notifyWorker(index, "onRespStreamClose", session)
                })

                result.on("error", (e) => {
                    this.notifyWorker(index, "onRespStreamError", session, e)
                })
                result.on("end", () => {
                    this.notifyWorker(index, "onRespStreamEnd", session)
                })
            }
            else {
                this.notifyWorker(index, "onResp", session, result)
            }
        }
        catch (e) {
            if (session == null) {
                return
            }
            this.notifyWorker(index, "onError", session, e)
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

    private async onRespStreamCreate(id: number) {
        const session = this.sessions[id]
        if (session == null) {
            return
        }

        session.stream = new PassThrough()

        session.resolve(session.stream)
    }
    private async onRespStreamClose(id: number) {
        const session = this.sessions[id]
        if (session == null) {
            return
        }
        delete this.sessions[id]
        const stream = session.stream
        stream?.emit("close")
    }
    private async onRespStreamData(id: number, data: any) {
        const session = this.sessions[id]
        if (session == null) {
            return
        }
        const stream = session.stream
        stream?.push(data)
    }
    private async onRespStreamEnd(id: number) {
        const session = this.sessions[id]
        if (session == null) {
            return
        }
        delete this.sessions[id]
        const stream = session.stream
        stream?.push(null)
    }
    private async onRespStreamError(id: number, e: any) {
        const session = this.sessions[id]
        if (session == null) {
            return
        }
        delete this.sessions[id]
        const stream = session.stream
        stream?.emit("error", e)
    }
}