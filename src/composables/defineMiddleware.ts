import { KiteEvent, Middleware, WithThis } from "../types";

export type MiddlewareHandler = (event: KiteEvent, next: () => Promise<void>) => Promise<void> | void;
export type MiddlewareSetupHandler = (event: KiteEvent) => Promise<MiddlewareHandler> | MiddlewareHandler

export type MiddlewareDefine = {
    setup: MiddlewareSetupHandler;
}

export function defineMiddleware(options: (MiddlewareDefine & ThisType<Middleware>) | WithThis<Middleware, MiddlewareHandler>): MiddlewareDefine {
    if (typeof options == "function") {
        return {
            setup: () => {
                return options
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