import { Router, Service, Target } from "../types";
import { toTypeRouter } from "../utils/toTypeRouter";
import { useKite } from "./useKite";

export function useRemote(service: Service, router?: Router) {

    const kite = useKite()
    const target = new Target()

    target.local = service.router
    target.remote = toTypeRouter(router ?? service.router)
    target.kite = kite

    return target
}
