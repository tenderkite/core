import { ComponentDefine, ServiceDefine } from "../composables";
import { MiddlewareDefine } from "../composables/defineMiddleware";
import { ResCreator } from "../composables/defineRes";
import { Kite } from "./Kite";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { importFolder } from "../utils/importFolder";

type NameSpace = "modules" | "services" | "components" | "middlewares" | "utils"

export class Module {

    root: string = ""

    //module的定制：最好配置是从一个大的config来
    modules: Array<Module> = []
    reses: Record<string, ResCreator> = {};
    services: Record<string, ServiceDefine> = {};
    components: Record<string, ComponentDefine> = {};
    middlewares: Record<string, MiddlewareDefine> = {};

    constructor(private kite: Kite) { }

    async load(dir: string) {

        if (dir.startsWith("/") || dir.startsWith(".")) {
            this.root = resolve(dir)

            await this.loadModules(join(this.root, "modules"))
            await this.loadServices(join(this.root, "services"))
            await this.loadComponents(join(this.root, "components"))
            await this.loadMiddlewares(join(this.root, "middlewares"))
            await this.loadUtils(join(this.root, "utils"))
        }
        else {      //Todo
            const { install } = await import(dir) as { install: Function }
            await install(this)
        }
    }

    async loadModules(dir: string) {

        const root = resolve(dir)
        if (existsSync(root) == false) {
            return
        }

        const files = await importFolder(root)

        for (let name in files) {
            let file = files[name]
            this.services[name] = file as ServiceDefine
        }
    }

    async loadServices(dir: string) {

        const root = resolve(dir)

        if (existsSync(root) == false) {
            return
        }

        const files = await importFolder(root)

        for (let name in files) {
            let file = files[name]
            this.services[name] = file as ServiceDefine
        }
    }

    async loadComponents(dir: string) {
        const root = resolve(dir)

        if (existsSync(root) == false) {
            return
        }

        const files = await importFolder(root)

        for (let name in files) {
            let file = files[name]
            this.services[name] = file as ServiceDefine
        }

    }
    async loadMiddlewares(dir: string) {
        const root = resolve(dir)

        if (existsSync(root) == false) {
            return
        }

        const files = await importFolder(root)

        for (let name in files) {
            let file = files[name]
            this.middlewares[name] = file as MiddlewareDefine
        }
    }

    async loadUtils(dir: string) {

    }

    getService(name: string): ServiceDefine | undefined {

        let define = this.services[name]

        if (define) {
            return define
        }

        for (const module of this.modules) {
            define = module.getService(name)
            if (define) {
                return define
            }
        }
    }

    getComponentInService(serviceDefine: ServiceDefine, name: string) {
        let exists = serviceDefine.components?.[name]
        if (exists) {
            return exists
        }

        return this.getComponent(name)
    }

    getComponent(name: string): ComponentDefine | undefined {
        let define = this.components[name]
        if (define) {
            return define
        }
        for (const module of this.modules) {
            define = module.getComponent(name)
            if (define) {
                return define
            }
        }
    }

    getMiddlewareInService(serviceDefine: ServiceDefine, name: string) {
        let exists = serviceDefine.middlewares?.[name]
        if (exists) {
            return exists
        }
        return this.getMiddleware(name)
    }

    getMiddleware(name: string): MiddlewareDefine | undefined {
        let define = this.middlewares[name]
        if (define) {
            return define
        }
        for (const module of this.modules) {
            define = module.getMiddleware(name)
            if (define) {
                return define
            }
        }
    }
}