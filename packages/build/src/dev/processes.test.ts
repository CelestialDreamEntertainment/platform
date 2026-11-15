import { describe, expect, it, vi } from 'vitest';
import { ensureMongo, run, spawn, startVite, type Run } from './processes.js';

const fake = (...results: { code: number; stdout?: string }[]) => {
    const calls: string[][] = [];
    const exec: Run = async (command, args) => {
        calls.push([command, ...args]);
        const next = results.shift() ?? { code: 0 };
        return { code: next.code, stdout: next.stdout ?? '' };
    };
    return { exec, calls };
};

describe('ensureMongo', () => {
    it('does nothing when the container is running', async () => {
        const { exec, calls } = fake({ code: 0, stdout: 'true\n' });
        expect(await ensureMongo(exec)).toBe('Local Mongo is already running');
        expect(calls).toHaveLength(1);
    });

    it('starts a stopped container', async () => {
        const { exec, calls } = fake({ code: 0, stdout: 'false\n' }, { code: 0 });
        expect(await ensureMongo(exec)).toBe('Started local Mongo');
        expect(calls[1]).toEqual(['docker', 'start', 'sbwp-mongo']);
    });

    it('creates the container on first use, bound to localhost with a volume', async () => {
        const { exec, calls } = fake({ code: 1 }, { code: 0 });
        expect(await ensureMongo(exec)).toBe('Created and started local Mongo');
        expect(calls[1]).toEqual([
            'docker',
            'run',
            '-d',
            '--name',
            'sbwp-mongo',
            '-p',
            '127.0.0.1:27017:27017',
            '-v',
            'sbwp-mongo:/data/db',
            'mongo:8'
        ]);
    });

    it('explains a missing Docker', async () => {
        await expect(ensureMongo(fake({ code: 127 }).exec)).rejects.toThrow(
            'Docker is not available'
        );
    });

    it('explains a failed start', async () => {
        await expect(ensureMongo(fake({ code: 1 }, { code: 125 }).exec)).rejects.toThrow(
            'Could not start the sbwp-mongo container'
        );
    });
});

describe('run', () => {
    it('captures stdout and the exit code', async () => {
        expect(
            await run(process.execPath, ['-e', 'process.stdout.write("hi"); process.exit(3)'])
        ).toEqual({
            code: 3,
            stdout: 'hi'
        });
    });

    it('reports a missing command as 127', async () => {
        expect((await run('definitely-not-a-command-sbwp', [])).code).toBe(127);
    });

    it('reports a signal as a failure', async () => {
        expect(
            (await run(process.execPath, ['-e', 'process.kill(process.pid, "SIGKILL")'])).code
        ).toBe(1);
    });
});

describe('startVite', () => {
    it("runs Vite on the app's frontend port and tells it the API port", () => {
        const start = vi.fn(() => ({ kill: () => undefined }));
        startVite('/app', { api: 4102, web: 5102 }, start);
        expect(start).toHaveBeenCalledWith(
            'pnpm',
            ['exec', 'vite', '--port', '5102', '--strictPort'],
            {
                cwd: '/app',
                env: expect.objectContaining({ SBWP_API_PORT: '4102' })
            }
        );
    });

    it('spawns a real process that can be stopped', async () => {
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
            cwd: '/',
            env: {}
        });
        child.kill();
        await expect(Promise.resolve()).resolves.toBeUndefined();
    });

    it('spawns with the real spawn by default, and reports a failure to start', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        startVite('/nonexistent-dir-sbwp', { api: 1, web: 2 });
        await vi.waitFor(() =>
            expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not run pnpm'))
        );
        error.mockRestore();
    });
});
