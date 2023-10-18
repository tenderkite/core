import { KiteEvent, Service } from "../types";

export function useService(event: KiteEvent) {
    return event.service as Service
}