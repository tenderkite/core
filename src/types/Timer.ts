import { EventHandler } from ".";

export interface TimerDefine {
    delay?: number;
    interval?: number;
    setup: EventHandler;
}
