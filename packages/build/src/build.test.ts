import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ApiEvent, ApiResult } from '@sbwp/runtime';
import { describe, expect, it } from 'vitest';
import { fixtureApp } from '../test/fixture.js';
import { buildApi, BuildError, loadManifest } from './build.js';

const MANIFEST = "import { defineApp, route } from '@sbwp/runtime';\nexport default defineApp(";

const invoke = async (dir: string, id: string, event: Partial<ApiEvent>): Promise<ApiResult> => {
    const url = pathToFileURL(join(dir, '.platform/api/lambdas', id, 'index.mjs')).href;
    const lambda = (await import(url)) as { handler: (e: ApiEvent) => Promise<ApiResult> };
    return lambda.handler({ isBase64Encoded: false, requestContext: { requestId: 'r' }, ...event });
};

const guest = {
    authorizer: { jwt: { claims: { sub: 'u1', email: 'alice@test', scope: 'events:guest' } } }
};

describe('buildApi', () => {
    it('bundles one zip per route and writes the routes JSON', async () => {
        const dir = await fixtureApp();
        const json = await buildApi({ appDir: dir });
        expect(json).toMatchObject({
            version: 1,
            app: 'events',
            runtime: 'nodejs24.x',
            baseScope: 'events:guest'
        });
        expect(json.routes.map((r) => r.id)).toEqual([
            'get-events',
            'post-events',
            'get-events-by-id',
            'get-health'
        ]);
        expect(json.routes[1]).toMatchObject({
            scopes: ['events:guest', 'events:host'],
            authorizerScopes: ['events:host']
        });
        const files = await readdir(join(dir, 'dist/api'));
        expect(files.sort()).toEqual([
            'get-events-by-id.zip',
            'get-events.zip',
            'get-health.zip',
            'post-events.zip',
            'routes.json'
        ]);
        expect(JSON.parse(await readFile(join(dir, 'dist/api/routes.json'), 'utf8'))).toEqual(json);
    });

    it('produces working Lambda bundles', async () => {
        const dir = await fixtureApp();
        await buildApi({ appDir: dir });
        const list = await invoke(dir, 'get-events', {
            requestContext: { requestId: 'r', ...guest }
        });
        expect(JSON.parse(list.body ?? '')).toEqual([{ id: 'e1', viewer: 'alice@test' }]);
        const health = await invoke(dir, 'get-health', {});
        expect(health.statusCode).toBe(200);
        const create = await invoke(dir, 'post-events', {
            requestContext: { requestId: 'r', ...guest }
        });
        expect(create.statusCode).toBe(403);
    });

    it('is deterministic', async () => {
        const dir = await fixtureApp();
        const first = await buildApi({ appDir: dir });
        const second = await buildApi({ appDir: dir });
        expect(second.routes.map((r) => r.sha256)).toEqual(first.routes.map((r) => r.sha256));
    });

    it('honors a custom manifest and output directory', async () => {
        const dir = await fixtureApp({
            'backend/manifest.ts': `${MANIFEST}{ name: 'events', scopes: ['events:guest'], baseScope: 'events:guest', routes: [route('GET', '/health', '../api/handlers/health', { public: true })] });\n`
        });
        const json = await buildApi({
            appDir: dir,
            manifest: 'backend/manifest.ts',
            outDir: 'out'
        });
        expect(json.routes.map((r) => r.id)).toEqual(['get-health']);
        expect(await readdir(join(dir, 'out'))).toContain('get-health.zip');
    });

    it('fails when the manifest has no default export', async () => {
        const dir = await fixtureApp({ 'api/app.ts': 'export const app = 1;\n' });
        await expect(buildApi({ appDir: dir })).rejects.toThrow(
            'api/app.ts must export default defineApp({ ... })'
        );
    });

    it('fails when the default export is not a manifest', async () => {
        const dir = await fixtureApp({ 'api/app.ts': 'export default { routes: [] };\n' });
        await expect(loadManifest(dir)).rejects.toBeInstanceOf(BuildError);
    });

    it('reports every handler problem at once', async () => {
        const dir = await fixtureApp({
            'api/handlers/health.ts':
                "import { defineHandler } from '@sbwp/runtime';\nimport app from '../app.js';\nexport const handler = defineHandler(app, {}, () => 1);\n",
            'api/handlers/getEvent.ts': 'export const route = 1;\n'
        });
        const error = (await buildApi({ appDir: dir }).catch((e: unknown) => e)) as BuildError;
        expect(error).toBeInstanceOf(BuildError);
        expect(error.problems).toEqual([
            'GET /events/:id (./handlers/getEvent): the module must export `handler`, made with defineHandler or definePublicHandler',
            'GET /health (./handlers/health): the route is public, so use definePublicHandler'
        ]);
        expect(error.message).toContain('Build failed:\n  - GET /events/:id');
    });

    it('reports handlers that fail to load', async () => {
        const dir = await fixtureApp({
            'api/app.ts': `${MANIFEST}{ name: 'events', scopes: ['events:guest'], baseScope: 'events:guest', routes: [route('GET', '/x', './handlers/missing')] });\n`
        });
        const error = (await buildApi({ appDir: dir }).catch((e: unknown) => e)) as BuildError;
        expect(error.problems).toEqual([
            expect.stringMatching(/^GET \/x: can't load \.\/handlers\/missing: /)
        ]);
    });

    it('fails when two routes get the same ID', async () => {
        const dir = await fixtureApp({
            'api/app.ts': `${MANIFEST}{ name: 'events', scopes: ['events:guest'], baseScope: 'events:guest', routes: [route('GET', '/events/:id', './handlers/getEvent'), route('GET', '/events/by-id', './handlers/listEvents')] });\n`
        });
        const error = (await buildApi({ appDir: dir }).catch((e: unknown) => e)) as BuildError;
        expect(error.problems).toEqual([
            'GET /events/by-id and GET /events/:id both get the route ID "get-events-by-id"; rename one path'
        ]);
    });
});
