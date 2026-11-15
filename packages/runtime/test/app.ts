import { defineApp, route } from '../src/manifest.js';

/** A small app used across the runtime's tests. */
export const app = defineApp({
    name: 'events',
    scopes: ['events:guest', 'events:host'],
    baseScope: 'events:guest',
    routes: [
        route('GET', '/events', './list'),
        route('POST', '/events', './create', { scopes: ['events:host'] }),
        route('GET', '/events/:id', './get'),
        route('GET', '/health', './health', { public: true })
    ]
});
