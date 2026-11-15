import { loadManifest } from '../build.js';
import { portsFor } from './ports.js';
import { ensureMongo, startVite, type Child, type Run, type Spawn } from './processes.js';
import { startDevServer, type DevServer } from './server.js';

export type DevOptions = {
    readonly appDir: string;
    readonly manifest: string;
    readonly mongo: boolean;
    readonly web: boolean;
    readonly port?: number;
};

export type DevDeps = {
    readonly run?: Run;
    readonly spawn?: Spawn;
    readonly out: (line: string) => void;
};

export type Running = { readonly server: DevServer; readonly stop: () => Promise<void> };

/** `sbwp dev`: local Mongo, the local API server with fake sign-in, and Vite. */
export const runDev = async (options: DevOptions, deps: DevDeps): Promise<Running> => {
    const app = await loadManifest(options.appDir, options.manifest);
    const ports = portsFor(app.name);
    if (options.mongo) {
        deps.out(await ensureMongo(deps.run));
    }
    const server = await startDevServer({
        appDir: options.appDir,
        manifest: options.manifest,
        port: options.port ?? ports.api
    });
    deps.out(`API on ${server.url}/api (fake sign-in at ${server.url}/api/auth/login)`);
    let vite: Child | undefined;
    if (options.web) {
        vite = startVite(options.appDir, ports, deps.spawn);
        deps.out(
            `App on http://localhost:${ports.web}, or https://${app.name}.local.sabrinabea.com through Caddy`
        );
    }
    return {
        server,
        stop: async () => {
            vite?.kill();
            await server.close();
        }
    };
};
