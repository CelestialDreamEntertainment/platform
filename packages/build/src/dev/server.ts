import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import {
    createLog,
    wrap,
    type ApiEvent,
    type ApiResult,
    type AppManifest,
    type Log,
    type RouteDef,
    type WrapOptions
} from '@sbwp/runtime';
import { DEFAULT_MANIFEST, loadManifest } from '../build.js';
import { checkHandler } from '../check.js';
import { loadModule, WORK_DIR } from '../load.js';
import { authorizerScopes } from '../routes-json.js';
import { writeRoutesTypes } from '../types.js';
import { handleAuth } from './auth.js';
import { matchRoute, queryParameters } from './router.js';
import { loadKeys, verifyAccessToken, type Keys } from './tokens.js';

export type DevServerOptions = {
    readonly appDir: string;
    readonly manifest?: string;
    readonly port?: number;
    readonly host?: string;
    /** Reload handlers when files under the manifest's folder change. Default true. */
    readonly watch?: boolean;
    readonly log?: Log;
    /** Regenerate the routes types on every load. Default true. */
    readonly writeTypes?: boolean;
    /** Passed to the runtime wrapper, e.g. to give handlers a test database. */
    readonly wrapOptions?: WrapOptions;
};

export type DevServer = {
    readonly url: string;
    /** Reloads the manifest and every handler. */
    readonly reload: () => Promise<void>;
    readonly close: () => Promise<void>;
};

type Lambda = (event: ApiEvent) => Promise<ApiResult>;
type Loaded = { readonly app: AppManifest; readonly lambdas: Map<RouteDef, Lambda | string[]> };

const gatewayError = (status: number, message: string): ApiResult => ({
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
});

const readBody = async (req: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
};

/** Node joins repeated request headers into one string; only `set-cookie` is ever an array, and requests don't send it. */
const headersOf = (req: IncomingMessage): Record<string, string | undefined> =>
    req.headers as Record<string, string | undefined>;

/**
 * The local stand-in for API Gateway and the Lambdas. It serves the app's routes under /api,
 * verifies access tokens and checks the authorizer scopes the way API Gateway would, builds the
 * same event shape, and runs each handler through the real runtime wrapper. `/api/auth/*` is the
 * fake sign-in. JWT verification exists only here, never in the runtime.
 */
/** The dev server signs tokens with a fake issuer, so it only ever listens on loopback. */
export const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];

