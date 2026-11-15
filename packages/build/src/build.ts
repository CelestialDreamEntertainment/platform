import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import type { AppManifest } from '@sbwp/runtime';
import { build } from 'esbuild';
import { checkHandler } from './check.js';
import { loadModule, WORK_DIR } from './load.js';
import { ESBUILD_TARGET, LAMBDA_RUNTIME } from './node-version.js';
import { routeEntry, routeId, ROUTES_JSON_VERSION, type RoutesJson } from './routes-json.js';
import { writeZip } from './zip.js';

export const DEFAULT_MANIFEST = 'api/app.ts';
export const DEFAULT_OUT_DIR = 'dist/api';

/** Packages the Lambda runtime provides, and optional Mongo driver add-ons the platform doesn't use. */
const EXTERNAL = [
    '@aws-sdk/*',
    'kerberos',
    'snappy',
    '@mongodb-js/zstd',
    'mongodb-client-encryption',
    'gcp-metadata',
    'socks'
];

/** Lets bundled CommonJS dependencies `require` Node built-ins from an ES module. */
const BANNER =
    "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);";

export class BuildError extends Error {
    constructor(readonly problems: readonly string[]) {
        super(`Build failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
        this.name = 'BuildError';
    }
}

export type BuildOptions = {
    readonly appDir: string;
    readonly manifest?: string;
    readonly outDir?: string;
};

const isManifest = (value: unknown): value is AppManifest =>
    typeof value === 'object' && value !== null && 'routes' in value && 'baseScope' in value;

/** Loads an app's manifest, which must be the module's default export. */
export const loadManifest = async (
    appDir: string,
    manifest = DEFAULT_MANIFEST
): Promise<AppManifest> => {
    const module = await loadModule(appDir, manifest);
    if (!isManifest(module.default)) {
        throw new BuildError([`${manifest} must export default defineApp({ ... })`]);
    }
    return module.default;
};

/** Entries live under .platform/, so the path to a handler always starts with `../`. */
const importPath = (from: string, to: string): string => relative(from, to).replaceAll('\\', '/');

/**
 * Builds an app's backend: checks every handler against its route, bundles one Lambda per route
 * with esbuild, zips each deterministically, and writes the routes JSON next to the zips.
 */
export const buildApi = async (options: BuildOptions): Promise<RoutesJson> => {
    const appDir = resolve(options.appDir);
    const manifestFile = options.manifest ?? DEFAULT_MANIFEST;
    const outDir = resolve(appDir, options.outDir ?? DEFAULT_OUT_DIR);
    const app = await loadManifest(appDir, manifestFile);
    const manifestDir = dirname(join(appDir, manifestFile));

    const ids = new Map<string, string>();
    const problems: string[] = [];
    for (const r of app.routes) {
        const id = routeId(r);
        const clash = ids.get(id);
        if (clash) {
            problems.push(
                `${r.method} ${r.path} and ${clash} both get the route ID "${id}"; rename one path`
            );
        }
        ids.set(id, `${r.method} ${r.path}`);
        const handlerFile = relative(appDir, join(manifestDir, r.handler));
        try {
            problems.push(...checkHandler(app, r, await loadModule(appDir, handlerFile)));
        } catch (error) {
            problems.push(
                `${r.method} ${r.path}: can't load ${r.handler}: ${(error as Error).message}`
            );
        }
    }
    if (problems.length > 0) {
        throw new BuildError(problems);
    }

    const work = join(appDir, WORK_DIR, 'api');
    await rm(work, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
    await mkdir(join(work, 'entries'), { recursive: true });
    await mkdir(outDir, { recursive: true });

    const entryPoints: Record<string, string> = {};
    for (const r of app.routes) {
        const id = routeId(r);
        const entry = join(work, 'entries', `${id}.ts`);
        const handlerPath = importPath(dirname(entry), join(manifestDir, r.handler));
        await writeFile(
            entry,
            [
                "import { wrap } from '@sbwp/runtime';",
                `import { handler as route } from ${JSON.stringify(handlerPath)};`,
                '',
                `export const handler = wrap(route, ${JSON.stringify({ method: r.method, path: r.path })});`,
                ''
            ].join('\n')
        );
        entryPoints[id] = entry;
    }

    await build({
        entryPoints,
        outdir: join(work, 'lambdas'),
        entryNames: '[name]/index',
        outExtension: { '.js': '.mjs' },
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: ESBUILD_TARGET,
        external: EXTERNAL,
        banner: { js: BANNER },
        sourcemap: true,
        sourcesContent: false,
        absWorkingDir: appDir,
        logLevel: 'silent'
    });

    const routes = [];
    for (const r of app.routes) {
        const id = routeId(r);
        const dir = join(work, 'lambdas', id);
        const zip = join(outDir, `${id}.zip`);
        await writeZip(zip, [
            { name: 'index.mjs', path: join(dir, 'index.mjs') },
            { name: 'index.mjs.map', path: join(dir, 'index.mjs.map') }
        ]);
        const sha256 = createHash('sha256')
            .update(await readFile(zip))
            .digest('base64');
        routes.push(routeEntry(app, r, sha256));
    }

    const json: RoutesJson = {
        version: ROUTES_JSON_VERSION,
        app: app.name,
        runtime: LAMBDA_RUNTIME,
        scopes: app.scopes,
        baseScope: app.baseScope,
        routes
    };
    await writeFile(join(outDir, 'routes.json'), `${JSON.stringify(json, null, 4)}\n`);
    return json;
};
