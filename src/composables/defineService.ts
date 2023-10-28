import { KiteEvent, CreateInfo, Service, ServiceProps, EventHandlers, WithPropMethods, EventHandler, WithThis } from "../types";
import { ComponentDefine } from "./defineComponent";
import { MiddlewareDefine } from "./defineMiddleware";
import { TimerDefine } from "../types/Timer";
import { Middleware } from "../types/Middlware";

type Context = Service

export type ServiceRuntime<P extends ServiceProps> = {
    props?: P
    components?: Array<CreateInfo>;
    middlewares?: Array<CreateInfo>;
}

export type ServiceSetupHandler<P extends ServiceProps> = (event: KiteEvent) => Promise<ServiceRuntime<P>> | ServiceRuntime<P> | void;
export type ServiceMethods = Record<string, (...args: any[]) => any>;
export type ServiceHandlers = EventHandlers;
export type ServiceEventHandlers = Record<string, (...args: any[]) => any>;

/**
 * 定义 service
 */
export type ServiceDefine<P extends ServiceProps = any, M extends ServiceMethods = any, H extends ServiceHandlers = any, R extends ServiceHandlers = any> = ThisType<Context & M> & {
    /**
     * 安装：调用创建时，会调用这个函数,由这个函数装配 属性 + 组件 + 中间件
     * 顺序：service.setup ==> component.setup
     */
    setup?: ServiceSetupHandler<P>;
    /**
     * 依赖的service类型，对于那些被依赖的，启动的时候会优先启动
     * 退出时，会最晚启动
     */
    depends?: string | Array<string>

    /**
     * 缓存超时时间：单位秒
     */
    keepAlive?: number;
    /**
     * 发送消息时，如果不存在，是否自动创建
     * 默认值： false
     */
    autoCreate?: boolean;
    /**
     * 各种钩子
     */
    hooks?: WithPropMethods<P, M, Context> & {
        /**
        * 开始：安装后，会自动调用1次，如果设置了 keepAlive ，如果刚从alive列表出来，那么也会调用1次
        * 顺序：component.onStart ==> service.onStart
        * 注意：区分是否是从 keepAlive 出来，可以通过判断 keepAlive 字段是否存在
        */
        onStart?: EventHandler;
        /**
        * 停止：停止的回调。如果设置了 keepAlive ，然后会放入 keepAlive 列表
        * 顺序：component.onStop ==> service.onStop
        */
        onStop?: EventHandler;
        /**
         * 销毁：service 被销毁时，会调用此函数。
         * 顺序：component.onDestroy ==> service.onDestroy
         */
        onDestroy?: EventHandler;
    }
    /**
     * 提供创建组件的信息
     */
    components?: Record<string, ComponentDefine>;
    /**
     * 提供创建中间件的信息
     */
    middlewares?: Record<string, MiddlewareDefine> & ThisType<Middleware>;
    /**
     * 函数集合：这些函数可以直接通过this调用
     */
    methods?: M & WithPropMethods<P, M, Context>;  //赋值给自身的函数方法
    /**
     * 句柄集合：用于暴露给其他service调用的函数集合
     */
    handlers?: H & WithPropMethods<P, M, Context>;
    /**
     * 远程调用集合：handlers是给整个kite系统内部调用的，remotes是给外界调用的
     */
    remotes?: R & WithPropMethods<P, M, Context>;
    /**
     * 事件集合：监听事件，如果要监听其他service发出的事件，那么事件名可以用"@eventName"的格式，表示监听全局事件
     * 顺序：先注册component的事件，然后再注册service的事件
     */
    events?: ServiceEventHandlers & WithPropMethods<P, M, Context>;
    /**
     * 定时器集合：
     */
    timers?: WithPropMethods<P, M, Context> & Record<string, TimerDefine>;
};

/**
 * 定义 服务
 * @param options 
 * @returns 
 */
export function defineService<P extends ServiceProps, M extends ServiceMethods, H extends ServiceHandlers, R extends ServiceHandlers>(options: ServiceDefine<P, M, H, R> | ServiceSetupHandler<P>): ServiceDefine<P, M, H, R> {

    const normal = {
        props: {},
        components: {},
        middlewares: {},

        hooks: {},

        methods: {},
        remotes: {},

        events: {},
        timers: {},
    }

    if (typeof options == "function") {
        //@ts-ignore
        return {
            ...normal,
            setup: options,
        }
    }
    //@ts-ignore
    return { ...normal, ...options }
}

/**
 * 定义安装函数
 * @param handler 
 * @returns 
 */
export function defineServiceSetup<P extends ServiceProps>(handler: WithThis<Context, ServiceSetupHandler<P>>) {
    return handler
}

/**
 * 定义服务的 methods
 * @param methods 
 * @returns 
 */
export function defineServiceMethods<T extends Record<string, Function>>(methods: T & ThisType<T & Context>) {
    return methods
}

/**
 * 定义服务的 单个method
 * @param method 
 * @returns 
 */
export function defineServiceMethod(method: WithThis<Context, (...args: any[]) => any>) {
    return method
}

export function defineServiceHandlers<T extends ServiceHandlers>(handlers: T & ThisType<Context>) {
    return handlers
}

export function defineServiceHandler<T extends EventHandler>(handler: WithThis<Context, T>) {
    return handler
}

export function defineServiceRemotes<T extends ServiceHandlers>(remotes: T & ThisType<Context>) {
    return remotes
}

export function defineServiceRemote<T extends EventHandler>(remote: WithThis<Context, T>) {
    return remote
}

export function defineServiceTimers<T extends Record<string, TimerDefine>>(timers: T & ThisType<Context>) {
    return timers
}

export function defineServiceTimer<T extends TimerDefine>(timer: T & ThisType<Context>) {
    return timer
}

export function defineServiceEvents<T extends Record<string, Function>>(events: T & ThisType<T & Context>) {
    return events
}

export function defineServiceEvent(event: WithThis<Context, (...args: any[]) => any>) {
    return event
}

// export function defineService



