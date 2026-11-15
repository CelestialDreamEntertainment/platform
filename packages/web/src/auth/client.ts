/** The signed-in user, as the frontend sees it. Built from the access token's claims. */
export type SessionUser<Scope extends string = string> = {
    readonly id: string;
    readonly email: string;
    readonly name?: string;
    readonly scopes: readonly Scope[];
    readonly has: (scope: Scope) => boolean;
};

export type AuthState<Scope extends string = string> =
    | { readonly status: 'loading' }
    | { readonly status: 'signedOut' }
    | { readonly status: 'signedIn'; readonly user: SessionUser<Scope> };

export type AuthClient<Scope extends string = string> = {
    readonly getState: () => AuthState<Scope>;
    readonly subscribe: (listener: () => void) => () => void;
    /** Restores the session from the refresh cookie. Call once on page load. */
    readonly start: () => Promise<void>;
    /** A current access token, refreshed when it is about to expire. Undefined when signed out. */
    readonly getAccessToken: () => Promise<string | undefined>;
    /** Gets a new access token now. Concurrent calls share one request. */
    readonly refresh: () => Promise<string | undefined>;
    /** Sends the browser to sign in, then back to `returnTo` (default: the current page). */
    readonly signIn: (returnTo?: string) => void;
    readonly signOut: () => Promise<void>;
};

export type AuthClientOptions<Scope extends string> = {
    /** The app's scopes. Others in the token are ignored, and `has` only accepts these. */
    readonly scopes?: readonly Scope[];
    readonly fetch?: typeof fetch;
    readonly navigate?: (url: string) => void;
    readonly currentPath?: () => string;
    readonly now?: () => number;
};

export const CSRF_HEADERS = { 'x-requested-with': 'sbwp' } as const;

/** Refresh this long before the token expires, so requests never race its expiry. */
const EARLY_MS = 60_000;

type Claims = { sub?: unknown; email?: unknown; name?: unknown; scope?: unknown };

const decodeClaims = (token: string): Claims => {
    const payload = String(token.split('.')[1]);
    const json = atob(payload.replaceAll('-', '+').replaceAll('_', '/'));
    return JSON.parse(
        new TextDecoder().decode(Uint8Array.from(json, (c) => c.charCodeAt(0)))
    ) as Claims;
};

const toUser = <Scope extends string>(
    claims: Claims,
    declared?: readonly Scope[]
): SessionUser<Scope> => {
    const granted = typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : [];
    const scopes = (declared ? declared.filter((s) => granted.includes(s)) : granted) as Scope[];
    return {
        id: String(claims.sub),
        email: String(claims.email),
        ...(typeof claims.name === 'string' && claims.name ? { name: claims.name } : {}),
        scopes,
        has: (scope) => scopes.includes(scope)
    };
};

/**
 * The browser side of the platform's sign-in. The access token lives only in memory; the refresh
 * token stays in an HttpOnly cookie the page can't read, so an XSS bug can never steal it.
 */
export const createAuthClient = <Scope extends string = string>(
    options: AuthClientOptions<Scope> = {}
): AuthClient<Scope> => {
    const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
    const navigate = options.navigate ?? ((url) => window.location.assign(url));
    const currentPath =
        options.currentPath ??
        (() => window.location.pathname + window.location.search + window.location.hash);
    const now = options.now ?? Date.now;

    let state: AuthState<Scope> = { status: 'loading' };
    let token: { value: string; expiresAt: number } | undefined;
    let pending: Promise<string | undefined> | undefined;
    const listeners = new Set<() => void>();

    const setState = (next: AuthState<Scope>): void => {
        state = next;
        for (const listener of listeners) {
            listener();
        }
    };

    const signedOut = (): undefined => {
        token = undefined;
        setState({ status: 'signedOut' });
        return undefined;
    };

    const refresh = (): Promise<string | undefined> => {
        pending ??= (async () => {
            try {
                const res = await doFetch('/api/auth/refresh', {
                    method: 'POST',
                    headers: CSRF_HEADERS,
                    credentials: 'same-origin'
                });
                if (res.status === 401) {
                    return signedOut();
                }
                if (!res.ok) {
                    throw new Error(`Refreshing the session failed with ${res.status}`);
                }
                const body = (await res.json()) as { accessToken: string; expiresIn: number };
                token = { value: body.accessToken, expiresAt: now() + body.expiresIn * 1000 };
                setState({
                    status: 'signedIn',
                    user: toUser(decodeClaims(body.accessToken), options.scopes)
                });
                return body.accessToken;
            } finally {
                pending = undefined;
            }
        })();
        return pending;
    };

    return {
        getState: () => state,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        start: async () => {
            try {
                await refresh();
            } catch {
                signedOut();
            }
        },
        getAccessToken: async () => {
            if (token && token.expiresAt - EARLY_MS > now()) {
                return token.value;
            }
            return state.status === 'signedOut' ? undefined : refresh();
        },
        refresh,
        signIn: (returnTo = currentPath()) => {
            navigate(`/api/auth/login?return_to=${encodeURIComponent(returnTo)}`);
        },
        signOut: async () => {
            let redirectTo: unknown;
            try {
                const res = await doFetch('/api/auth/logout', {
                    method: 'POST',
                    headers: CSRF_HEADERS,
                    credentials: 'same-origin'
                });
                redirectTo = res.ok
                    ? ((await res.json()) as { redirectTo?: unknown }).redirectTo
                    : undefined;
            } catch {
                redirectTo = undefined;
            }
            signedOut();
            // Even if the server call fails, the in-memory token is gone, so land on the home page.
            navigate(typeof redirectTo === 'string' ? redirectTo : '/');
        }
    };
};
