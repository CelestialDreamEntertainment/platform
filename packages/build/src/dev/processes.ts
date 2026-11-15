import { spawn as nodeSpawn } from 'node:child_process';

export const MONGO_CONTAINER = 'sbwp-mongo';
export const MONGO_IMAGE = 'mongo:8';

export type RunResult = { readonly code: number; readonly stdout: string };
export type Run = (command: string, args: readonly string[]) => Promise<RunResult>;

export type Child = { readonly kill: () => void };
export type Spawn = (
    command: string,
    args: readonly string[],
    options: { readonly cwd: string; readonly env: NodeJS.ProcessEnv }
) => Child;

export const run: Run = (command, args) =>
    new Promise((done) => {
        const child = nodeSpawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
        let stdout = '';
        child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
        child.on('error', () => done({ code: 127, stdout }));
        child.on('close', (code) => done({ code: code ?? 1, stdout }));
    });

export const spawn: Spawn = (command, args, options) => {
    const child = nodeSpawn(command, args, { ...options, stdio: 'inherit' });
    child.on('error', (error) => console.error(`Could not run ${command}: ${error.message}`));
    return { kill: () => child.kill() };
};

/**
 * Makes sure the shared local Mongo container is running, creating it on first use. Data lives in
 * a named Docker volume, so it survives restarts.
 */
export const ensureMongo = async (exec: Run = run): Promise<string> => {
    const inspect = await exec('docker', ['inspect', '-f', '{{.State.Running}}', MONGO_CONTAINER]);
    if (inspect.code === 127) {
        throw new Error('Docker is not available. Start OrbStack (or Docker), or pass --no-mongo.');
    }
    if (inspect.code === 0 && inspect.stdout.trim() === 'true') {
        return 'Local Mongo is already running';
    }
    const started =
        inspect.code === 0
            ? await exec('docker', ['start', MONGO_CONTAINER])
            : await exec('docker', [
                  'run',
                  '-d',
                  '--name',
                  MONGO_CONTAINER,
                  '-p',
                  '127.0.0.1:27017:27017',
                  '-v',
                  `${MONGO_CONTAINER}:/data/db`,
                  MONGO_IMAGE
              ]);
    if (started.code !== 0) {
        throw new Error(`Could not start the ${MONGO_CONTAINER} container. Is Docker running?`);
    }
    return inspect.code === 0 ? 'Started local Mongo' : 'Created and started local Mongo';
};

/** Starts Vite on the app's frontend port. The platform's Vite preset proxies /api to `SBWP_API_PORT`. */
export const startVite = (
    appDir: string,
    ports: { api: number; web: number },
    start: Spawn = spawn
): Child =>
    start('pnpm', ['exec', 'vite', '--port', String(ports.web), '--strictPort'], {
        cwd: appDir,
        env: { ...process.env, SBWP_API_PORT: String(ports.api) }
    });
