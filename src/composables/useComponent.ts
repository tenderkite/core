import { KiteEvent, Component } from "../types";

export function useComponent(event: KiteEvent) {
    return event.component as Component
}