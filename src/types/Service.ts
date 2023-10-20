import EventEmitter from "node:events";
import { MiddlewareHandler } from "../composables/defineMiddleware"
import { ServiceDefine } from "../composables/defineService"
import { Component } from "./Component";
import { TypeRouter } from "./Router";

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

}