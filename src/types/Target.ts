import { Kite } from "./Kite";
import { TypeRouter } from "./Router";
import { Request } from "./Event";

export class Target {

    kite!: Kite;

    local!: TypeRouter;
    remote!: TypeRouter

    constructor() { }

    post(path: string, options: any) {

    }

    create(options: any) {
        return this.kite.create(this.remote, { ...options, peer: this.local })
    }

    /**
     * 
     * @param path: a/b/c
     * @param args 函数的参数
     * @returns 
     */
    async call(path: string, ...args: any[]) {

        const response = await this.kite.fetch(this.remote, { path, body: args })

        return response.body
    }

    fetch(reqInfo: Partial<Request>) {
        return this.kite.fetch(this.remote, reqInfo)
    }
}