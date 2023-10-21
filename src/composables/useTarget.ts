import { Router, Service, Target } from "../types";
import { toTypeRouter } from "../utils/toTypeRouter";
import { useKite } from "./useKite";

export function useTarget(service: Service, router?: Router) {

    const kite = useKite()
    const target = new Target()

    target.source = service.router
    target.target = toTypeRouter(router ?? service.router)
    target.kite = kite

    return target
}
