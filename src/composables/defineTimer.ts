import { EventHandler } from "../types";

export interface TimerDefine<T extends EventHandler = EventHandler> {
    delay?: number;
    interval?: number;
    setup: T;
}

export function defineTimer<T extends EventHandler>(options: TimerDefine<T>) {
    return options
}