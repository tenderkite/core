import { TypeRouter } from "../types";

export function hashRouter(router: TypeRouter) {

    if (typeof router.id == "number") {
        return router.id
    }

    if (router.id == "") {
        return hash(router.type)
    }

    return hash(router.id)
}

function hash(str: string) {
    let hash = 0, i = 0, len = str.length;
    while (i < len) {
        hash = ((hash << 5) - hash + str.charCodeAt(i++)) << 0;
    }
    return (hash + 2147483647) + 1;;
}