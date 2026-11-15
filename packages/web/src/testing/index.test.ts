import { describe, expect, it, vi } from 'vitest';
import type { Routes } from '../../test/routes.js';
import { fakeApiClient, fakeAuthClient, fakeUser } from './index.js';

describe('fakeUser', () => {
    it('fills in defaults', () => {
        const user = fakeUser({ scopes: ['events:guest'] });
        expect(user).toMatchObject({ id: 'user-1', email: 'alice@test', scopes: ['events:guest'] });
        expect(user).not.toHaveProperty('name');
        expect(user.has('events:guest')).toBe(true);
        expect(fakeUser({ scopes: [], name: 'Bob', email: 'bob@test', id: 'b' })).toMatchObject({
            name: 'Bob',
            id: 'b'
        });
    });
});

describe('fakeAuthClient', () => {
    it('is signed in with a user', async () => {
        const client = fakeAuthClient({ scopes: ['events:host'] });
        expect(client.getState().status).toBe('signedIn');
        expect(await client.getAccessToken()).toBe('fake-token');
        expect(await client.refresh()).toBe('fake-token');
        await expect(client.start()).resolves.toBeUndefined();
    });

    it('is signed out without one, and records sign-ins', async () => {
        const client = fakeAuthClient();
        expect(client.getState()).toEqual({ status: 'signedOut' });
        expect(await client.getAccessToken()).toBeUndefined();
        client.signIn();
        client.signIn('/x');
        expect(client.signIns).toEqual(['/', '/x']);
    });

    it('signs out and notifies subscribers', async () => {
        const client = fakeAuthClient({ scopes: [] });
        const listener = vi.fn();
        const unsubscribe = client.subscribe(listener);
        await client.signOut();
        expect(client.getState()).toEqual({ status: 'signedOut' });
        expect(listener).toHaveBeenCalledOnce();
        unsubscribe();
        client.setState({ status: 'loading' });
        expect(listener).toHaveBeenCalledOnce();
    });
});

describe('fakeApiClient', () => {
    it('answers from the fakes, typed like the real client', async () => {
        const api = fakeApiClient<Routes>({
            'GET /events/:id': ({ params }) => ({ id: params.id }),
            'DELETE /events/:id': () => undefined,
            'POST /events': ({ body }) => ({ id: 'e9', title: body.title, capacity: 1 }),
            'GET /events': () => [],
            'GET /health': () => ({ ok: true })
        });
        expect(await api.get('/events/:id', { params: { id: 'e1' } })).toEqual({ id: 'e1' });
        expect(await api.post('/events', { body: { title: 'x' } })).toMatchObject({ title: 'x' });
        expect(await api.delete('/events/:id', { params: { id: 'e1' } })).toBeUndefined();
        expect(await api.get('/events')).toEqual([]);
        expect(await api.get('/health')).toEqual({ ok: true });
    });

    it('fails on routes without a fake', async () => {
        const api = fakeApiClient<Routes>({});
        await expect(api.get('/health')).rejects.toMatchObject({
            status: 404,
            message: 'No fake for GET /health'
        });
        const loose = api as unknown as Record<'put' | 'patch', (path: string) => Promise<unknown>>;
        await expect(loose.put('/x')).rejects.toMatchObject({ status: 404 });
        await expect(loose.patch('/x')).rejects.toMatchObject({ status: 404 });
    });
});
