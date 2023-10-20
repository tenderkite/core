import { MiddlewareHandler } from "../composables";
import { Component } from "./Component";
import { Service } from "./Service";

export class Middleware {
    name!: string
    service?: Service
    component?: Component
    handler!: MiddlewareHandler
    [key: string]: any;
    constructor() { }
}