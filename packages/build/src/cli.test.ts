import { describe, expect, it } from 'vitest';
import { fixtureApp } from '../test/fixture.js';
import { run, type Io } from './cli.js';

const io = (cwd: string, nodeVersion = '24.22.3') => {
    const out: string[] = [];
    const err: string[] = [];
    const value: Io = { cwd, nodeVersion, out: (l) => out.push(l), err: (l) => err.push(l) };
    return { io: value, out, err };
};

describe('sbwp CLI', () => {
    it('builds the app', async () => {
        const dir = await fixtureApp();
        const t = io(dir);
        expect(await run(['build'], t.io)).toBe(0);
        expect(t.out).toEqual([`Built 4 routes for events into ${dir}/dist/api`]);
    });

    it('passes the manifest and output options through', async () => {
        const dir = await fixtureApp();
        const t = io(dir);
        expect(await run(['build', '--manifest', 'api/app.ts', '--out', 'build'], t.io)).toBe(0);
        expect(t.out[0]).toContain(`${dir}/build`);
    });

    it('prints build problems and exits 1', async () => {
        const dir = await fixtureApp({ 'api/app.ts': 'export default 1;\n' });
        const t = io(dir);
        expect(await run(['build'], t.io)).toBe(1);
        expect(t.err[0]).toContain('must export default defineApp');
    });

    it('rethrows unexpected errors', async () => {
        const dir = await fixtureApp({ 'api/app.ts': 'this is not typescript' });
        await expect(run(['build'], io(dir).io)).rejects.toThrow();
    });

    it('refuses to build on the wrong Node version', async () => {
        const dir = await fixtureApp();
        const t = io(dir, '22.1.0');
        expect(await run(['build'], t.io)).toBe(1);
        expect(t.err[0]).toMatch(/needs Node 24/);
    });

    it('checks the Node version', async () => {
        const dir = await fixtureApp();
        expect(await run(['check-node'], io(dir).io)).toBe(0);
        expect(await run(['check-node'], io(dir, '22.1.0').io)).toBe(1);
    });

    it("checks the app's mise.toml pin", async () => {
        const dir = await fixtureApp({ 'mise.toml': '[tools]\nnode = "22"\n' });
        const t = io(dir);
        expect(await run(['check-node'], t.io)).toBe(1);
        expect(t.err[0]).toMatch(/mise.toml pins Node 22/);
    });

    it('works without a mise.toml', async () => {
        expect(await run(['check-node'], io('/nonexistent').io)).toBe(0);
    });

    it('prints help and exits 0', async () => {
        const t = io('/');
        expect(await run(['--help'], t.io)).toBe(0);
        expect(t.out.join('\n')).toContain('Usage: sbwp');
    });

    it('exits non-zero on an unknown command', async () => {
        const t = io('/');
        expect(await run(['deploy'], t.io)).toBe(1);
        expect(t.err.join('\n')).toContain("unknown command 'deploy'");
    });
});
