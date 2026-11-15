import {
    created,
    defineApp,
    defineHandler,
    definePublicHandler,
    noContent,
    route
} from '@sbwp/runtime';
import { z } from 'zod';

const app = defineApp({
    name: 'events',
    scopes: ['events:guest', 'events:host'],
    baseScope: 'events:guest',
    routes: [
        route('GET', '/events', './a'),
        route('GET', '/events/:id', './b'),
        route('POST', '/events', './c', { scopes: ['events:host'] }),
        route('DELETE', '/events/:id', './d', { scopes: ['events:host'] }),
        route('GET', '/health', './e', { public: true })
    ]
});

export const listEvents = defineHandler(
    app,
    { query: z.object({ after: z.coerce.date().optional() }) },
    async () => [{ id: 'e1', title: 'Picnic', startsAt: new Date(), save: () => undefined }]
);
export const getEvent = defineHandler(
    app,
    { params: z.object({ id: z.string() }) },
    ({ params }) => ({
        id: params.id
    })
);
export const createEvent = defineHandler(
    app,
    { body: z.object({ title: z.string(), capacity: z.number().default(10) }) },
    ({ body }) => created({ id: 'e2', ...body })
);
export const deleteEvent = defineHandler(app, { params: z.object({ id: z.string() }) }, () =>
    noContent()
);
export const health = definePublicHandler(app, {}, () => ({ ok: true as const }));

/** What `sbwp types` generates for this app. */
export type Routes = {
    'GET /events': typeof listEvents;
    'GET /events/:id': typeof getEvent;
    'POST /events': typeof createEvent;
    'DELETE /events/:id': typeof deleteEvent;
    'GET /health': typeof health;
};
