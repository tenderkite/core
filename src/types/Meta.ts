export interface Meta {

    hash?: (name: string, id: string) => number;
    components?: Array<string>;
    props?: Record<string, any>
}