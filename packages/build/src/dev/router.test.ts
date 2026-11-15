import { route } from '@sbwp/runtime';
import { describe, expect, it } from 'vitest';
import { matchRoute, queryParameters } from './router.js';

const routes = [
    route('GET', '/events', './a'),
    route('POST', '/events', './b'),
    route('GET', '/events/:id', './c'),
    route('GET', '/events/:eventId/rsvps/:id', './d')
];

describe('matchRoute', () => {
    it('matches a static path', () => {
        expect(matchRoute(routes, 'GET', '/api/events')).toEqual({ route: routes[0], params: {} });
    });

    it('matches by method', () => {
        expect(matchRoute(routes, 'POST', '/api/events')?.route).toBe(routes[1]);
        expect(matchRoute(routes, 'DELETE', '/api/events')).toBeUndefined();
    });

    it('extracts and decodes params', () => {
        expect(matchRoute(routes, 'GET', '/api/events/a%20b/rsvps/r1')).toEqual({
            route: routes[3],
            params: { eventId: 'a b', id: 'r1' }
        });
    });

    it('requires the /api prefix', () => {
        expect(matchRoute(routes, 'GET', '/events')).toBeUndefined();
        expect(matchRoute(routes, 'GET', '/apix/events')).toBeUndefined();
    });

    it('does not match other lengths, empty params or bad encodings', () => {
        expect(matchRoute(routes, 'GET', '/api/events/1/x')).toBeUndefined();
        expect(matchRoute(routes, 'GET', '/api/events/')).toBeUndefined();
        expect(matchRoute(routes, 'GET', '/api/events/%E0%A4%A')).toBeUndefined();
        expect(matchRoute(routes, 'GET', '/api/other')).toBeUndefined();
    });
});

describe('queryParameters', () => {
    it('joins repeated keys with commas, like API Gateway', () => {
        expect(queryParameters(new URLSearchParams('a=1&b=2&a=3'))).toEqual({ a: '1,3', b: '2' });
    });

    it('is undefined without a query', () => {
        expect(queryParameters(new URLSearchParams(''))).toBeUndefined();
    });
});
