import { Kite } from "./Kite";
import { TypeRouter } from "./Router";
import { Request } from "./Event";

export class Target {

    kite!: Kite;

    local!: TypeRouter;
    remote!: TypeRouter

    constructor() { }

    create(options: any) {
        return this.kite.create(this.remote, { ...options, peer: this.local })
    }

    /**
     * 调用 service 下的handlers函数
     * 传入 test，会自动转化成 handlers/test
     * 
     * @param path: a/b/c
     * @param args 函数的参数
     * @returns 
     */
    async call(path: string, ...args: any[]) {

        const response = await this.kite.fetch(this.remote, { path: `handlers/${path}`, body: args, method: "call" })

        return response.body
    }

    /**
     * 
     * @param reqInfo 
     * @returns 
     */
    fetch(reqInfo: Partial<Request>) {
        return this.kite.fetch(this.remote, reqInfo)
    }
}