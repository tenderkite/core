import { Kite } from "./Kite";
import { TypeRouter } from "./Router";
import { Request } from "./Event";

export class Target {

    kite!: Kite;

    local!: TypeRouter;
    remote!: TypeRouter

    constructor() { }

    create(options: any) {
        return this.kite.createService(this.remote, { ...options, peer: this.local })
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

        const response = await this.kite.fetch(this.remote, { path: `${this.remote.type}/handlers/${path}`, body: args, method: "call" })

        return response.body
    }

    /**
     * 原生态调用信息，不做任何处理
     * @param reqInfo 
     * @returns 
     */
    fetch(reqInfo: Partial<Request>) {
        return this.kite.fetch(this.remote, reqInfo)
    }
}