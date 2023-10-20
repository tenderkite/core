import { ComponentProps, ComponentDefine } from "../composables";
import { Service } from "./Service";

export class Component {

    define!: ComponentDefine
    service!: Service
    props: ComponentProps = {};

    timers: Record<string, NodeJS.Timer | false> = {};
    events: Record<string, Function> = {};

    [key: string]: any
    constructor(service: Service) { this.service = service }
}