import { defineApp, route } from '@sbwp/runtime';
import { describe, expect, it } from 'vitest';
import { authorizerScopes, routeEntry, routeId } from './routes-json.js';

const app = defineApp({
    name: 'events',
    scopes: ['events:guest', 'events:host'],
    baseScope: 'events:guest',
    routes: [
        route('GET', '/events', './a'),
        route('POST', '/events/:eventId/rsvps', './b', { scopes: ['events:host'] }),
        route('GET', '/health', './c', { public: true })
    ]
});
const [list, rsvp, health] = app.routes;

describe('routeId', () => {
    it('joins the method and path', () => {
        expect(routeId(list)).toBe('get-events');
    });

    it('names path params with by-', () => {
        expect(routeId(rsvp)).toBe('post-events-by-eventid-rsvps');
    });
});

describe('authorizerScopes', () => {
    it("uses the route's own scopes when it has any", () => {
        expect(authorizerScopes(app, rsvp)).toEqual(['events:host']);
    });

    it('falls back to the base scope', () => {
        expect(authorizerScopes(app, list)).toEqual(['events:guest']);
    });

    it('is empty for public routes', () => {
        expect(authorizerScopes(app, health)).toEqual([]);
    });
});

describe('routeEntry', () => {
    it('describes the route for Terraform', () => {
        expect(routeEntry(app, rsvp, 'hash')).toEqual({
            id: 'post-events-by-eventid-rsvps',
            method: 'POST',
            path: '/events/:eventId/rsvps',
            public: false,
            scopes: ['events:guest', 'events:host'],
            authorizerScopes: ['events:host'],
            zip: 'post-events-by-eventid-rsvps.zip',
            sha256: 'hash'
        });
    });
});
