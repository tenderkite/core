import { statSync } from "fs"
import { readdir } from "fs/promises"
import { basename, extname, join } from "path"
import { pathToFileURL } from "url"

export async function importFolder(root: string,) {

    const result: Record<string, any> = {}

    for (const file of await readdir(root)) {
        const whole = join(root, file)
        const ext = extname(whole)
        const name = basename(whole, ext)

        const stat = statSync(whole)

        if (stat.isFile()) {
            const url = pathToFileURL(whole)
            const { default: module } = await import(url.toString())

            result[name] = module
        }
        else {
            result[name] = await importFolder(whole)
        }
    }

    if (result.index && typeof result.index !== "function") {     //index 自动展开
        Object.assign(result, result.index)
        delete result.index
    }

    return result
}