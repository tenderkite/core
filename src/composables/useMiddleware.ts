import { KiteEvent, Middleware } from "../types";

export function useMiddleware(event: KiteEvent) {
    return event.middleware as Middleware
}