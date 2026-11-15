import { describe, expectTypeOf, it } from 'vitest';
import { defineApp, route, type AppScope } from './manifest.js';

const app = defineApp({
    name: 'events',
    scopes: ['events:guest', 'events:host'],
    baseScope: 'events:guest',
    routes: [
        route('GET', '/events', './h'),
        route('POST', '/events', './h', { scopes: ['events:host'] }),
        route('GET', '/health', './h', { public: true })
    ]
});

describe('defineApp types', () => {
    it('infers literal scopes without as const', () => {
        expectTypeOf<AppScope<typeof app>>().toEqualTypeOf<'events:guest' | 'events:host'>();
        expectTypeOf(app.name).toEqualTypeOf<'events'>();
    });

    it('infers each route literally', () => {
        expectTypeOf(app.routes[1].method).toEqualTypeOf<'POST'>();
        expectTypeOf(app.routes[1].path).toEqualTypeOf<'/events'>();
        expectTypeOf(app.routes[1].scopes).toEqualTypeOf<readonly 'events:host'[]>();
        expectTypeOf(app.routes[2].public).toEqualTypeOf<true>();
        expectTypeOf(app.routes[0].public).toEqualTypeOf<false>();
    });

    it('rejects an undeclared base scope', () => {
        defineApp({
            name: 'events',
            scopes: ['events:guest'],
            // @ts-expect-error not a declared scope
            baseScope: 'events:gust',
            routes: []
        });
    });

    it('rejects an undeclared route scope', () => {
        defineApp({
            name: 'events',
            scopes: ['events:guest'],
            baseScope: 'events:guest',
            // @ts-expect-error not a declared scope
            routes: [route('POST', '/events', './h', { scopes: ['events:hots'] })]
        });
    });

    it('requires at least one scope', () => {
        defineApp({
            name: 'events',
            // @ts-expect-error scopes cannot be empty
            scopes: [],
            baseScope: 'events:guest',
            routes: []
        });
    });

    it('rejects paths that do not start with a slash', () => {
        // @ts-expect-error paths start with /
        route('GET', 'events', './h');
    });

    it('rejects scopes on public routes', () => {
        // @ts-expect-error public routes have no scopes
        route('GET', '/health', './h', { public: true, scopes: ['events:guest'] });
    });

    it('rejects unknown methods', () => {
        // @ts-expect-error not an HTTP method the platform supports
        route('HEAD', '/events', './h');
    });
});
