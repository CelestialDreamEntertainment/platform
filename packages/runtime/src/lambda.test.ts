import type { Db } from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { app } from '../test/app.js';
import { NotFoundError } from './errors.js';
import { defineHandler, definePublicHandler } from './handler.js';
import { wrap, type ApiEvent } from './lambda.js';
import { createLog } from './log.js';
import { created, noContent } from './reply.js';

const guest = { sub: 'u1', email: 'alice@test', scope: 'events:guest' };
const host = { ...guest, scope: 'events:guest events:host' };

const event = (
    overrides: Partial<ApiEvent> & { claims?: Record<string, unknown> } = {}
): ApiEvent => {
    const { claims, ...rest } = overrides;
    return {
        isBase64Encoded: false,
        requestContext: {
            requestId: 'req-1',
            ...(claims ? { authorizer: { jwt: { claims: claims as never } } } : {})
        },
        ...rest
    };
};

const silent = () => {
    const lines: string[] = [];
    return { lines, log: createLog({}, (line) => lines.push(line)) };
};

const body = (result: { body?: string }) => JSON.parse(result.body ?? 'null') as unknown;

const list = defineHandler(app, {}, ({ user }) => ({ email: user.email, scopes: user.scopes }));

describe('wrap', () => {
    describe('setup', () => {
        it('fails for a route that is not in the manifest', () => {
            expect(() => wrap(list, { method: 'DELETE', path: '/events' })).toThrow(
                'DELETE /events is not in the events manifest'
            );
        });

        it('fails when a public route has a signed-in handler', () => {
            expect(() => wrap(list, { method: 'GET', path: '/health' })).toThrow(
                'GET /health is public, but its handler is not public'
            );
        });

        it('fails when a signed-in route has a public handler', () => {
            const health = definePublicHandler(app, {}, () => 'ok');
            expect(() => wrap(health, { method: 'GET', path: '/events' })).toThrow(
                'GET /events is not public, but its handler is public'
            );
        });
    });

    describe('auth', () => {
        const run = (
            claims?: Record<string, unknown>,
            path: '/events' = '/events',
            method: 'GET' | 'POST' = 'GET'
        ) => wrap(list, { method, path })(event(claims ? { claims } : {}));

        it('passes the user to the handler', async () => {
            const result = await run(guest);
            expect(result.statusCode).toBe(200);
            expect(body(result)).toEqual({ email: 'alice@test', scopes: ['events:guest'] });
        });

        it('returns 401 without an authorizer', async () => {
            const result = await run();
            expect(result.statusCode).toBe(401);
            expect(body(result)).toEqual({
                error: { code: 'unauthorized', message: 'Sign in required' }
            });
        });

        it('returns 401 when the claims do not identify a user', async () => {
            expect((await run({ scope: 'events:guest' })).statusCode).toBe(401);
        });

        it('returns 403 without the base scope', async () => {
            expect((await run({ ...guest, scope: 'events:host' })).statusCode).toBe(403);
        });

        it('returns 403 without a route scope', async () => {
            expect((await run(guest, '/events', 'POST')).statusCode).toBe(403);
        });

        it('allows a user with every required scope', async () => {
            expect((await run(host, '/events', 'POST')).statusCode).toBe(200);
        });

        it('reads non-string claims', async () => {
            const result = await run({
                ...guest,
                scope: ['events:guest', 'events:host'],
                exp: 123
            });
            expect(body(result)).toMatchObject({ scopes: ['events:guest', 'events:host'] });
        });

        it('runs public handlers without claims and without a user', async () => {
            const health = definePublicHandler(app, {}, (request) => ({
                hasUser: 'user' in request
            }));
            const result = await wrap(health, { method: 'GET', path: '/health' })(
                event({ claims: guest })
            );
            expect(body(result)).toEqual({ hasUser: false });
        });
    });

    describe('inputs', () => {
        const get = defineHandler(
            app,
            {
                params: z.object({ id: z.string().length(3) }),
                query: z.object({ page: z.coerce.number().int().optional() }),
                body: z.object({ title: z.string() }).optional()
            },
            ({ params, query, body }) => ({ params, query, body })
        );
        const run = (overrides: Partial<ApiEvent>) =>
            wrap(get, { method: 'GET', path: '/events/:id' })(
                event({ claims: guest, pathParameters: { id: 'abc' }, ...overrides })
            );

        it('parses params, query and body', async () => {
            const result = await run({
                queryStringParameters: { page: '2', ignored: undefined },
                body: JSON.stringify({ title: 'Picnic' })
            });
            expect(body(result)).toEqual({
                params: { id: 'abc' },
                query: { page: 2 },
                body: { title: 'Picnic' }
            });
        });

        it('decodes base64 bodies', async () => {
            const encoded = Buffer.from(JSON.stringify({ title: 'Picnic' })).toString('base64');
            const result = await run({ body: encoded, isBase64Encoded: true });
            expect(body(result)).toMatchObject({ body: { title: 'Picnic' } });
        });

        // RACC for `body === undefined || body === ''`: each clause alone means "no body".
        it.each([
            ['missing', undefined],
            ['empty', '']
        ])('treats a %s body as undefined', async (_, raw) => {
            const result = await run(raw === undefined ? {} : { body: raw });
            expect(result.statusCode).toBe(200);
            expect(body(result)).not.toHaveProperty('body');
        });

        it('returns 400 for invalid params', async () => {
            const result = await run({ pathParameters: { id: 'toolong' } });
            expect(result.statusCode).toBe(400);
            expect(body(result)).toEqual({
                error: {
                    code: 'bad_request',
                    message: 'Invalid path parameters',
                    issues: [{ path: 'id', message: expect.any(String) }]
                }
            });
        });

        it('returns 400 for an invalid query', async () => {
            const result = await run({ queryStringParameters: { page: 'x' } });
            expect(body(result)).toMatchObject({ error: { message: 'Invalid query' } });
        });

        it('returns 400 for an invalid body', async () => {
            const result = await run({ body: JSON.stringify({ title: 3 }) });
            expect(body(result)).toMatchObject({
                error: { message: 'Invalid body', issues: [{ path: 'title' }] }
            });
        });

        it('returns 400 for malformed JSON', async () => {
            const result = await run({ body: '{' });
            expect(result.statusCode).toBe(400);
            expect(body(result)).toEqual({
                error: { code: 'bad_request', message: 'Invalid JSON body' }
            });
        });

        it('ignores inputs a handler does not declare', async () => {
            const result = await wrap(list, { method: 'GET', path: '/events' })(
                event({ claims: guest, body: '{', queryStringParameters: { a: 'b' } })
            );
            expect(result.statusCode).toBe(200);
        });

        it('gives undeclared params and query as empty objects', async () => {
            const echo = defineHandler(app, {}, ({ params, query, body }) => ({
                params,
                query,
                body
            }));
            const result = await wrap(echo, { method: 'GET', path: '/events' })(
                event({ claims: guest })
            );
            expect(body(result)).toEqual({ params: {}, query: {} });
        });
    });

    describe('responses', () => {
        const respond = async (value: unknown) => {
            const handler = defineHandler(app, {}, () => value);
            return wrap(handler, { method: 'GET', path: '/events' })(event({ claims: guest }));
        };

        it('returns plain values as 200 JSON', async () => {
            expect(await respond([1, 2])).toEqual({
                statusCode: 200,
                headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
                body: '[1,2]'
            });
        });

        it('uses the status of a reply', async () => {
            const result = await respond(created({ id: 'e1' }));
            expect(result.statusCode).toBe(201);
            expect(body(result)).toEqual({ id: 'e1' });
        });

        it('sends no body for a reply without one', async () => {
            const result = await respond(noContent());
            expect(result.statusCode).toBe(204);
            expect(result).not.toHaveProperty('body');
        });

        it('returns 204 when the handler returns nothing', async () => {
            const result = await respond(undefined);
            expect(result.statusCode).toBe(204);
            expect(result).not.toHaveProperty('body');
        });

        it('returns null as JSON', async () => {
            expect((await respond(null)).body).toBe('null');
        });

        it('turns platform errors into their status', async () => {
            const handler = defineHandler(app, {}, () => {
                throw new NotFoundError('No such event');
            });
            const result = await wrap(handler, { method: 'GET', path: '/events' })(
                event({ claims: guest })
            );
            expect(result.statusCode).toBe(404);
            expect(body(result)).toEqual({
                error: { code: 'not_found', message: 'No such event' }
            });
        });

        it('hides and logs unexpected errors', async () => {
            const { lines, log } = silent();
            const handler = defineHandler(app, {}, async () => {
                throw new Error('secret detail');
            });
            const result = await wrap(
                handler,
                { method: 'GET', path: '/events' },
                { log }
            )(event({ claims: guest }));
            expect(result.statusCode).toBe(500);
            expect(result.body).not.toContain('secret');
            expect(body(result)).toEqual({
                error: { code: 'internal', message: 'Internal server error' }
            });
            expect(JSON.parse(lines[0] ?? '')).toMatchObject({
                level: 'error',
                requestId: 'req-1',
                route: 'GET /events',
                error: { message: 'secret detail' }
            });
        });

        it('logs to the console by default', async () => {
            const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
            const handler = defineHandler(app, {}, () => {
                throw new Error('boom');
            });
            await wrap(handler, { method: 'GET', path: '/events' })(event({ claims: guest }));
            expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toMatchObject({ app: 'events' });
            spy.mockRestore();
        });
    });

    describe('context', () => {
        it("opens the app's database only when used", async () => {
            const fake = { databaseName: 'events' } as Db;
            const open = vi.fn(() => fake);
            const lazy = defineHandler(app, {}, () => 'ok');
            const eager = defineHandler(app, {}, (_, ctx) => ctx.db.databaseName);
            await wrap(
                lazy,
                { method: 'GET', path: '/events' },
                { db: open }
            )(event({ claims: guest }));
            expect(open).not.toHaveBeenCalled();
            const result = await wrap(
                eager,
                { method: 'GET', path: '/events' },
                { db: open }
            )(event({ claims: guest }));
            expect(open).toHaveBeenCalledWith('events');
            expect(body(result)).toBe('events');
        });

        it('uses the shared Mongo client by default', async () => {
            const handler = defineHandler(app, {}, (_, ctx) => ctx.db.databaseName);
            const result = await wrap(handler, { method: 'GET', path: '/events' })(
                event({ claims: guest })
            );
            expect(body(result)).toBe('events');
        });

        it('gives handlers the secrets', async () => {
            const secrets = { get: async (name: string) => `secret:${name}` };
            const handler = defineHandler(app, {}, (_, ctx) => ctx.secrets.get('key'));
            const result = await wrap(
                handler,
                { method: 'GET', path: '/events' },
                { secrets }
            )(event({ claims: guest }));
            expect(body(result)).toBe('secret:key');
        });

        it('gives handlers a logger tagged with the request', async () => {
            const { lines, log } = silent();
            const handler = defineHandler(app, {}, (_, ctx) => {
                ctx.log.info('listing');
            });
            await wrap(
                handler,
                { method: 'GET', path: '/events' },
                { log }
            )(event({ claims: guest }));
            expect(JSON.parse(lines[0] ?? '')).toMatchObject({
                message: 'listing',
                requestId: 'req-1'
            });
        });
    });
});
