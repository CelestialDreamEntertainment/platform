import { describe, expect, it } from 'vitest';
import { defineApp, pathParams, requiredScopes, route } from './manifest.js';

const valid = {
    name: 'events',
    scopes: ['events:guest', 'events:host'],
    baseScope: 'events:guest',
    routes: []
} as const;

// Builds a manifest without the compile-time checks, to test the load-time ones.
const load = (overrides: Record<string, unknown>) => () =>
    defineApp({ ...valid, ...overrides } as unknown as Parameters<typeof defineApp>[0]);

describe('route', () => {
    it('defaults to a signed-in route with no extra scopes', () => {
        expect(route('GET', '/events', './handlers/list')).toEqual({
            method: 'GET',
            path: '/events',
            handler: './handlers/list',
            public: false,
            scopes: []
        });
    });

    it('keeps extra scopes', () => {
        expect(route('POST', '/events', './h', { scopes: ['events:host'] }).scopes).toEqual([
            'events:host'
        ]);
    });

    it('marks public routes', () => {
        expect(route('GET', '/health', './h', { public: true }).public).toBe(true);
    });

    it('treats public: false as signed in', () => {
        expect(route('GET', '/health', './h', { public: false }).public).toBe(false);
    });
});

describe('defineApp', () => {
    it('returns the manifest with empty schedules by default', () => {
        const routes = [route('GET', '/events', './h')];
        expect(defineApp({ ...valid, routes })).toEqual({ ...valid, routes, schedules: [] });
    });

    it('keeps schedules', () => {
        const schedules = [{ name: 'reminders', schedule: 'rate(1 hour)', handler: './s' }];
        expect(defineApp({ ...valid, schedules }).schedules).toBe(schedules);
    });

    it.each(['Events', '1events', 'ev_ents', ''])('rejects the app name %j', (name) => {
        expect(load({ name })).toThrow(/app name/);
    });

    it('accepts names with digits and dashes', () => {
        expect(
            load({ name: 'my-app2', scopes: ['my-app2:x'], baseScope: 'my-app2:x' })
        ).not.toThrow();
    });

    it("rejects a scope without the app's prefix", () => {
        expect(load({ scopes: ['events:guest', 'budget:owner'] })).toThrow(
            'scope "budget:owner" must start with "events:"'
        );
    });

    it('rejects an undeclared base scope', () => {
        expect(load({ baseScope: 'events:other' })).toThrow(
            'base scope "events:other" is not in scopes'
        );
    });

    it.each([
        '/',
        '/events/',
        'events',
        '/Events',
        '/events//x',
        '/events/:',
        '/events/:1d',
        '/e v'
    ])('rejects the path %j', (path) => {
        expect(load({ routes: [route('GET', path as `/${string}`, './h')] })).toThrow(
            'has an invalid path'
        );
    });

    it.each(['/events', '/events/:id', '/events/:eventId/rsvps', '/a-b/c1'])(
        'accepts the path %j',
        (path) => {
            expect(load({ routes: [route('GET', path as `/${string}`, './h')] })).not.toThrow();
        }
    );

    // RACC for `path === '/auth' || path.startsWith('/auth/')`: each clause decides the outcome
    // against '/authors', where both are false.
    it.each([
        ['/auth', true],
        ['/auth/login', true],
        ['/authors', false]
    ])('reserves /auth: %j rejected is %j', (path, rejected) => {
        const define = load({ routes: [route('GET', path as `/${string}`, './h')] });
        if (rejected) {
            expect(define).toThrow('reserved');
        } else {
            expect(define).not.toThrow();
        }
    });

    it('rejects duplicate routes', () => {
        expect(
            load({ routes: [route('GET', '/events', './a'), route('GET', '/events', './b')] })
        ).toThrow('route GET /events is defined twice');
    });

    it('allows the same path with different methods', () => {
        expect(
            load({ routes: [route('GET', '/events', './a'), route('POST', '/events', './b')] })
        ).not.toThrow();
    });

    it('rejects a route scope that is not declared', () => {
        expect(
            load({ routes: [route('POST', '/events', './h', { scopes: ['events:admin'] })] })
        ).toThrow('route POST /events requires undeclared scope "events:admin"');
    });
});

describe('requiredScopes', () => {
    const app = defineApp({
        ...valid,
        routes: [
            route('GET', '/events', './h'),
            route('POST', '/events', './h', { scopes: ['events:host'] }),
            route('PUT', '/events', './h', { scopes: ['events:guest'] }),
            route('GET', '/health', './h', { public: true })
        ]
    });
    const [list, create, update, health] = app.routes;

    it('requires the base scope on signed-in routes', () => {
        expect(requiredScopes(app, list)).toEqual(['events:guest']);
    });

    it('adds route scopes to the base scope', () => {
        expect(requiredScopes(app, create)).toEqual(['events:guest', 'events:host']);
    });

    it('lists the base scope once', () => {
        expect(requiredScopes(app, update)).toEqual(['events:guest']);
    });

    it('requires nothing on public routes', () => {
        expect(requiredScopes(app, health)).toEqual([]);
    });
});

describe('pathParams', () => {
    it('lists parameter names in order', () => {
        expect(pathParams('/events/:eventId/rsvps/:id')).toEqual(['eventId', 'id']);
    });

    it('returns nothing for a path without parameters', () => {
        expect(pathParams('/events')).toEqual([]);
    });
});
