import EventEmitter from "node:events";
import { MiddlewareHandler } from "../composables/defineMiddleware"
import { ServiceDefine } from "../composables/defineService"
import { Component } from "./Component";
import { Router, TypeRouter } from "./Router";
import { Target } from "./Target";
import { toTypeRouter } from "../utils/toTypeRouter";
import { Kite } from "./Kite";

export type ServiceProps = Record<string, any>;

export class Service extends EventEmitter {

    kite!: Kite;

    router!: TypeRouter;
    define!: ServiceDefine

    props: ServiceProps = {};
    reses: Record<string, any> = {};

    components: Record<string, Component> = {};
    middlewares: Array<MiddlewareHandler> = [];
    composedMiddleware!: MiddlewareHandler

    timers: Record<string, NodeJS.Timer | false> = {};
    events: Record<string, Function> = {};

    [key: string]: any;

    constructor(kite: Kite) {
        super()
        this.kite = kite
    }

    /**
     * 获得组件
     * @param name 
     * @returns 
     */
    getComp<T = any>(name: string) {
        const comp = this.components[name]
        if (comp == null) {
            return
        }

        return comp as T
    }

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
     * 设置资源
     * @param name 
     * @param val 
     */
    setRes(name: string, val: any) {
        this.reses[name] = val
    }

    /**
     * 包装远程目标
     * 不传则表示广播
     * @param router 
     * @returns 
     */
    target(router?: Router) {

        const target = new Target()

        target.source = this.router
        target.kite = this.kite
        target.target = toTypeRouter(router ?? this.router)

        return target
    }

    /**
     * 广播给 所有 serviceName 的服务
     * @param serviceName 
     * @param handlerName 
     * @param args 
     */
    notifyAll(serviceName: string, handlerName: string, ...args: any[]) {
        this.kite.notifyAll(this.source, serviceName, `handlers/${handlerName}`, ...args)
    }

}