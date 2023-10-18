import EventEmitter from "node:events";
import { MiddlewareHandler, ServiceDefine, ServiceProps, useRemote } from "../composables";
import { Component } from "./Component";
import { Router, TypeRouter } from "./Router";

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

    comp<T>(name: string) {
        const comp = this.components[name]
        if (comp == null) {
            return
        }

        return comp as T
    }

    get<T>(name: string) {
        const value = this.reses[name]
        if (value == null) {
            return
        }

        return value as T
    }

    set(name: string, val: any) {
        this.reses[name] = val
    }

    remote(router?: Router) {
        return useRemote(this, router)
    }
}