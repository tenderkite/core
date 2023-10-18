import { Router, TypeRouter } from "../types/Router"

export function toTypeRouter(router: Router) {

    //@ts-ignore
    const type = router.type || router
    //@ts-ignore
    const id = router.id || ""

    return { type, id } as TypeRouter
}