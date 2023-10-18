import { Component } from "./Component";
import { TypeRouter } from "./Router";
import { Service } from "./Service";

export type RequestMethod = "get" | "post" | "call" | "notify"

export class Request {
    method: RequestMethod = "get"
    path: string = ""
    headers: Record<string, string> = {}
    body?: any

    constructor() {

    }
}

export class Response {

    headers: Record<string, string> = {}
    status: number = 404
    body?: any

    constructor() {

    }
}

export class KiteEvent {
    to?: TypeRouter;
    service?: Service;
    component?: Component;
    request: Request = new Request();
    response: Response = new Response();
    [key: string]: any;

    constructor() { }

    get headers() {
        return this.request.headers
    }

    get method() {
        return this.request.method
    }

    set method(val: RequestMethod) {
        this.request.method = val
    }

    set(key: string, val: string) {
        this.headers[key] = val
    }

    set body(val: any) {
        this.response.body = val
    }
}

export type EventHandler = (event: KiteEvent) => Promise<void> | void

export type EventHandlers = Record<string, EventHandler>

export type EventHandlerDefine = EventHandler & {
    __kite: true;
    method?: "POST" | "GET"
}