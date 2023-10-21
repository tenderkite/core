import EventEmitter from "node:events";
import { MiddlewareHandler } from "../composables/defineMiddleware"
import { ServiceDefine } from "../composables/defineService"
import { Component } from "./Component";
import { Router, TypeRouter } from "./Router";
import { Target } from "./Target";
import { toTypeRouter } from "../utils/toTypeRouter";
import { useKite } from "../composables/useKite";

export type ServiceProps = Record<string, any>;

export class Service extends EventEmitter {

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

    constructor() { super() }

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
     * @param router 
     * @returns 
     */
    target(router?: Router) {

        const target = new Target()

        target.local = this.router
        target.remote = toTypeRouter(router ?? this.router)
        target.kite = useKite()

        return target
    }

}