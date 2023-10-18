import { KiteEvent, CreateInfo, Service, EventHandlers } from "../types";
import { ComponentDefine } from "./defineComponent";
import { MiddlewareDefine } from "./defineMiddleware";
import { TimerDefine } from "./defineTimer";

export type ServiceProps = Record<string, any>;
export type ServiceEventHandlers = Record<string, (...args: any[]) => any>;

export type ServiceRuntime<P extends ServiceProps> = {
    props?: P
    components?: Array<CreateInfo>;
    middlewares?: Array<CreateInfo>;
}

export type ServiceHandlers = EventHandlers;
export type ServiceSetupHandler<P extends ServiceProps> = (event: KiteEvent) => Promise<ServiceRuntime<P>> | ServiceRuntime<P> | void;

export type ServiceCacheDefine = {
    period: number;      //
}

export type ServiceDefine<P extends ServiceProps = any, H extends ServiceHandlers = any> = {
    setup?: ServiceSetupHandler<P>;
    cache?: ServiceCacheDefine;
    components?: Record<string, ComponentDefine>;
    middlewares?: Record<string, MiddlewareDefine>;
    handlers?: H & ThisType<{ props: P } & Service>;
    events?: ServiceEventHandlers & ThisType<{ props: P } & Service>;
    timers?: Record<string, TimerDefine<(this: { props: P } & H & Service, event: KiteEvent) => Promise<void> | void>>;
    [key: string]: any;
};

export function defineService<P extends ServiceProps, M extends ServiceHandlers>(options: ServiceDefine<P, M> | ServiceSetupHandler<P>): ServiceDefine<P, M> {

    const normal = {
        props: {},
        events: {},
        components: {},
        middlewares: {},
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

export function defineServiceSetup<P extends ServiceProps>(handler: ServiceSetupHandler<P>): ServiceSetupHandler<P> {
    return handler
}

