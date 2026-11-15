import { describe, expect, it } from 'vitest';
import { userFromClaims } from './user.js';

const declared = ['events:guest', 'events:host'] as const;
const claims = { sub: 'u1', email: 'alice@test', scope: 'events:guest openid' };

describe('userFromClaims', () => {
    it('builds the user from claims', () => {
        const user = userFromClaims(claims, declared);
        expect(user).toMatchObject({ id: 'u1', email: 'alice@test', scopes: ['events:guest'] });
        expect(user).not.toHaveProperty('name');
    });

    it('includes the name when present', () => {
        expect(userFromClaims({ ...claims, name: 'Alice' }, declared)?.name).toBe('Alice');
    });

    it('leaves out an empty name', () => {
        expect(userFromClaims({ ...claims, name: '' }, declared)).not.toHaveProperty('name');
    });

    // RACC for `!sub || !email`: each clause flips the outcome while the other stays valid.
    it('returns undefined without a subject', () => {
        expect(userFromClaims({ ...claims, sub: undefined }, declared)).toBeUndefined();
    });

    it('returns undefined without an email', () => {
        expect(userFromClaims({ ...claims, email: '' }, declared)).toBeUndefined();
    });

    it('keeps only declared scopes', () => {
        const user = userFromClaims({ ...claims, scope: 'budget:owner events:host' }, declared);
        expect(user?.scopes).toEqual(['events:host']);
    });

    it('has no scopes when the scope claim is missing', () => {
        expect(userFromClaims({ sub: 'u1', email: 'a@test' }, declared)?.scopes).toEqual([]);
    });

    it('checks scopes with has', () => {
        const user = userFromClaims(claims, declared);
        expect(user?.has('events:guest')).toBe(true);
        expect(user?.has('events:host')).toBe(false);
    });

    it('does not match a scope by prefix', () => {
        const user = userFromClaims({ ...claims, scope: 'events:guestx' }, declared);
        expect(user?.has('events:guest')).toBe(false);
    });
});
