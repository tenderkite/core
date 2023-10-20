import { Worker, WorkerOptions, SHARE_ENV, parentPort, workerData, MessagePort, MessageChannel } from 'worker_threads'
import { cpus } from 'os';

/**
 * 创建N-1条线程
 * 请注意，当前作为0号线程
 * @param threads 
 */
export function useWorkers(options: {
    onMessage: (index: number, message: any) => void,
    onExit: (index: number) => void,
    threads?: number,
    filename?: string,
    workerOptions?: WorkerOptions
}) {

    const { onMessage, onExit, threads = cpus().length, filename = process.argv[1], workerOptions } = options

    const channels: Array<Record<number, MessagePort>> = []

    for (let i = 1; i < threads; ++i) {

        let first = channels[i]

        if (first == null) {
            channels[i] = first = {}
        }

        for (let j = i + 1; j < threads; j++) {

            let second = channels[j]

            if (second == null) {
                channels[j] = second = {}
            }

            const channel = new MessageChannel()

            first[j] = channel.port1
            second[i] = channel.port2
        }
    }

    const workers = {} as Record<number, Worker>

    for (let i = 1; i < threads; ++i) {

        const index = i
        const first = channels[i]

        const array = []
        for (let name in first) {
            //@ts-ignore
            array.push(first[name])
        }

        const worker = new Worker(filename!, {
            workerData: {
                threads,
                index,
                channels: first
            },
            env: SHARE_ENV,
            ...workerOptions,
            transferList: array
        })

        workers[i] = worker
        worker.once("online", () => {
            worker.on("message", (value: any) => {
                onMessage(index, value)
            })
        })
        worker.on("error", console.error)
        worker.once("exit", () => {
            onExit(index)
        })
    }

    //返回发送用的函数
    return {
        index: 0,
        threads,
        send: (index: number, message: any) => {
            const worker = workers[index]
            if (worker) {
                worker?.postMessage(message)
            }
            else if (index == 0) {
                setImmediate(onMessage, index, message)
            }
        }
    }
}

export function useWorker(options: { onMessage: (index: number, message: any) => void }) {

    const { onMessage } = options

    const channels = workerData.channels as Record<number, MessagePort>
    const threads = workerData.threads as number

    channels[0] = parentPort!

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

    return {
        index: workerData.index as number,
        threads,
        send: (index: number, message: any) => {

            const port = channels[index]

            if (port) {
                port.postMessage(message)
            }
            else if (workerData.index == index) {
                setImmediate(onMessage, index, message)
            }
        }
    }
}