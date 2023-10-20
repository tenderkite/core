import { KiteEvent } from "../types";

export type ResCreator = (event: KiteEvent) => any;

export function defineRes(options: ResCreator | any): ResCreator {
    if (typeof options == "function") {
        return options
    }
    return () => {
        return options
    }
}