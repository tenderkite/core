import { TimerDefine } from "../types/Timer";
import { Component, KiteEvent, WithPropMethods, EventHandler, EventHandlers, WithThis } from "../types";

type Context = Component

export type ComponentProps = Record<string, any>;
export type ComponentRuntime<P extends ComponentProps> = {
    props?: P
}

export type ComponentSetupHandler<P extends ComponentProps> = (event: KiteEvent) => Promise<ComponentRuntime<P>> | ComponentRuntime<P> | void;
export type ComponentMethods = Record<string, (...args: any[]) => any>;
export type ComponentEventHandlers = Record<string, (...args: any[]) => any>;

export type ComponentDefine<P extends ComponentProps = any, M extends ComponentMethods = any> = ThisType<M & Context> & {
    /**
     * 安装：调用创建时，会调用这个函数,由这个函数装配 属性 + 组件 + 中间件
     * 顺序：service.setup ==> component.setup
     */
    setup?: ComponentSetupHandler<P>;
    /**
     * 缓存超时时间：单位秒
     */
    keepalive?: number;
    /**
     * 各种钩子
     */
    hooks: WithPropMethods<P, M, Context> & {
        /**
        * 开始：安装后，会自动调用1次，如果设置了 keepAlive ，如果刚从alive列表出来，那么也会调用1次
        * 顺序：component.onStart ==> service.onStart
        * 注意：区分是否是从 keepAlive 出来，可以通过判断 keepAlive 字段是否存在
        */
        onStart?: EventHandler;
        /**
        * 停止：停止的回调,如果设置了 keepAlive ，然后会放入 keepAlive 列表,否则直接 destroy
        * 顺序：component.onStop ==> service.onStop
        */
        onStop?: EventHandler;
        /**
         * 销毁：service 被销毁时，会调用此函数。
         * 顺序：component.onDestroy ==> service.onDestroy
         */
        onDestroy?: EventHandler;
    },
    /**
     * 函数集合：这些函数可以直接通过this调用
     */
    methods?: M & WithPropMethods<P, M, Context>;  //赋值给自身的函数方法
    /**
     * 事件集合：监听事件，如果要监听其他service发出的事件，那么事件名可以用"@eventName"的格式，表示监听全局事件
     * 顺序：先注册component的事件，然后再注册service的事件
     */
    events?: ComponentEventHandlers & WithPropMethods<P, M, Context>;
    /**
     * 定时器集合：
     */
    timers?: WithPropMethods<P, M, Context> & Record<string, TimerDefine>;
};

export function defineComponent<P extends ComponentProps, M extends ComponentMethods>(options: ComponentDefine<P, M> | ComponentSetupHandler<P>): ComponentDefine<P, M> {

    const normal = {
        props: {},
        hooks: {},

        methods: {},

        events: {},
        timers: {},
    }
    if (typeof options === 'function') {
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
export function defineComponentSetup<P extends ComponentProps>(handler: WithThis<Context, ComponentSetupHandler<P>>) {
    return handler
}

export function defineComponentMethods<T extends Record<string, Function>>(methods: T & ThisType<T & Context>) {
    return methods
}

export function defineComponentMethod(method: WithThis<Context, (...args: any[]) => any>) {
    return method
}

export function defineComponentTimers<T extends Record<string, TimerDefine>>(timers: T & ThisType<Context>) {
    return timers
}

export function defineComponentTimer<T extends TimerDefine>(timer: T & ThisType<Context>) {
    return timer
}