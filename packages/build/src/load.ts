import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ESBUILD_TARGET } from './node-version.js';

/** Where the build keeps generated files inside an app. It's gitignored. */
export const WORK_DIR = '.platform';

let counter = 0;

/**
 * Imports a TypeScript module from an app. It's bundled to a temporary file inside the app, with
 * packages left external so they resolve from the app's own node_modules.
 */
export const loadModule = async (
    appDir: string,
    entry: string
): Promise<Record<string, unknown>> => {
    const dir = join(appDir, WORK_DIR, 'load');
    await mkdir(dir, { recursive: true });
    counter += 1;
    const outfile = join(dir, `module-${process.pid}-${counter}.mjs`);
    try {
        await build({
            entryPoints: [join(appDir, entry)],
            outfile,
            bundle: true,
            packages: 'external',
            platform: 'node',
            format: 'esm',
            target: ESBUILD_TARGET,
            logLevel: 'silent'
        });
        return (await import(pathToFileURL(outfile).href)) as Record<string, unknown>;
    } finally {
        await rm(outfile, { force: true });
    }
};
