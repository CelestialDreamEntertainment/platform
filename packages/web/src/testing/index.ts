import { ApiError } from '../api/client.js';
import type { CallOptions, HandlerLike, Method, RouteMap, TypedClient } from '../api/types.js';
import type { AuthClient, AuthState, SessionUser } from '../auth/client.js';

export type FakeUserInput<Scope extends string> = {
    readonly id?: string;
    readonly email?: string;
    readonly name?: string;
    readonly scopes: readonly Scope[];
};

export const fakeUser = <Scope extends string>(
    input: FakeUserInput<Scope>
): SessionUser<Scope> => ({
    id: input.id ?? 'user-1',
    email: input.email ?? 'alice@test',
    ...(input.name ? { name: input.name } : {}),
    scopes: input.scopes,
    has: (scope) => input.scopes.includes(scope)
});

export type FakeAuthClient<Scope extends string> = AuthClient<Scope> & {
    /** Every `signIn` call's return path. */
    readonly signIns: string[];
    /** Changes the state, e.g. to test what a signed-out visitor sees. */
    readonly setState: (state: AuthState<Scope>) => void;
};

/** A fake auth client for unit tests: signed in as `user`, or signed out without one. */
export const fakeAuthClient = <Scope extends string = string>(
    user?: FakeUserInput<Scope>
): FakeAuthClient<Scope> => {
    let state: AuthState<Scope> = user
        ? { status: 'signedIn', user: fakeUser(user) }
        : { status: 'signedOut' };
    const listeners = new Set<() => void>();
    const signIns: string[] = [];
    const setState = (next: AuthState<Scope>) => {
        state = next;
        for (const listener of listeners) {
            listener();
        }
    };
    const token = async () => (state.status === 'signedIn' ? 'fake-token' : undefined);
    return {
        signIns,
        setState,
        getState: () => state,
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        start: async () => undefined,
        getAccessToken: token,
        refresh: token,
        signIn: (returnTo = '/') => {
            signIns.push(returnTo);
        },
        signOut: async () => setState({ status: 'signedOut' })
    };
};

type Fakes<Routes extends RouteMap> = {
    readonly [K in keyof Routes]?: (
        options: CallOptions<Extract<Routes[K], HandlerLike>>
    ) => unknown;
};

/**
 * A fake API client for unit tests. Give it a function per route key (`'GET /events/:id'`); a call
 * to any other route fails with a 404 `ApiError`, so tests notice unexpected calls.
 */
export const fakeApiClient = <Routes extends RouteMap = RouteMap>(
    fakes: Fakes<Routes>
): TypedClient<Routes> => {
    const call = (method: Method) => async (path: string, options: unknown) => {
        const fake = (fakes as Record<string, ((options: unknown) => unknown) | undefined>)[
            `${method} ${path}`
        ];
        if (!fake) {
            throw new ApiError(404, 'not_found', `No fake for ${method} ${path}`);
        }
        return fake(options ?? {});
    };
    return {
        get: call('GET'),
        post: call('POST'),
        put: call('PUT'),
        patch: call('PATCH'),
        delete: call('DELETE')
    } as unknown as TypedClient<Routes>;
};
