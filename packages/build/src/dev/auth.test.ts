import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineApp } from '@sbwp/runtime';
import { decodeJwt } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { fakeSub, handleAuth, readCookie, safeReturnTo, type AuthRequest } from './auth.js';
import { loadKeys, signRefreshToken, type Keys } from './tokens.js';

const app = defineApp({
    name: 'events',
    scopes: ['events:guest', 'events:host'],
    baseScope: 'events:guest',
    routes: []
});

let keys: Keys;
beforeAll(async () => {
    keys = await loadKeys(join(await mkdtemp(join(tmpdir(), 'auth-')), 'key.json'));
});

const request = (overrides: Partial<AuthRequest>): AuthRequest => ({
    method: 'GET',
    path: '/api/auth/login',
    query: new URLSearchParams(),
    headers: {},
    body: '',
    ...overrides
});

const login = (body: string) => handleAuth(app, keys, request({ method: 'POST', body }));
const csrf = { 'x-requested-with': 'sbwp' };

describe('safeReturnTo', () => {
    it.each([
        ['/events/1?x=y', '/events/1?x=y'],
        [null, '/'],
        ['', '/'],
        ['https://evil.test', '/'],
        ['//evil.test', '/'],
        ['/\\evil.test', '/']
    ])('turns %j into %j', (value, expected) => {
        expect(safeReturnTo(value)).toBe(expected);
    });
});

describe('readCookie', () => {
    it('finds a cookie by name', () => {
        expect(readCookie('a=1; sbwp_refresh=tok; b=2', 'sbwp_refresh')).toBe('tok');
        expect(readCookie('a=1', 'sbwp_refresh')).toBeUndefined();
        expect(readCookie(undefined, 'sbwp_refresh')).toBeUndefined();
    });
});

describe('fakeSub', () => {
    it('is stable per email, ignoring case', () => {
        expect(fakeSub('Alice@Test')).toBe(fakeSub('alice@test'));
        expect(fakeSub('alice@test')).not.toBe(fakeSub('bob@test'));
        expect(fakeSub('alice@test')).toMatch(/^fake-[0-9a-f]{16}$/);
    });
});

describe('handleAuth', () => {
    it("shows the sign-in page with the app's scopes, base scope ticked", async () => {
        const page = await handleAuth(
            app,
            keys,
            request({ query: new URLSearchParams('return_to=/x"y') })
        );
        expect(page?.status).toBe(200);
        expect(page?.headers['content-type']).toContain('text/html');
        expect(page?.body).toContain('value="events:guest" checked');
        expect(page?.body).toContain('value="events:host">');
        expect(page?.body).toContain('value="/x&#34;y"');
    });

    it('signs in, sets the refresh cookie and redirects back', async () => {
        const result = await login(
            'email=alice%40test&name=Alice&scope=events:host&scope=budget:owner&return_to=/e/1'
        );
        expect(result?.status).toBe(303);
        expect(result?.headers.location).toBe('/e/1');
        const setCookie = result?.headers['set-cookie'] ?? '';
        expect(setCookie).toMatch(
            /^sbwp_refresh=[^;]+; Path=\/api\/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000$/
        );
        const token = readCookie(setCookie.split(';')[0], 'sbwp_refresh') ?? '';
        expect(decodeJwt(token)).toMatchObject({
            email: 'alice@test',
            name: 'Alice',
            scopes: ['events:host']
        });
    });

    it('signs in without a name or scopes', async () => {
        const result = await login('email=bob%40test&name=+');
        expect(result?.headers.location).toBe('/');
        const token =
            readCookie(result?.headers['set-cookie']?.split(';')[0], 'sbwp_refresh') ?? '';
        const claims = decodeJwt(token);
        expect(claims).not.toHaveProperty('name');
        expect(claims.scopes).toEqual([]);
    });

    it.each(['', 'email=', 'email=nope', 'email=a%20b%40test'])(
        'rejects the sign-in form %j',
        async (body) => {
            expect((await login(body))?.status).toBe(400);
        }
    );

    it('issues an access token from the refresh cookie', async () => {
        const refresh = await signRefreshToken(keys, {
            sub: 's1',
            email: 'alice@test',
            scopes: ['events:guest']
        });
        const result = await handleAuth(
            app,
            keys,
            request({
                method: 'POST',
                path: '/api/auth/refresh',
                headers: { ...csrf, cookie: `sbwp_refresh=${refresh}` }
            })
        );
        expect(result?.status).toBe(200);
        const body = JSON.parse(result?.body ?? '') as { accessToken: string; expiresIn: number };
        expect(body.expiresIn).toBe(3600);
        expect(decodeJwt(body.accessToken)).toMatchObject({ sub: 's1', scope: 'events:guest' });
    });

    it.each([
        ['no cookie', {}],
        ['a bad cookie', { cookie: 'sbwp_refresh=junk' }]
    ])('refuses to refresh with %s', async (_, headers) => {
        const result = await handleAuth(
            app,
            keys,
            request({ method: 'POST', path: '/api/auth/refresh', headers: { ...csrf, ...headers } })
        );
        expect(result?.status).toBe(401);
    });

    it.each(['/api/auth/refresh', '/api/auth/logout'])(
        'requires the CSRF header on %s',
        async (path) => {
            const result = await handleAuth(
                app,
                keys,
                request({ method: 'POST', path, headers: { 'x-requested-with': 'XMLHttpRequest' } })
            );
            expect(result?.status).toBe(403);
        }
    );

    it('signs out by clearing the cookie', async () => {
        const result = await handleAuth(
            app,
            keys,
            request({ method: 'POST', path: '/api/auth/logout', headers: csrf })
        );
        expect(result?.status).toBe(200);
        expect(result?.headers['set-cookie']).toContain('sbwp_refresh=; ');
        expect(result?.headers['set-cookie']).toContain('Max-Age=0');
        expect(JSON.parse(result?.body ?? '')).toEqual({ redirectTo: '/' });
    });

    it('returns 404 for other auth paths', async () => {
        expect((await handleAuth(app, keys, request({ path: '/api/auth/other' })))?.status).toBe(
            404
        );
        expect((await handleAuth(app, keys, request({ path: '/api/auth' })))?.status).toBe(404);
        expect(
            (await handleAuth(app, keys, request({ method: 'GET', path: '/api/auth/refresh' })))
                ?.status
        ).toBe(404);
    });

    it('ignores everything else', async () => {
        expect(await handleAuth(app, keys, request({ path: '/api/events' }))).toBeUndefined();
        expect(await handleAuth(app, keys, request({ path: '/api/authors' }))).toBeUndefined();
    });
});
