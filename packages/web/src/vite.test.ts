import { describe, expect, it } from 'vitest';
import { buildInfo, platformVite } from './vite.js';

describe('platformVite', () => {
    it('proxies /api to the local API server', () => {
        const config = platformVite({}, { SBWP_API_PORT: '4999' });
        expect(config.server?.proxy).toEqual({ '/api': 'http://127.0.0.1:4999' });
        expect(config.server?.allowedHosts).toEqual(['.local.sabrinabea.com']);
    });

    it("defaults to Events' API port", () => {
        expect(platformVite({}, {}).server?.proxy).toEqual({ '/api': 'http://127.0.0.1:4102' });
    });

    it('builds web/ into dist/web with React and the build info', () => {
        const config = platformVite({}, { GITHUB_SHA: 'abc123' });
        expect(config.root).toBe('web');
        expect(config.build?.outDir).toBe('../dist/web');
        expect(config.plugins?.length).toBeGreaterThan(0);
        expect(config.define?.['import.meta.env.BUILD_SHA']).toBe('"abc123"');
    });

    it("merges the app's own config", () => {
        expect(platformVite({ build: { sourcemap: true } }).build).toMatchObject({
            sourcemap: true,
            outDir: '../dist/web'
        });
    });
});

describe('buildInfo', () => {
    it('uses the commit from CI, or local', () => {
        const now = new Date('2026-11-15T00:00:00Z');
        expect(buildInfo({ GITHUB_SHA: 'abc' }, now)).toEqual({
            sha: 'abc',
            time: '2026-11-15T00:00:00.000Z'
        });
        expect(buildInfo({}, now).sha).toBe('local');
        expect(buildInfo().time).toMatch(/^\d{4}-/);
    });
});
