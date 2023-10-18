
export type NameRouter = string

export interface TypeRouter {
    type: string;
    id: string | number;
}

export type Router = NameRouter | TypeRouter
