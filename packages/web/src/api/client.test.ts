import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, buildPath, createClient } from './client.js';

const respond = (status: number, body?: unknown, raw?: string) =>
    new Response(raw ?? (body === undefined ? null : JSON.stringify(body)), {
        status,
        statusText: 'Status text'
    });

type Loose = Record<
    'get' | 'post' | 'put' | 'patch' | 'delete',
    (path: string, options?: unknown) => Promise<unknown>
>;
const loose = (client: unknown) => client as Loose;

const setup = (responses: Response[], tokens: (string | undefined)[] = ['t1']) => {
    const fetch = vi.fn(
        async (_input: RequestInfo | URL, _init?: RequestInit) => responses.shift() as Response
    );
    const auth = {
        getAccessToken: vi.fn(async () => tokens[0]),
        refresh: vi.fn(async () => tokens[1])
    };
    return { api: loose(createClient({ auth, fetch })), fetch, auth };
};

describe('buildPath', () => {
    it('fills and encodes params', () => {
        expect(buildPath('/events/:id/rsvps/:rsvpId', { id: 'a b', rsvpId: 3 })).toBe(
            '/events/a%20b/rsvps/3'
        );
    });

    it('fails on a missing param', () => {
        expect(() => buildPath('/events/:id')).toThrow('Missing path param "id" for /events/:id');
    });
});

describe('createClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('calls /api with the token and parses JSON', async () => {
        const { api, fetch } = setup([respond(200, [{ id: 'e1' }])]);
        expect(await api.get('/events')).toEqual([{ id: 'e1' }]);
        expect(fetch).toHaveBeenCalledWith('/api/events', {
            method: 'GET',
            credentials: 'same-origin',
            headers: { authorization: 'Bearer t1' }
        });
    });

    it('sends params, query and a JSON body', async () => {
        const { api, fetch } = setup([respond(201, { id: 'e2' })]);
        const at = new Date('2026-11-15T00:00:00Z');
        await api.post('/events/:id' as never, {
            params: { id: 'e 1' },
            query: { at, n: 2, skip: undefined },
            body: { title: 'Picnic' }
        });
        expect(fetch).toHaveBeenCalledWith(
            '/api/events/e%201?at=2026-11-15T00%3A00%3A00.000Z&n=2',
            {
                method: 'POST',
                credentials: 'same-origin',
                headers: { authorization: 'Bearer t1', 'content-type': 'application/json' },
                body: '{"title":"Picnic"}'
            }
        );
    });

    it.each(['put', 'patch', 'delete'] as const)('supports %s', async (method) => {
        const { api, fetch } = setup([respond(204)]);
        expect(await api[method]('/events')).toBeUndefined();
        expect(fetch.mock.calls[0]?.[1]?.method).toBe(method.toUpperCase());
    });

    it('calls without a token when signed out', async () => {
        const { api, fetch } = setup([respond(200, { ok: true })], []);
        await api.get('/health');
        expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({});
    });

    it('refreshes and retries once on a 401', async () => {
        const { api, fetch } = setup([respond(401), respond(200, 'ok')], ['old', 'new']);
        expect(await api.get('/events')).toBe('ok');
        expect(fetch.mock.calls[1]?.[1]?.headers).toEqual({ authorization: 'Bearer new' });
    });

    it('gives up when the refresh has no session', async () => {
        const { api, fetch } = setup(
            [respond(401, { message: 'Unauthorized' })],
            ['old', undefined]
        );
        await expect(api.get('/events')).rejects.toMatchObject({
            status: 401,
            message: 'Unauthorized'
        });
        expect(fetch).toHaveBeenCalledOnce();
    });

    it('does not retry twice', async () => {
        const { api, fetch } = setup([respond(401), respond(401)], ['old', 'new']);
        await expect(api.get('/events')).rejects.toBeInstanceOf(ApiError);
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("turns the backend's errors into ApiErrors", async () => {
        const issues = [{ path: 'title', message: 'Required' }];
        const { api } = setup([
            respond(400, { error: { code: 'bad_request', message: 'Invalid body', issues } })
        ]);
        const error = (await api.post('/events').catch((e: unknown) => e)) as ApiError;
        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({
            name: 'ApiError',
            status: 400,
            code: 'bad_request',
            message: 'Invalid body',
            issues
        });
    });

    it("turns API Gateway's errors into ApiErrors", async () => {
        const { api } = setup([respond(403, { message: 'Forbidden' })]);
        await expect(api.get('/events')).rejects.toMatchObject({
            status: 403,
            code: 'http_error',
            message: 'Forbidden'
        });
    });

    it('falls back to the status text for non-JSON errors', async () => {
        const { api } = setup([respond(502, undefined, '<html>bad gateway</html>')]);
        await expect(api.get('/events')).rejects.toMatchObject({
            status: 502,
            message: 'Status text'
        });
    });

    it('uses the global fetch by default', async () => {
        const fetch = vi.fn(async () => respond(200, 1));
        vi.stubGlobal('fetch', fetch);
        const api = loose(
            createClient({
                auth: { getAccessToken: async () => undefined, refresh: async () => undefined }
            })
        );
        expect(await api.get('/x')).toBe(1);
    });
});
