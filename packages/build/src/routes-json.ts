import { requiredScopes, type AppManifest, type HttpMethod, type RouteDef } from '@sbwp/runtime';

/** The routes JSON format version. The Terraform modules check it. */
export const ROUTES_JSON_VERSION = 1;

export type RouteEntry = {
    /** Unique within the app; used for the Lambda function and zip names. */
    readonly id: string;
    readonly method: HttpMethod;
    readonly path: string;
    readonly public: boolean;
    /** Every scope the wrapper requires. */
    readonly scopes: readonly string[];
    /** The scopes API Gateway's authorizer accepts (any of). Empty on public routes. */
    readonly authorizerScopes: readonly string[];
    /** The zip's file name, relative to the routes JSON. */
    readonly zip: string;
    readonly sha256: string;
};

export type RoutesJson = {
    readonly version: typeof ROUTES_JSON_VERSION;
    readonly app: string;
    readonly runtime: string;
    readonly scopes: readonly string[];
    readonly baseScope: string;
    readonly routes: readonly RouteEntry[];
};

/** A route's ID, e.g. `get-events-by-id` for `GET /events/:id`. */
export const routeId = (r: Pick<RouteDef, 'method' | 'path'>): string =>
    [
        r.method.toLowerCase(),
        ...r.path
            .split('/')
            .filter(Boolean)
            .map((segment) =>
                segment.startsWith(':') ? `by-${segment.slice(1).toLowerCase()}` : segment
            )
    ].join('-');

/**
 * API Gateway can only check "any of these scopes", so it gets the route's most specific scopes:
 * its own extra scopes, or the base scope when it has none. The wrapper checks the full set.
 */
export const authorizerScopes = (app: AppManifest, r: RouteDef): string[] =>
    r.public ? [] : r.scopes.length > 0 ? [...r.scopes] : [app.baseScope];

export const routeEntry = (app: AppManifest, r: RouteDef, sha256: string): RouteEntry => {
    const id = routeId(r);
    return {
        id,
        method: r.method,
        path: r.path,
        public: r.public,
        scopes: requiredScopes(app, r),
        authorizerScopes: authorizerScopes(app, r),
        zip: `${id}.zip`,
        sha256
    };
};
