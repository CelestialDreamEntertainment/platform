import type { Db } from 'mongodb';
import type { z } from 'zod';
import { getDb } from './db.js';
import {
    BadRequestError,
    ForbiddenError,
    HttpError,
    internalErrorBody,
    UnauthorizedError
} from './errors.js';
import type { Context, Handler, Schemas } from './handler.js';
import { createLog, type Log } from './log.js';
import { requiredScopes, type HttpMethod } from './manifest.js';
import { isReply } from './reply.js';
import { createSecrets, type Secrets } from './secrets.js';
import { userFromClaims, type Claims, type User } from './user.js';

type ClaimValue = string | number | boolean | readonly string[];

/** The parts of an API Gateway HTTP API (payload v2) event that the wrapper reads. */
export type ApiEvent = {
    readonly body?: string;
    readonly isBase64Encoded: boolean;
    readonly pathParameters?: Readonly<Record<string, string | undefined>>;
    readonly queryStringParameters?: Readonly<Record<string, string | undefined>>;
    readonly requestContext: {
        readonly requestId: string;
        readonly authorizer?: {
            readonly jwt?: { readonly claims: Readonly<Record<string, ClaimValue>> };
        };
    };
};

export type ApiResult = {
    readonly statusCode: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
};

export type WrapOptions = {
    readonly db?: (app: string) => Db;
    readonly log?: Log;
    readonly secrets?: Secrets;
};

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };

const json = (statusCode: number, body: unknown): ApiResult => ({
    statusCode,
    headers: HEADERS,
    body: JSON.stringify(body)
});

const toClaims = (raw: Readonly<Record<string, ClaimValue>>): Claims =>
    Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [
            key,
            Array.isArray(value) ? value.join(' ') : String(value)
        ])
    );

const defined = (
    record: Readonly<Record<string, string | undefined>> = {}
): Record<string, string> =>
    Object.fromEntries(
        Object.entries(record).filter((entry): entry is [string, string] => entry[1] !== undefined)
    );

const parse = <T>(
    schema: z.ZodType<T> | undefined,
    value: unknown,
    fallback: T,
    what: string
): T => {
    if (!schema) {
        return fallback;
    }
    const result = schema.safeParse(value);
    if (!result.success) {
        throw new BadRequestError(
            `Invalid ${what}`,
            result.error.issues.map((issue) => ({
                path: issue.path.map(String).join('.'),
                message: issue.message
            }))
        );
    }
    return result.data;
};

const readBody = (event: ApiEvent): unknown => {
    if (event.body === undefined || event.body === '') {
        return undefined;
    }
    const text = event.isBase64Encoded
        ? Buffer.from(event.body, 'base64').toString('utf8')
        : event.body;
    try {
        return JSON.parse(text);
    } catch {
        throw new BadRequestError('Invalid JSON body');
    }
};

/**
 * Wraps a handler as the Lambda function for one route. The build generates one entry per route
 * that calls this. The wrapper trusts claims API Gateway has already verified and fails closed:
 * 401 when a signed-in route has no user, 403 when the user lacks any required scope.
 */
export const wrap = <S extends Schemas, Scope extends string, Public extends boolean, Result>(
    handler: Handler<S, Scope, Public, Result>,
    route: { readonly method: HttpMethod; readonly path: string },
    options: WrapOptions = {}
): ((event: ApiEvent) => Promise<ApiResult>) => {
    const { app } = handler;
    const def = app.routes.find((r) => r.method === route.method && r.path === route.path);
    if (!def) {
        throw new Error(`${route.method} ${route.path} is not in the ${app.name} manifest`);
    }
    if (def.public !== handler.public) {
        throw new Error(
            `${route.method} ${route.path} is ${def.public ? '' : 'not '}public, but its handler is ${handler.public ? '' : 'not '}public`
        );
    }
    const required = requiredScopes(app, def) as Scope[];
    const openDb = options.db ?? getDb;
    const baseLog = options.log ?? createLog({ app: app.name });
    const secrets = options.secrets ?? createSecrets();

    return async (event) => {
        const log = baseLog.child({
            requestId: event.requestContext.requestId,
            route: `${route.method} ${route.path}`
        });
        try {
            let user: User<Scope> | undefined;
            if (!def.public) {
                const claims = event.requestContext.authorizer?.jwt?.claims;
                const signedIn = claims && userFromClaims(toClaims(claims), app.scopes);
                if (!signedIn) {
                    throw new UnauthorizedError();
                }
                if (!required.every((scope) => signedIn.has(scope))) {
                    throw new ForbiddenError();
                }
                user = signedIn;
            }
            const { schemas } = handler;
            const request = {
                params: parse(schemas.params, defined(event.pathParameters), {}, 'path parameters'),
                query: parse(schemas.query, defined(event.queryStringParameters), {}, 'query'),
                body: parse(schemas.body, schemas.body && readBody(event), undefined, 'body'),
                ...(user ? { user } : {})
            };
            const ctx: Context = {
                get db() {
                    return openDb(app.name);
                },
                secrets,
                log
            };
            const result: unknown = await handler.handle(request as never, ctx);
            if (isReply(result)) {
                return result.body === undefined
                    ? { statusCode: result.status, headers: HEADERS }
                    : json(result.status, result.body);
            }
            return result === undefined ? { statusCode: 204, headers: HEADERS } : json(200, result);
        } catch (error) {
            if (error instanceof HttpError) {
                return json(error.status, error.toBody());
            }
            log.error('Unhandled error', { error });
            return json(500, internalErrorBody);
        }
    };
};
