import { Kite } from "./Kite";
import { TypeRouter } from "./Router";
import { Request } from "./Event";

export class Target {

    kite!: Kite;

    source!: TypeRouter;
    target!: TypeRouter

    constructor() { }

    /**
     * 创建 service
     * @param options 
     * @returns 
     */
    create(options: any) {

        const req = new Request()

        req.source = this.source
        req.target = this.target

        req.body = options

        return this.kite.createService(req)
    }

    stop(forceDestroy = false) {
        return this.kite.stopService(this.target!, forceDestroy)
    }

    /**
     * 请求远端对象
     * @param path 路径，例子： handlers/test;remotes/test
     * @returns 
     */
    async fetch(path: string, options?: Partial<Request>) {

        const request = new Request()

        request.path = path
        request.source = this.source
        request.target = this.target
        request.method = "fetch"

        Object.assign(request, options)

        const response = await this.kite.fetch(request)

        return response
    }

    /**
     * 请求远端对象
     * @param path 路径，例子： handlers/test;remotes/test
     * @returns 
     */
    async notify(path: string, options?: Partial<Request>) {

        const request = new Request()

        request.path = path
        request.source = this.source
        request.target = this.target
        request.method = "fetch"

        Object.assign(request, options)

        this.kite.notify(request)
    }

    /**
     * 调用对端的 handler，内部自动拼接 handlers/handlerName
     * @param handlerName 
     * @param args 
     * @returns 
     */
    async call(handlerName: string, ...args: any[]) {
        const path = `handlers/${handlerName}`
        const response = await this.fetch(path, { body: args })
        return response.body
    }

    /**
     * 调用对端的 handler，内部自动拼接 handlers/handlerName
     * @param handlerName 
     * @param args 
     * @returns 
     */
    send(handlerName: string, ...args: any[]) {
        const path = `handlers/${handlerName}`
        return this.notify(path, { body: args })
    }
}