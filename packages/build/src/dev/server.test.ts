import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureApp } from '../../test/fixture.js';
import { createLog } from '@sbwp/runtime';
import { startDevServer, type DevServer } from './server.js';

const servers: DevServer[] = [];
afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
});

const quiet = () => {
    const lines: string[] = [];
    return { lines, log: createLog({}, (line) => lines.push(line)) };
};

const start = async (files: Record<string, string> = {}, watch = false) => {
    const dir = await fixtureApp(files);
    const { log, lines } = quiet();
    const server = await startDevServer({
        appDir: dir,
        watch,
        log,
        wrapOptions: { db: () => ({ databaseName: 'events' }) as never, log }
    });
    servers.push(server);
    return { dir, server, lines };
};

const signIn = async (url: string, scopes: string[]) => {
    const form = new URLSearchParams({ email: 'alice@test' });
    for (const scope of scopes) {
        form.append('scope', scope);
    }
    const login = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        body: form,
        redirect: 'manual'
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const refresh = await fetch(`${url}/api/auth/refresh`, {
        method: 'POST',
        headers: { cookie, 'x-requested-with': 'sbwp' }
    });
    const { accessToken } = (await refresh.json()) as { accessToken: string };
    return { authorization: `Bearer ${accessToken}` };
};

describe('dev server', () => {
    it('serves public routes without a token', async () => {
        const { server } = await start();
        const res = await fetch(`${server.url}/api/health`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    it('signs in with the fake issuer and calls signed-in routes', async () => {
        const { server } = await start();
        const headers = await signIn(server.url, ['events:guest']);
        const res = await fetch(`${server.url}/api/events`, { headers });
        expect(await res.json()).toEqual([{ id: 'e1', viewer: 'alice@test' }]);
    });

    it('passes path params, query and body through', async () => {
        const { server } = await start();
        const headers = await signIn(server.url, ['events:guest', 'events:host']);
        expect(
            await (await fetch(`${server.url}/api/events/a%20b?x=1&x=2`, { headers })).json()
        ).toEqual({
            id: 'a b'
        });
        const created = await fetch(`${server.url}/api/events`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ title: 'Picnic' })
        });
        expect(created.status).toBe(201);
        expect(await created.json()).toEqual({ id: 'e2', title: 'Picnic' });
    });

    it('passes query parameters', async () => {
        const { server } = await start({
            'api/handlers/listEvents.ts':
                "import { defineHandler } from '@sbwp/runtime';\nimport { z } from 'zod';\nimport app from '../app.js';\nexport const handler = defineHandler(app, { query: z.object({ x: z.string() }) }, ({ query }, ctx) => ({ query, db: ctx.db.databaseName }));\n"
        });
        const headers = await signIn(server.url, ['events:guest']);
        expect(await (await fetch(`${server.url}/api/events?x=1&x=2`, { headers })).json()).toEqual(
            {
                query: { x: '1,2' },
                db: 'events'
            }
        );
    });

    it('returns 401 like API Gateway without a valid token', async () => {
        const { server } = await start();
        for (const headers of [
            {},
            { authorization: 'Bearer junk' },
            { authorization: 'Basic x' }
        ]) {
            const res = await fetch(`${server.url}/api/events`, { headers });
            expect(res.status).toBe(401);
            expect(await res.json()).toEqual({ message: 'Unauthorized' });
        }
    });

    it("returns 403 like API Gateway without any of the route's authorizer scopes", async () => {
        const { server } = await start();
        const headers = await signIn(server.url, ['events:guest']);
        const res = await fetch(`${server.url}/api/events`, {
            method: 'POST',
            headers,
            body: '{}'
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ message: 'Forbidden' });
    });

    it('lets the wrapper enforce the full scope set', async () => {
        const { server } = await start();
        const headers = await signIn(server.url, ['events:host']);
        const res = await fetch(`${server.url}/api/events`, {
            method: 'POST',
            headers,
            body: '{}'
        });
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: { code: 'forbidden', message: 'Forbidden' } });
    });

    it('returns 404 for unknown routes and paths outside /api', async () => {
        const { server } = await start();
        expect((await fetch(`${server.url}/api/nope`)).status).toBe(404);
        expect((await fetch(`${server.url}/`)).status).toBe(404);
    });

    it('serves the fake sign-in page', async () => {
        const { server } = await start();
        const res = await fetch(`${server.url}/api/auth/login`);
        expect(await res.text()).toContain('Dev sign-in');
    });

    it('reports routes whose handlers do not load or do not match', async () => {
        const { server, lines } = await start({
            'api/handlers/health.ts': "throw new Error('broken');\n",
            'api/handlers/listEvents.ts': 'export const handler = 1;\n'
        });
        const health = await fetch(`${server.url}/api/health`);
        expect(health.status).toBe(500);
        expect(((await health.json()) as { message: string }).message).toContain(
            "can't load ./handlers/health: broken"
        );
        const headers = await signIn(server.url, ['events:guest']);
        const list = await fetch(`${server.url}/api/events`, { headers });
        expect(((await list.json()) as { message: string }).message).toContain(
            'must export `handler`'
        );
        expect(lines.some((l) => l.includes('Route not loaded'))).toBe(true);
    });

    it('starts with a broken manifest, so a save can fix it', async () => {
        const dir = await fixtureApp({ 'api/app.ts': 'export default 1;\n' });
        const { log, lines } = quiet();
        const server = await startDevServer({ appDir: dir, watch: false, log });
        servers.push(server);
        expect(lines.some((l) => l.includes('Manifest not loaded'))).toBe(true);
        expect((await fetch(`${server.url}/api/health`)).status).toBe(500);
    });

    it('answers 500 while the manifest is broken, and recovers on reload', async () => {
        const { dir, server, lines } = await start();
        await writeFile(join(dir, 'api/app.ts'), 'export default 1;\n');
        await server.reload();
        expect(lines.some((l) => l.includes('Manifest not loaded'))).toBe(true);
        const res = await fetch(`${server.url}/api/health`);
        expect(res.status).toBe(500);
        expect(await res.text()).toContain('must export default defineApp');
        await writeFile(
            join(dir, 'api/app.ts'),
            "import { defineApp, route } from '@sbwp/runtime';\nexport default defineApp({ name: 'events', scopes: ['events:guest'], baseScope: 'events:guest', routes: [route('GET', '/health', './handlers/health', { public: true })] });\n"
        );
        await server.reload();
        expect((await fetch(`${server.url}/api/health`)).status).toBe(200);
    });

    it('reloads handlers when files change', async () => {
        const { dir, server } = await start({}, true);
        await writeFile(
            join(dir, 'api/handlers/health.ts'),
            "import { definePublicHandler } from '@sbwp/runtime';\nimport app from '../app.js';\nexport const handler = definePublicHandler(app, {}, () => ({ ok: 'reloaded' }));\n"
        );
        await vi.waitFor(
            async () =>
                expect(await (await fetch(`${server.url}/api/health`)).json()).toEqual({
                    ok: 'reloaded'
                }),
            { timeout: 5000, interval: 100 }
        );
    });

    it('uses default options', async () => {
        const dir = await fixtureApp();
        const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        const server = await startDevServer({ appDir: dir, host: '127.0.0.1' });
        servers.push(server);
        expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
        log.mockRestore();
    });

    it('fails to close twice', async () => {
        const { server } = await start();
        servers.pop();
        await server.close();
        await expect(server.close()).rejects.toThrow(/not running/);
    });

    it('fails when the port is taken', async () => {
        const { server } = await start();
        const port = Number(new URL(server.url).port);
        const dir = await fixtureApp();
        await expect(
            startDevServer({ appDir: dir, port, watch: false, log: quiet().log })
        ).rejects.toThrow(/EADDRINUSE/);
    });
});
