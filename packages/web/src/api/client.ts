import type { AuthClient } from '../auth/client.js';
import type { Method, RouteMap, TypedClient } from './types.js';

export type Issue = { readonly path: string; readonly message: string };

/** An error response from the API, turned back into the backend's error shape. */
export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly code: string,
        message: string,
        readonly issues?: readonly Issue[]
    ) {
        super(message);
        this.name = 'ApiError';
    }
}

export type RequestOptions = {
    readonly params?: Readonly<Record<string, unknown>>;
    readonly query?: Readonly<Record<string, unknown>>;
    readonly body?: unknown;
};

export type ClientOptions = {
    readonly auth: Pick<AuthClient, 'getAccessToken' | 'refresh'>;
    readonly fetch?: typeof fetch;
};

/** Fills `:name` segments from params, e.g. `/events/:id` with `{ id: 'a b' }` is `/events/a%20b`. */
export const buildPath = (path: string, params: Readonly<Record<string, unknown>> = {}): string =>
    path.replace(/:([a-zA-Z][a-zA-Z0-9]*)/g, (_, name: string) => {
        if (params[name] === undefined) {
            throw new Error(`Missing path param "${name}" for ${path}`);
        }
        return encodeURIComponent(String(params[name]));
    });

const queryString = (query: Readonly<Record<string, unknown>> = {}): string => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
        if (value !== undefined) {
            search.set(key, value instanceof Date ? value.toISOString() : String(value));
        }
    }
    const text = search.toString();
    return text ? `?${text}` : '';
};

type ErrorJson = { error?: { code: string; message: string; issues?: Issue[] }; message?: string };

const toError = async (res: Response): Promise<ApiError> => {
    const body = (await res.json().catch(() => undefined)) as ErrorJson | undefined;
    if (body?.error) {
        return new ApiError(res.status, body.error.code, body.error.message, body.error.issues);
    }
    return new ApiError(res.status, 'http_error', body?.message ?? res.statusText);
};

/**
 * The API client. It calls `/api/...`, attaches the access token, refreshes and retries once on a
 * 401, and turns error responses into `ApiError`s. Given the app's generated `Routes` type, paths,
 * inputs and responses are all checked against the handlers.
 */
export const createClient = <Routes extends RouteMap = RouteMap>(
    options: ClientOptions
): TypedClient<Routes> => {
    const doFetch = options.fetch ?? ((input, init) => fetch(input, init));

    const call = async (method: Method, path: string, request: RequestOptions = {}) => {
        const url = `/api${buildPath(path, request.params)}${queryString(request.query)}`;
        const hasBody = request.body !== undefined;
        const send = (token: string | undefined) =>
            doFetch(url, {
                method,
                credentials: 'same-origin',
                headers: {
                    ...(token ? { authorization: `Bearer ${token}` } : {}),
                    ...(hasBody ? { 'content-type': 'application/json' } : {})
                },
                ...(hasBody ? { body: JSON.stringify(request.body) } : {})
            });
        let res = await send(await options.auth.getAccessToken());
        if (res.status === 401) {
            const token = await options.auth.refresh();
            if (token) {
                res = await send(token);
            }
        }
        if (!res.ok) {
            throw await toError(res);
        }
        return res.status === 204 ? undefined : (res.json() as Promise<unknown>);
    };

    const caller = (method: Method) => (path: string, request?: RequestOptions) =>
        call(method, path, request);

    return {
        get: caller('GET'),
        post: caller('POST'),
        put: caller('PUT'),
        patch: caller('PATCH'),
        delete: caller('DELETE')
    } as unknown as TypedClient<Routes>;
};
