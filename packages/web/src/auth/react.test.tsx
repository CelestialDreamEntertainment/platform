import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fakeAuthClient } from '../testing/index.js';
import { AuthProvider, RequireAuth, useAuth, useUser } from './react.js';

const Name = () => <p>{useUser()?.email ?? 'nobody'}</p>;

describe('auth React bindings', () => {
    it('starts the client and shows the user', () => {
        const client = fakeAuthClient({ scopes: ['events:guest'] });
        const start = vi.spyOn(client, 'start');
        render(
            <AuthProvider client={client}>
                <Name />
            </AuthProvider>
        );
        expect(start).toHaveBeenCalledOnce();
        expect(screen.getByText('alice@test')).toBeDefined();
    });

    it('updates when the state changes', () => {
        const client = fakeAuthClient({ scopes: [] });
        render(
            <AuthProvider client={client}>
                <Name />
            </AuthProvider>
        );
        act(() => client.setState({ status: 'signedOut' }));
        expect(screen.getByText('nobody')).toBeDefined();
    });

    it('needs a provider', () => {
        const Bare = () => <p>{String(useAuth())}</p>;
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(() => render(<Bare />)).toThrow('useAuth needs an <AuthProvider> above it');
        vi.restoreAllMocks();
    });

    it('RequireAuth renders children for a signed-in user', () => {
        render(
            <AuthProvider client={fakeAuthClient({ scopes: [] })}>
                <RequireAuth>secret</RequireAuth>
            </AuthProvider>
        );
        expect(screen.getByText('secret')).toBeDefined();
    });

    it('RequireAuth shows the fallback while loading, without redirecting', () => {
        const client = fakeAuthClient({ scopes: [] });
        client.setState({ status: 'loading' });
        render(
            <AuthProvider client={client}>
                <RequireAuth fallback="loading">secret</RequireAuth>
            </AuthProvider>
        );
        expect(screen.getByText('loading')).toBeDefined();
        expect(client.signIns).toEqual([]);
    });

    it('RequireAuth sends signed-out visitors to sign in', () => {
        const client = fakeAuthClient();
        const { container } = render(
            <AuthProvider client={client}>
                <RequireAuth>secret</RequireAuth>
            </AuthProvider>
        );
        expect(container.textContent).toBe('');
        expect(client.signIns).toEqual(['/']);
    });
});
