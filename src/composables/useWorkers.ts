import { Worker, WorkerOptions, SHARE_ENV, parentPort, workerData, MessagePort, MessageChannel } from 'worker_threads'
import { cpus } from 'os';

/**
 * 
 * @param threads 
 */
export function useWorkers(onMessage: (index: number | null, message: any) => void, threads = cpus.length, filename: string = process.argv[1], options?: WorkerOptions) {

    const channels: Array<Array<MessagePort>> = []

    for (let i = 0; i < threads; ++i) {

        let first: Array<MessagePort> = channels[i]

        if (first == null) {
            channels[i] = first = []
        }

        for (let j = i + 1; j < threads; j++) {

            let second: Array<MessagePort> = channels[j]

            if (second == null) {
                channels[j] = second = []
            }

            const channel = new MessageChannel()

            first[j] = channel.port1
            second[i] = channel.port2
        }
    }

    const workers = [] as Array<Worker>

    for (let i = 0; i < threads; ++i) {

        let index = i
        let first = channels[i]

        const worker = new Worker(filename, {
            workerData: {
                threads,
                index,
                channels: first
            },
            env: SHARE_ENV,
            ...options,
            transferList: first
        })

        workers.push(worker)

        worker.once("online", () => {
            worker.on("message", (value: any) => {
                onMessage(index, value)
            })
        })
    }

    parentPort?.on("message", (message: any) => {
        onMessage(null, message)
    })

    return (index: number | null, message: any) => {

        if (index == null) {
            throw new Error("index can't be bull")
        }

        if (message == null) {  //没有第二个参数，那么index就是message
            parentPort?.postMessage(index)
            return
        }

        if (workerData.index == index) {
            setImmediate(onMessage, index, message)
            return
        }

        const worker = workers[index]

        worker.postMessage(message)
    }
}

export function useWorker(onMessage: (index: number | null, message: any) => void) {

    const channels = workerData.channels as Array<MessagePort>
    const threads = workerData.threads as number

    for (let i = 0; i < threads; ++i) {

        const port = channels[i]
        if (port == null) {
            continue
        }

        const index = i

        port.on("message", (message) => {
            onMessage(index, message)
        })
    }

    return (index: number | null, message: any) => {

        if (index == null) {
            throw new Error("index can't be bull")
        }

        if (message == null) {  //没有第二个参数，那么index就是message
            parentPort?.postMessage(index)
            return
        }

        if (workerData.index == index) {
            setImmediate(onMessage, index, message)
            return
        }

        const port = channels[index]

        port.postMessage(message)
    }
}