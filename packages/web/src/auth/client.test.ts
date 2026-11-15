import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthClient } from './client.js';

const jwt = (claims: Record<string, unknown>) =>
    `h.${btoa(JSON.stringify(claims)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}.s`;

const token = jwt({
    sub: 'u1',
    email: 'alice@test',
    name: 'Alice',
    scope: 'events:guest budget:owner'
});

const respond = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });

const setup = (responses: Response[], now = () => 1_000_000) => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
        const next = responses.shift();
        if (!next) {
            throw new Error('no more responses');
        }
        return next;
    });
    const navigate = vi.fn();
    const client = createAuthClient({
        scopes: ['events:guest', 'events:host'],
        fetch,
        navigate,
        currentPath: () => '/events/1?tab=rsvps',
        now
    });
    return { client, fetch, navigate };
};

describe('createAuthClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('starts loading, then signs in from the refresh cookie', async () => {
        const { client, fetch } = setup([respond(200, { accessToken: token, expiresIn: 3600 })]);
        expect(client.getState()).toEqual({ status: 'loading' });
        await client.start();
        const state = client.getState();
        expect(state.status).toBe('signedIn');
        if (state.status === 'signedIn') {
            expect(state.user).toMatchObject({
                id: 'u1',
                email: 'alice@test',
                name: 'Alice',
                scopes: ['events:guest']
            });
            expect(state.user.has('events:guest')).toBe(true);
            expect(state.user.has('events:host')).toBe(false);
        }
        expect(fetch).toHaveBeenCalledWith('/api/auth/refresh', {
            method: 'POST',
            headers: { 'x-requested-with': 'sbwp' },
            credentials: 'same-origin'
        });
    });

    it('decodes UTF-8 names and keeps every scope without a declared list', async () => {
        const fetch = vi.fn(async () =>
            respond(200, {
                accessToken: `h.${btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({ sub: 'u', email: 'e@test', name: 'Zoë', scope: 'a b' }))))}.s`,
                expiresIn: 60
            })
        );
        const client = createAuthClient({ fetch });
        await client.start();
        const state = client.getState();
        expect(state.status === 'signedIn' && state.user).toMatchObject({
            name: 'Zoë',
            scopes: ['a', 'b']
        });
    });

    it('handles tokens without a name or scope', async () => {
        const { client } = setup([
            respond(200, { accessToken: jwt({ sub: 'u', email: 'e', name: '' }), expiresIn: 60 })
        ]);
        await client.start();
        const state = client.getState();
        expect(state.status === 'signedIn' && state.user).toEqual({
            id: 'u',
            email: 'e',
            scopes: [],
            has: expect.any(Function)
        });
    });

    it('is signed out without a session', async () => {
        const { client } = setup([respond(401)]);
        await client.start();
        expect(client.getState()).toEqual({ status: 'signedOut' });
        expect(await client.getAccessToken()).toBeUndefined();
    });

    it('is signed out when the refresh call fails', async () => {
        const { client } = setup([respond(500)]);
        await client.start();
        expect(client.getState()).toEqual({ status: 'signedOut' });
    });

    it('reports a failed refresh to direct callers', async () => {
        const { client } = setup([respond(502)]);
        await expect(client.refresh()).rejects.toThrow('Refreshing the session failed with 502');
    });

    it('notifies subscribers until they unsubscribe', async () => {
        const { client } = setup([respond(401), respond(401)]);
        const listener = vi.fn();
        const unsubscribe = client.subscribe(listener);
        await client.start();
        expect(listener).toHaveBeenCalledOnce();
        unsubscribe();
        await client.refresh();
        expect(listener).toHaveBeenCalledOnce();
    });

    it('reuses the token until a minute before it expires', async () => {
        let now = 0;
        const { client, fetch } = setup(
            [
                respond(200, { accessToken: token, expiresIn: 120 }),
                respond(200, { accessToken: 'h.e30.s', expiresIn: 120 })
            ],
            () => now
        );
        await client.start();
        now = 59_000;
        expect(await client.getAccessToken()).toBe(token);
        now = 61_000;
        expect(await client.getAccessToken()).toBe('h.e30.s');
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('refreshes on demand while still loading', async () => {
        const { client } = setup([respond(200, { accessToken: token, expiresIn: 60 })]);
        expect(await client.getAccessToken()).toBe(token);
    });

    it('shares one request between concurrent refreshes', async () => {
        const { client, fetch } = setup([respond(200, { accessToken: token, expiresIn: 60 })]);
        const [a, b] = await Promise.all([client.refresh(), client.refresh()]);
        expect(a).toBe(token);
        expect(b).toBe(token);
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('sends the browser to sign in and back', () => {
        const { client, navigate } = setup([]);
        client.signIn();
        expect(navigate).toHaveBeenCalledWith(
            '/api/auth/login?return_to=%2Fevents%2F1%3Ftab%3Drsvps'
        );
        client.signIn('/other');
        expect(navigate).toHaveBeenLastCalledWith('/api/auth/login?return_to=%2Fother');
    });

    it('signs out and follows the redirect', async () => {
        const { client, fetch, navigate } = setup([
            respond(200, { accessToken: token, expiresIn: 60 }),
            respond(200, { redirectTo: '/bye' })
        ]);
        await client.start();
        await client.signOut();
        expect(fetch).toHaveBeenLastCalledWith(
            '/api/auth/logout',
            expect.objectContaining({ method: 'POST' })
        );
        expect(client.getState()).toEqual({ status: 'signedOut' });
        expect(navigate).toHaveBeenCalledWith('/bye');
    });

    it.each([
        ['a failed call', respond(500, { error: { code: 'internal' } })],
        ['a body without a redirect', respond(200, {})],
        ['a non-JSON body', new Response('<html>', { status: 200 })]
    ])('signs out to the home page after %s', async (_, response) => {
        const { client, navigate } = setup([response]);
        await client.signOut();
        expect(client.getState()).toEqual({ status: 'signedOut' });
        expect(navigate).toHaveBeenCalledWith('/');
    });

    it('signs out to the home page when the network fails', async () => {
        const navigate = vi.fn();
        const client = createAuthClient({
            navigate,
            fetch: async () => {
                throw new TypeError('offline');
            }
        });
        await client.signOut();
        expect(navigate).toHaveBeenCalledWith('/');
    });

    it('uses the browser by default', async () => {
        const fetch = vi.fn(async () => respond(401));
        vi.stubGlobal('fetch', fetch);
        const assign = vi.fn();
        vi.stubGlobal('location', { pathname: '/a', search: '?b', hash: '#c', assign });
        const client = createAuthClient();
        await client.start();
        expect(fetch).toHaveBeenCalled();
        client.signIn();
        expect(assign).toHaveBeenCalledWith('/api/auth/login?return_to=%2Fa%3Fb%23c');
    });
});
