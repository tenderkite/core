import { MiddlewareHandler, MiddlewareProps } from "../composables";
import { Component } from "./Component";
import { Service } from "./Service";

export class Middleware {
    name!: string
    props: MiddlewareProps = {};
    service?: Service
    component?: Component
    handler!: MiddlewareHandler
    [key: string]: any;
    constructor() { }
}