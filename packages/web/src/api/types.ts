import type { z } from 'zod';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * The shape of a handler made with the runtime's `defineHandler`, described structurally so this
 * package never depends on backend code.
 */
export type HandlerLike = {
    readonly schemas: {
        readonly params?: z.ZodType;
        readonly query?: z.ZodType;
        readonly body?: z.ZodType;
    };
    readonly handle: (...args: never[]) => unknown;
};

/** An app's routes, keyed like `'GET /events/:id'`. `sbwp types` generates this from the manifest. */
export type RouteMap = { readonly [route: `${Method} /${string}`]: HandlerLike };

export type PathsFor<Routes extends RouteMap, M extends Method> = {
    [K in keyof Routes]: K extends `${M} ${infer Path}` ? Path : never;
}[keyof Routes];

type Route<Routes extends RouteMap, M extends Method, Path extends string> = Extract<
    Routes[`${M} ${Path}` & keyof Routes],
    HandlerLike
>;

/** Required when the schema needs something; optional when it accepts nothing at all. */
type Input<S, Key extends string> = S extends z.ZodType
    ? undefined extends z.input<S>
        ? { readonly [K in Key]?: z.input<S> }
        : object extends z.input<S>
          ? { readonly [K in Key]?: z.input<S> }
          : { readonly [K in Key]: z.input<S> }
    : { readonly [K in Key]?: never };

/** What a call must send: each of params, query and body is required exactly when the handler declares it. */
export type CallOptions<H extends HandlerLike> = Input<H['schemas']['params'], 'params'> &
    Input<H['schemas']['query'], 'query'> &
    Input<H['schemas']['body'], 'body'>;

type IsReply<R> = R extends { readonly status: number; readonly body: unknown }
    ? [Extract<keyof R, symbol>] extends [never]
        ? false
        : true
    : false;
type Unreply<R> = IsReply<R> extends true ? (R extends { readonly body: infer B } ? B : never) : R;

/** What a value becomes after a JSON round trip: dates become strings, functions vanish. */
export type Jsonify<T> = T extends Date
    ? string
    : T extends string | number | boolean | null | undefined
      ? T
      : T extends { toJSON: () => infer J }
        ? Jsonify<J>
        : T extends readonly (infer E)[]
          ? Jsonify<E>[]
          : T extends (...args: never[]) => unknown
            ? never
            : {
                  [K in keyof T as T[K] extends (...args: never[]) => unknown ? never : K]: Jsonify<
                      T[K]
                  >;
              };

/** The parsed response body a handler produces. */
export type ResponseOf<H extends HandlerLike> = Jsonify<Unreply<Awaited<ReturnType<H['handle']>>>>;

type Args<H extends HandlerLike> =
    object extends CallOptions<H> ? [options?: CallOptions<H>] : [options: CallOptions<H>];

export type Caller<Routes extends RouteMap, M extends Method> = <Path extends PathsFor<Routes, M>>(
    path: Path,
    ...args: Args<Route<Routes, M, Path>>
) => Promise<ResponseOf<Route<Routes, M, Path>>>;

export type TypedClient<Routes extends RouteMap> = {
    readonly get: Caller<Routes, 'GET'>;
    readonly post: Caller<Routes, 'POST'>;
    readonly put: Caller<Routes, 'PUT'>;
    readonly patch: Caller<Routes, 'PATCH'>;
    readonly delete: Caller<Routes, 'DELETE'>;
};
