export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A route in an app's manifest. `handler` is a path to the handler module, relative to the manifest. */
export type RouteDef<
    Method extends HttpMethod = HttpMethod,
    Path extends string = string,
    Scope extends string = string,
    Public extends boolean = boolean
> = {
    readonly method: Method;
    readonly path: Path;
    readonly handler: string;
    readonly public: Public;
    /** Scopes required on top of the app's base scope. Always empty on public routes. */
    readonly scopes: readonly Scope[];
};

export type RouteOptions<Scope extends string> =
    | { readonly public?: false; readonly scopes?: readonly Scope[] }
    | { readonly public: true; readonly scopes?: undefined };

type IsPublic<Options> = Options extends { public: true } ? true : false;
type ScopesOf<Options> = Options extends { scopes: readonly (infer S extends string)[] }
    ? S
    : never;

export const route = <
    const Method extends HttpMethod,
    const Path extends `/${string}`,
    const Options extends RouteOptions<string> = { public?: false; scopes?: readonly [] }
>(
    method: Method,
    path: Path,
    handler: string,
    options?: Options
): RouteDef<Method, Path, ScopesOf<Options>, IsPublic<Options>> =>
    ({
        method,
        path,
        handler,
        public: options?.public === true,
        scopes: options?.scopes ?? []
    }) as RouteDef<Method, Path, ScopesOf<Options>, IsPublic<Options>>;

export type ScheduleDef = {
    readonly name: string;
    /** An EventBridge Scheduler expression, e.g. `cron(0 9 * * ? *)` or `rate(1 hour)`. */
    readonly schedule: string;
    readonly handler: string;
};

export type AppManifest<
    Name extends string = string,
    Scope extends string = string,
    Routes extends readonly RouteDef[] = readonly RouteDef[]
> = {
    readonly name: Name;
    readonly scopes: readonly Scope[];
    readonly baseScope: Scope;
    readonly routes: Routes;
    readonly schedules: readonly ScheduleDef[];
};

export type AppScope<App> = App extends AppManifest<string, infer Scope> ? Scope : never;

const APP_NAME = /^[a-z][a-z0-9-]*$/;
const PATH = /^\/(?:[a-z0-9-]+|:[a-zA-Z][a-zA-Z0-9]*)(?:\/(?:[a-z0-9-]+|:[a-zA-Z][a-zA-Z0-9]*))*$/;

/** Returns the names of a path's parameters, e.g. `['id']` for `/events/:id`. */
export const pathParams = (path: string): string[] =>
    path
        .split('/')
        .filter((segment) => segment.startsWith(':'))
        .map((segment) => segment.slice(1));

const fail = (message: string): never => {
    throw new Error(`Invalid app manifest: ${message}`);
};

const validate = (app: AppManifest): void => {
    if (!APP_NAME.test(app.name)) {
        fail(`app name "${app.name}" must be lowercase letters, digits and dashes`);
    }
    for (const scope of app.scopes) {
        if (!scope.startsWith(`${app.name}:`)) {
            fail(`scope "${scope}" must start with "${app.name}:"`);
        }
    }
    if (!app.scopes.includes(app.baseScope)) {
        fail(`base scope "${app.baseScope}" is not in scopes`);
    }
    const seen = new Set<string>();
    for (const r of app.routes) {
        const key = `${r.method} ${r.path}`;
        if (!PATH.test(r.path)) {
            fail(`route ${key} has an invalid path`);
        }
        if (r.path === '/auth' || r.path.startsWith('/auth/')) {
            fail(`route ${key} uses /auth, which is reserved for the platform's auth routes`);
        }
        if (seen.has(key)) {
            fail(`route ${key} is defined twice`);
        }
        seen.add(key);
        for (const scope of r.scopes) {
            if (!app.scopes.includes(scope)) {
                fail(`route ${key} requires undeclared scope "${scope}"`);
            }
        }
    }
};

/**
 * Defines an app's routes manifest: the single source of truth for its routes, schedules,
 * scopes and Cognito groups. Route scopes and the base scope must be declared in `scopes`,
 * which is checked at compile time and again when the manifest loads.
 */
export const defineApp = <
    const Name extends string,
    const Scope extends string,
    const Routes extends readonly RouteDef<HttpMethod, `/${string}`, NoInfer<Scope>>[]
>(app: {
    name: Name;
    scopes: readonly [Scope, ...Scope[]];
    baseScope: NoInfer<Scope>;
    routes: Routes;
    schedules?: readonly ScheduleDef[];
}): AppManifest<Name, Scope, Routes> => {
    const manifest: AppManifest<Name, Scope, Routes> = {
        name: app.name,
        scopes: app.scopes,
        baseScope: app.baseScope,
        routes: app.routes,
        schedules: app.schedules ?? []
    };
    validate(manifest);
    return manifest;
};

/** The full set of scopes a route requires: the base scope plus the route's own. */
export const requiredScopes = (app: AppManifest, r: RouteDef): string[] =>
    r.public ? [] : [...new Set([app.baseScope, ...r.scopes])];
