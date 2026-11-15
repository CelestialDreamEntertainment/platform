import type { Db } from 'mongodb';
import type { z } from 'zod';
import type { Log } from './log.js';
import type { AppManifest } from './manifest.js';
import type { Secrets } from './secrets.js';
import type { User } from './user.js';

/**
 * Zod schemas for a handler's inputs. Anything left out is empty. Path params and query values
 * arrive as strings, so use `z.coerce` for numbers and dates.
 */
export type Schemas = {
    readonly params?: z.ZodType<Record<string, unknown>>;
    readonly query?: z.ZodType<Record<string, unknown>>;
    readonly body?: z.ZodType;
};

type Empty = Record<string, never>;
type Input<S extends Schemas, K extends keyof Schemas, Default> = S[K] extends z.ZodType
    ? z.output<S[K]>
    : Default;

export type Params<S extends Schemas> = Input<S, 'params', Empty>;
export type Query<S extends Schemas> = Input<S, 'query', Empty>;
export type Body<S extends Schemas> = Input<S, 'body', undefined>;

/** A request's parsed, validated inputs. Public routes have no `user`. */
export type Request<S extends Schemas, Scope extends string, Public extends boolean> = {
    readonly params: Params<S>;
    readonly query: Query<S>;
    readonly body: Body<S>;
} & (Public extends true ? { readonly user?: never } : { readonly user: User<Scope> });

/** A handler's dependencies. Real implementations in AWS, local ones in dev, fakes in tests. */
export type Context = {
    readonly db: Db;
    readonly secrets: Secrets;
    readonly log: Log;
};

export type HandlerFn<S extends Schemas, Scope extends string, Public extends boolean, Result> = (
    request: Request<S, Scope, Public>,
    ctx: Context
) => Result | Promise<Result>;

export type Handler<
    S extends Schemas = Schemas,
    Scope extends string = string,
    Public extends boolean = boolean,
    Result = unknown
> = {
    readonly app: AppManifest<string, Scope>;
    readonly public: Public;
    readonly schemas: S;
    /** The handler function itself. Unit tests call it directly with a fake `ctx`. */
    readonly handle: HandlerFn<S, Scope, Public, Result>;
};

/** Defines the handler for a signed-in route. `request.user.has` accepts only the app's scopes. */
export const defineHandler = <Scope extends string, const S extends Schemas, Result>(
    app: AppManifest<string, Scope>,
    schemas: S,
    handle: HandlerFn<S, Scope, false, Result>
): Handler<S, Scope, false, Result> => ({
    app,
    public: false,
    schemas,
    handle
});

/** Defines the handler for a public route. It gets no `user`. */
export const definePublicHandler = <Scope extends string, const S extends Schemas, Result>(
    app: AppManifest<string, Scope>,
    schemas: S,
    handle: HandlerFn<S, Scope, true, Result>
): Handler<S, Scope, true, Result> => ({
    app,
    public: true,
    schemas,
    handle
});
