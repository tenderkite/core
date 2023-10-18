import { EventHandler } from "../types";

export interface ResDefine {
    setup: EventHandler;
}

export function defineRes(options: ResDefine | EventHandler): ResDefine {
    if (typeof options == "function") {
        return {
            setup: options
        }
    }
    return options
}