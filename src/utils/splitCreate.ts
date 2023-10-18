import { CreateInfo, ServiceCreateInfo, TypeRouter } from "../types";

export function splitCreate(info: CreateInfo) {
    if (typeof info == "string") {
        return {
            name: info,
            options: null,
        }
    }

    return {
        name: info[0],
        options: info[1],
    }
}

export function splitServiceCreate(info: ServiceCreateInfo) {

    let router!: TypeRouter
    let options: any

    if (info instanceof Array) {
        router = {
            //@ts-ignore
            type: info[0].type ?? info[0],
            //@ts-ignore
            id: info[0].id ?? ""
        }
        options = info[1]
    }
    else {
        router = {
            //@ts-ignore
            type: info.type ?? info,
            //@ts-ignore
            id: info.id ?? ""
        }
    }

    return {
        router,
        options
    }
}