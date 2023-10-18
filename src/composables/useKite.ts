import { Kite } from "../types/Kite"

let kite: Kite

export function useKite() {
    if (kite == null) {
        kite = new Kite()
    }
    return kite
}

