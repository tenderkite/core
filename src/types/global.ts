export type MaybePromise<T> = T | Promise<T>;

export type WithProp<Prop, Context> = ThisType<{ props: Prop } & Context>
export type WithPropMethods<Prop, Methods, Context> = ThisType<{ props: Prop } & Methods & Context>

export type WithThis<T, H extends (...args: any[]) => any> = (this: T, ...args: Parameters<H>) => ReturnType<H>;
