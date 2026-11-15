import { defineApp, route } from '@sbwp/runtime';

export default defineApp({
    name: 'events',
    scopes: ['events:guest', 'events:host'],
    baseScope: 'events:guest',
    routes: [
        route('GET', '/events', './handlers/listEvents'),
        route('POST', '/events', './handlers/createEvent', { scopes: ['events:host'] }),
        route('GET', '/events/:id', './handlers/getEvent'),
        route('GET', '/health', './handlers/health', { public: true })
    ]
});