export const startDevServer = async (options: DevServerOptions): Promise<DevServer> => {
    if (options.host !== undefined && !LOOPBACK_HOSTS.includes(options.host)) {
        throw new Error(`The dev server only listens on localhost, not ${options.host}`);
    }
    const appDir = resolve(options.appDir);
    const manifestFile = options.manifest ?? DEFAULT_MANIFEST;
    const log = options.log ?? createLog({ app: 'dev-server' });
    const keys: Keys = await loadKeys(join(appDir, WORK_DIR, 'dev-signing-key.json'));

    const load = async (): Promise<Loaded> => {
        const app = await loadManifest(appDir, manifestFile);
        const manifestDir = dirname(join(appDir, manifestFile));
        const lambdas = new Map<RouteDef, Lambda | string[]>();
        for (const r of app.routes) {
            const file = relative(appDir, join(manifestDir, r.handler));
            try {
                const module = await loadModule(appDir, file);
                const problems = checkHandler(app, r, module);
                lambdas.set(
                    r,
                    problems.length > 0
                        ? problems
                        : wrap(module.handler as never, r, {
                              log: createLog({ app: app.name }),
                              ...options.wrapOptions
                          })
                );
            } catch (error) {
                lambdas.set(r, [
                    `${r.method} ${r.path}: can't load ${r.handler}: ${(error as Error).message}`
                ]);
            }
        }
        if (options.writeTypes ?? true) {
            const types = await writeRoutesTypes({ appDir, manifest: manifestFile, app });
            if (types.changed) {
                log.info(`Wrote ${types.file}`);
            }
        }
        for (const problems of lambdas.values()) {
            if (Array.isArray(problems)) {
                log.error('Route not loaded', { problems });
            }
        }
        return { app, lambdas };
    };

    let loaded: Promise<Loaded> = Promise.reject(new Error('Not loaded yet'));
    loaded.catch(() => undefined);

    const invoke = async (req: IncomingMessage, url: URL, body: string): Promise<ApiResult> => {
        const { app, lambdas } = await loaded;
        const match = matchRoute(app.routes, String(req.method), url.pathname);
        if (!match) {
            return gatewayError(404, 'Not Found');
        }
        const { route, params } = match;
        let claims: Awaited<ReturnType<typeof verifyAccessToken>>;
        if (!route.public) {
            const header = req.headers.authorization;
            const token = header?.startsWith('Bearer ')
                ? header.slice('Bearer '.length)
                : undefined;
            claims = token ? await verifyAccessToken(keys, token) : undefined;
            if (!claims) {
                return gatewayError(401, 'Unauthorized');
            }
            const granted = String(claims.scope).split(' ');
            if (!authorizerScopes(app, route).some((scope) => granted.includes(scope))) {
                return gatewayError(403, 'Forbidden');
            }
        }
        const lambda = lambdas.get(route);
        if (typeof lambda !== 'function') {
            return gatewayError(500, `Route not loaded: ${(lambda as string[]).join('; ')}`);
        }
        const query = queryParameters(url.searchParams);
        return lambda({
            ...(body ? { body } : {}),
            isBase64Encoded: false,
            ...(Object.keys(params).length > 0 ? { pathParameters: params } : {}),
            ...(query ? { queryStringParameters: query } : {}),
            requestContext: {
                requestId: randomUUID(),
                ...(claims ? { authorizer: { jwt: { claims } } } : {})
            }
        });
    };

    const respond = (
        res: ServerResponse,
        status: number,
        headers: Record<string, string>,
        body?: string
    ) => {
        res.writeHead(status, headers);
        res.end(body);
    };

    const server = createServer((req, res) => {
        const url = new URL(String(req.url), 'http://localhost');
        void (async () => {
            try {
                const body = await readBody(req);
                const { app } = await loaded;
                const auth = await handleAuth(app, keys, {
                    method: String(req.method),
                    path: url.pathname,
                    query: url.searchParams,
                    headers: headersOf(req),
                    body
                });
                if (auth) {
                    respond(res, auth.status, { ...auth.headers }, auth.body);
                    return;
                }
                const result = await invoke(req, url, body);
                respond(res, result.statusCode, { ...result.headers }, result.body);
            } catch (error) {
                log.error('Dev server error', { error });
                respond(
                    res,
                    500,
                    { 'content-type': 'text/plain' },
                    `Dev server error: ${(error as Error).message}`
                );
            }
        })();
    });

    let watcher: FSWatcher | undefined;
    let timer: NodeJS.Timeout | undefined;
    const reload = async (): Promise<void> => {
        loaded = load();
        loaded.catch(() => undefined);
        await loaded.then(
            () => undefined,
            (error: unknown) => log.error('Manifest not loaded', { error })
        );
    };
    if (options.watch ?? true) {
        watcher = watch(dirname(join(appDir, manifestFile)), { recursive: true }, () => {
            clearTimeout(timer);
            timer = setTimeout(() => void reload(), 100);
        });
    }

    await reload();
    await new Promise<void>((done, fail) => {
        server.once('error', fail);
        server.listen(options.port ?? 0, options.host ?? '127.0.0.1', done);
    });
    const { port } = server.address() as AddressInfo;

    return {
        url: `http://${options.host ?? '127.0.0.1'}:${port}`,
        reload,
        close: async () => {
            clearTimeout(timer);
            watcher?.close();
            await new Promise<void>((done, fail) =>
                server.close((error) => (error ? fail(error) : done()))
            );
        }
    };
};
