import type { RouteDef } from '@sbwp/runtime';

/** Every app's API lives under /api, in AWS (CloudFront sends /api/* to API Gateway) and locally. */
export const API_PREFIX = '/api';

export type Match<R extends RouteDef> = {
    readonly route: R;
    readonly params: Record<string, string>;
};

const decode = (segment: string): string | undefined => {
    try {
        return decodeURIComponent(segment);
    } catch {
        return undefined;
    }
};

/** Finds the route for a request path such as `/api/events/e1`, and its path params. */
export const matchRoute = <R extends RouteDef>(
    routes: readonly R[],
    method: string,
    path: string
): Match<R> | undefined => {
    if (!path.startsWith(`${API_PREFIX}/`)) {
        return undefined;
    }
    const segments = path.slice(API_PREFIX.length + 1).split('/');
    for (const route of routes) {
        const pattern = route.path.slice(1).split('/');
        if (route.method !== method || pattern.length !== segments.length) {
            continue;
        }
        const params: Record<string, string> = {};
        const matches = pattern.every((part, i) => {
            const value = decode(segments[i] as string);
            if (value === undefined || value === '') {
                return false;
            }
            if (part.startsWith(':')) {
                params[part.slice(1)] = value;
                return true;
            }
            return part === value;
        });
        if (matches) {
            return { route, params };
        }
    }
    return undefined;
};

/** Query parameters as API Gateway passes them: repeated keys are joined with commas. */
export const queryParameters = (query: URLSearchParams): Record<string, string> | undefined => {
    const result: Record<string, string> = {};
    for (const key of new Set(query.keys())) {
        result[key] = query.getAll(key).join(',');
    }
    return Object.keys(result).length > 0 ? result : undefined;
};
