import { KiteEvent } from "../types/Event";

export function useBody<T = Record<string, any>>(event: KiteEvent): T {
    return event.request.body
}