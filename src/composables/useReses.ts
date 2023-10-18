import { useKite } from "./useKite";

export function useReses() {
    const kite = useKite()
    return kite.reses
}