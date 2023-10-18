export type MaybePromise<T> = T | Promise<T>;

export type WithThis<T, This> = T & ThisType<This>
