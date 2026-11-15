import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import { buildApi, BuildError, DEFAULT_MANIFEST, DEFAULT_OUT_DIR } from './build.js';
import { runDev, type DevDeps, type Running } from './dev/dev.js';
import { checkNodeVersion } from './node-version.js';
import { writeRoutesTypes } from './types.js';

export type Io = {
    readonly cwd: string;
    readonly nodeVersion: string;
    readonly out: (line: string) => void;
    readonly err: (line: string) => void;
    /** Overrides for `dev`'s process handling, for tests. */
    readonly dev?: Omit<DevDeps, 'out'> & { readonly started?: (running: Running) => void };
};

/** Stops the dev processes cleanly on Ctrl-C. */
const stopOnSignal = (running: Running): void => {
    const stop = () => void running.stop().then(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
};

const readMise = (appDir: string): string | undefined => {
    const file = join(appDir, 'mise.toml');
    return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

/** Runs the `sbwp` CLI and returns the exit code. */
export const run = async (argv: readonly string[], io: Io): Promise<number> => {
    const program = new Command('sbwp')
        .description('Build and run apps on the platform')
        .exitOverride()
        .configureOutput({
            writeOut: (s) => io.out(s.trimEnd()),
            writeErr: (s) => io.err(s.trimEnd())
        });

    const nodeOk = (appDir: string): boolean => {
        const problem = checkNodeVersion(io.nodeVersion, readMise(appDir));
        if (problem) {
            io.err(problem);
        }
        return !problem;
    };

    let code = 0;
    program
        .command('check-node')
        .description("Check that Node and the app's mise.toml match the platform's Node version")
        .action(() => {
            code = nodeOk(io.cwd) ? 0 : 1;
        });
    program
        .command('build')
        .description('Bundle one Lambda per route and write the routes JSON')
        .option('--manifest <file>', 'the routes manifest', DEFAULT_MANIFEST)
        .option('--out <dir>', 'where to write the zips and routes JSON', DEFAULT_OUT_DIR)
        .action(async (options: { manifest: string; out: string }) => {
            if (!nodeOk(io.cwd)) {
                code = 1;
                return;
            }
            try {
                const json = await buildApi({
                    appDir: io.cwd,
                    manifest: options.manifest,
                    outDir: options.out
                });
                io.out(
                    `Built ${json.routes.length} routes for ${json.app} into ${resolve(io.cwd, options.out)}`
                );
            } catch (error) {
                if (!(error instanceof BuildError)) {
                    throw error;
                }
                io.err(error.message);
                code = 1;
            }
        });

    program
        .command('types')
        .description('Generate the Routes type for the typed API client, next to the manifest')
        .option('--manifest <file>', 'the routes manifest', DEFAULT_MANIFEST)
        .option('--check', 'fail if the committed file is out of date, instead of writing it')
        .action(async (options: { manifest: string; check?: boolean }) => {
            try {
                const result = await writeRoutesTypes({ appDir: io.cwd, ...options });
                if (options.check && result.changed) {
                    io.err(`${result.file} is out of date. Run \`sbwp types\` and commit it.`);
                    code = 1;
                } else {
                    io.out(
                        result.changed ? `Wrote ${result.file}` : `${result.file} is up to date`
                    );
                }
            } catch (error) {
                if (!(error instanceof BuildError)) {
                    throw error;
                }
                io.err(error.message);
                code = 1;
            }
        });

    program
        .command('dev')
        .description('Run local Mongo, the local API with fake sign-in, and Vite')
        .option('--manifest <file>', 'the routes manifest', DEFAULT_MANIFEST)
        .option('--port <port>', "the API port (default: the app's fixed port)", (v) => Number(v))
        .option('--no-mongo', "don't start the local Mongo container")
        .option('--no-web', "don't start Vite")
        .action(
            async (options: { manifest: string; port?: number; mongo: boolean; web: boolean }) => {
                if (!nodeOk(io.cwd)) {
                    code = 1;
                    return;
                }
                try {
                    const running = await runDev(
                        { appDir: io.cwd, ...options },
                        { ...io.dev, out: io.out }
                    );
                    (io.dev?.started ?? stopOnSignal)(running);
                } catch (error) {
                    io.err((error as Error).message);
                    code = 1;
                }
            }
        );

    try {
        await program.parseAsync(argv, { from: 'user' });
    } catch (error) {
        if (error instanceof CommanderError) {
            return error.exitCode;
        }
        throw error;
    }
    return code;
};
