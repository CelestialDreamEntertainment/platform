import { describe, expectTypeOf, it } from 'vitest';
import type { Routes } from '../../test/routes.js';
import { createClient } from './client.js';
import type { Jsonify } from './types.js';

const auth = { getAccessToken: async () => undefined, refresh: async () => undefined };
const api = createClient<Routes>({ auth });

describe('typed client', () => {
    it('autocompletes paths per method', () => {
        void api.get('/events');
        void api.get('/health');
        // @ts-expect-error there is no GET /nope
        void api.get('/nope');
        // @ts-expect-error /health has no POST
        void api.post('/health');
    });

    it('requires params exactly when the handler declares them', () => {
        void api.get('/events/:id', { params: { id: 'e1' } });
        // @ts-expect-error params are required
        void api.get('/events/:id');
        // @ts-expect-error id must be a string
        void api.get('/events/:id', { params: { id: 1 } });
        // @ts-expect-error GET /events takes no params
        void api.get('/events', { params: { id: 'x' } });
    });

    it("checks bodies against the schema's input", () => {
        void api.post('/events', { body: { title: 'Picnic' } });
        void api.post('/events', { body: { title: 'Picnic', capacity: 3 } });
        // @ts-expect-error title is required
        void api.post('/events', { body: {} });
        // @ts-expect-error body is required
        void api.post('/events');
    });

    it('makes options optional when nothing is required', () => {
        void api.get('/events');
        void api.get('/events', { query: { after: new Date() } });
    });

    it('types responses from what handlers return, after JSON', () => {
        expectTypeOf(api.get('/events')).resolves.toEqualTypeOf<
            { id: string; title: string; startsAt: string }[]
        >();
        expectTypeOf(api.get('/events/:id', { params: { id: 'x' } })).resolves.toEqualTypeOf<{
            id: string;
        }>();
        expectTypeOf(api.post('/events', { body: { title: 'x' } })).resolves.toEqualTypeOf<{
            title: string;
            capacity: number;
            id: string;
        }>();
        expectTypeOf(
            api.delete('/events/:id', { params: { id: 'x' } })
        ).resolves.toEqualTypeOf<undefined>();
        expectTypeOf(api.get('/health')).resolves.toEqualTypeOf<{ ok: true }>();
    });

    it('treats plain objects with status and body as plain values', () => {
        expectTypeOf<Jsonify<{ status: number; body: string }>>().toEqualTypeOf<{
            status: number;
            body: string;
        }>();
    });

    it('jsonifies nested values', () => {
        expectTypeOf<Jsonify<{ at: Date; list: Date[]; n: null }>>().toEqualTypeOf<{
            at: string;
            list: string[];
            n: null;
        }>();
    });
});
