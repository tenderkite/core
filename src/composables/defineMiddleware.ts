import { KiteEvent, Middleware } from "../types";

export type MiddlewareProps = Record<string, any>;
export type MiddlewareHandler = (event: KiteEvent, next: () => Promise<void>) => Promise<void> | void;

export type MiddlewareRuntime<P extends MiddlewareProps> = {
    props?: P,
    handler: MiddlewareHandler,
}

export type MiddlewareSetupHandler<P extends MiddlewareProps> = (event: KiteEvent) => Promise<MiddlewareRuntime<P>> | MiddlewareRuntime<P>

export type MiddlewareDefine<P extends MiddlewareProps = any> = {
    setup: MiddlewareSetupHandler<P>;
}

export function defineMiddleware<P extends MiddlewareProps>(options: MiddlewareDefine<P> | MiddlewareHandler): MiddlewareDefine<P> {
    if (typeof options == "function") {
        return {
            setup: () => {
                return { handler: options }
            }
        }
    }
    return options
}

export function composeMiddlewares(middlewares: Array<MiddlewareHandler>): MiddlewareHandler {

    return async (context: any, next: () => Promise<void>) => {
        let prevIndex = -1;

        async function dispatch(index: number): Promise<void> {
            if (index <= prevIndex) {
                return Promise.reject(new Error('next() called multiple times'))
            }

            prevIndex = index;

            const middleware = middlewares[index];

            if (index === middlewares.length) {
                await next();
            } else {
                //@ts-ignore
                await middleware?.(context, () => dispatch(index + 1));
            }
        }
        await dispatch(0);
    };
}