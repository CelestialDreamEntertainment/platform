import { defineApp, defineHandler, definePublicHandler, route } from '@sbwp/runtime';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkHandler } from './check.js';

const app = defineApp({
    name: 'events',
    scopes: ['events:guest'],
    baseScope: 'events:guest',
    routes: [
        route('GET', '/events/:id', './get'),
        route('GET', '/events', './list'),
        route('GET', '/health', './health', { public: true })
    ]
});
const other = defineApp({
    name: 'budget',
    scopes: ['budget:owner'],
    baseScope: 'budget:owner',
    routes: []
});
const [get, list, health] = app.routes;

const check = (r: typeof get | typeof list | typeof health, handler: unknown) =>
    checkHandler(app, r, { handler });
const withParams = (params: unknown) => defineHandler(app, { params } as never, () => undefined);

describe('checkHandler', () => {
    it('accepts a matching handler', () => {
        expect(check(get, withParams(z.object({ id: z.string() })))).toEqual([]);
        expect(
            check(
                list,
                defineHandler(app, {}, () => undefined)
            )
        ).toEqual([]);
        expect(
            check(
                health,
                definePublicHandler(app, {}, () => undefined)
            )
        ).toEqual([]);
    });

    // RACC for isHandler: each clause alone makes the export invalid.
    it.each<[string, unknown]>([
        ['nothing', undefined],
        ['null', null],
        ['a function', () => undefined],
        ['no handle', { public: false, schemas: {} }],
        ['a non-function handle', { handle: 1, public: false, schemas: {} }],
        ['no public flag', { handle: () => undefined, schemas: {} }],
        ['a non-boolean public flag', { handle: () => undefined, public: 'no', schemas: {} }],
        ['no schemas', { handle: () => undefined, public: false }]
    ])('rejects %s as the handler export', (_, handler) => {
        expect(check(list, handler)).toEqual([
            'GET /events (./list): the module must export `handler`, made with defineHandler or definePublicHandler'
        ]);
    });

    it("rejects another app's handler", () => {
        expect(
            check(
                list,
                defineHandler(other, {}, () => undefined)
            )
        ).toEqual(['GET /events (./list): the handler belongs to the "budget" app']);
    });

    it('rejects a signed-in handler on a public route', () => {
        expect(
            check(
                health,
                defineHandler(app, {}, () => undefined)
            )
        ).toEqual(['GET /health (./health): the route is public, so use definePublicHandler']);
    });

    it('rejects a public handler on a signed-in route', () => {
        expect(
            check(
                list,
                definePublicHandler(app, {}, () => undefined)
            )
        ).toEqual(['GET /events (./list): the route is not public, so use defineHandler']);
    });

    it('requires a params schema when the path has params', () => {
        expect(
            check(
                get,
                defineHandler(app, {}, () => undefined)
            )
        ).toEqual(['GET /events/:id (./get): declare a params schema with id']);
    });

    it('rejects params the path does not have', () => {
        expect(check(list, withParams(z.object({ id: z.string() })))).toEqual([
            'GET /events (./list): the params schema has [id], but the path has []'
        ]);
    });

    it('rejects misnamed params', () => {
        expect(check(get, withParams(z.object({ eventId: z.string() })))).toEqual([
            'GET /events/:id (./get): the params schema has [eventId], but the path has [id]'
        ]);
    });

    it.each([
        ['a non-object schema', z.string()],
        ['a schema whose shape is not an object', { shape: null }],
        ['a non-object', 'id']
    ])('rejects %s as the params schema', (_, schema) => {
        expect(check(get, withParams(schema))).toEqual([
            'GET /events/:id (./get): the params schema must be a z.object'
        ]);
    });

    it('reports every problem at once', () => {
        expect(
            check(
                health,
                defineHandler(other, {}, () => undefined)
            )
        ).toHaveLength(2);
    });
});
