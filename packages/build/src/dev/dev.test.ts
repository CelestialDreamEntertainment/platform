import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtureApp } from '../../test/fixture.js';
import { runDev, type Running } from './dev.js';

const running: Running[] = [];
afterEach(async () => {
    await Promise.all(running.splice(0).map((r) => r.stop()));
});

describe('runDev', () => {
    it('starts Mongo, the API server and Vite, and stops them', async () => {
        const dir = await fixtureApp();
        const out: string[] = [];
        const kill = vi.fn();
        const spawn = vi.fn(() => ({ kill }));
        const run = vi.fn(async () => ({ code: 0, stdout: 'true' }));
        const r = await runDev(
            { appDir: dir, manifest: 'api/app.ts', mongo: true, web: true, port: 0 },
            { run, spawn, out: (l) => out.push(l) }
        );
        expect(run).toHaveBeenCalled();
        expect(spawn).toHaveBeenCalledWith(
            'pnpm',
            expect.arrayContaining(['--port', '5102']),
            expect.anything()
        );
        expect(out[0]).toBe('Local Mongo is already running');
        expect(out[1]).toMatch(/^API on http:\/\/127\.0\.0\.1:\d+\/api/);
        expect(out[2]).toContain('https://events.local.sabrinabea.com');
        expect((await fetch(`${r.server.url}/api/health`)).status).toBe(200);
        await r.stop();
        expect(kill).toHaveBeenCalledOnce();
    });

    it("uses the app's fixed API port by default", async () => {
        const dir = await fixtureApp();
        const r = await runDev(
            { appDir: dir, manifest: 'api/app.ts', mongo: false, web: false },
            { out: () => undefined }
        );
        running.push(r);
        expect(r.server.url).toBe('http://127.0.0.1:4102');
    });

    it('can skip Mongo and Vite', async () => {
        const dir = await fixtureApp();
        const run = vi.fn();
        const spawn = vi.fn();
        const r = await runDev(
            { appDir: dir, manifest: 'api/app.ts', mongo: false, web: false, port: 0 },
            { run, spawn, out: () => undefined }
        );
        running.push(r);
        expect(run).not.toHaveBeenCalled();
        expect(spawn).not.toHaveBeenCalled();
    });
});
