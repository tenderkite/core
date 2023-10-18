import { EventHandler, EventHandlerDefine } from "../types/Event";

export function defineHandler(handler: EventHandler | EventHandlerDefine) {
    //@ts-ignore
    if (!handler.__kite) {
        const result = handler as EventHandlerDefine
        result.__kite = true
        return result
    }
    return handler
}

