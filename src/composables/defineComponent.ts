import { TimerDefine } from "./defineTimer";
import { Component, KiteEvent } from "../types";

export type ComponentProps = Record<string, any>;
export type ComponentEventHandlers = Record<string, (...args: any[]) => any>;
export type ComponentHandlers = Record<string, (...args: any[]) => any>;

export type ComponentRuntime<P extends ComponentProps> = {
    props?: P
}

export type ComponentSetupHandler<P extends ComponentProps> = (event: KiteEvent) => Promise<ComponentRuntime<P>> | ComponentRuntime<P> | void;

export type ComponentDefine<P extends ComponentProps = any, H extends ComponentHandlers = any> = {
    setup?: ComponentSetupHandler<P>;
    handlers?: H & ThisType<{ props: P } & Component>;
    events?: ComponentEventHandlers & ThisType<{ props: P } & Component>;
    timers?: Record<string, TimerDefine<(this: { props: P } & H & Component, event: KiteEvent) => Promise<void> | void>>;
    [key: string]: any;
};

export function defineComponent<P extends ComponentProps, H extends ComponentHandlers>(options: ComponentDefine<P, H> | ComponentSetupHandler<P>): ComponentDefine<P, H> {

    const normal = {
        props: {},
        timers: {},
        handlers: {},
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

export function defineComponentSetup<P extends ComponentProps>(handler: ComponentSetupHandler<P>): ComponentSetupHandler<P> {
    return handler
}


// const componentOptions = defineComponent({
//     props: () => ({
//         message: 'Hello world'
//     }),
//     handlers: {
//         hello() {
//             console.log(this.message); // TypeScript 现在可以提供 'message' 属性的智能提示。
//             this.world();
//         },
//         world() {
//             console.log("this is world");
//         },
//     },
//     setup(event) {
//         this.world(); // TypeScript 现在可以提供 'world' 方法的智能提示。
//         console.log(this.message); // TypeScript 现在可以提供 'message' 属性的智能提示。
//         console.log("Setup function");
//     },
//     timers: {
//         sec: {
//             interval: 10,
//             setup() {
//                 this.hello()
//             }
//         }
//     }
// });

// defineComponent(() => {

// })

// console.log(componentOptions); // 输出完整的 options 对象