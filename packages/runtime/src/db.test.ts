import { afterEach, describe, expect, it } from 'vitest';
import { closeDb, getDb } from './db.js';

// The driver connects on first use, so none of these tests need a running Mongo.
describe('getDb', () => {
    afterEach(async () => {
        await closeDb();
    });

    it("returns the app's own database", () => {
        expect(getDb('events', {}).databaseName).toBe('events');
    });

    it('defaults to local Mongo', () => {
        expect(getDb('events', {}).client.options.hosts.map(String)).toEqual(['localhost:27017']);
    });

    it('uses MONGODB_URI when set', () => {
        const db = getDb('events', { MONGODB_URI: 'mongodb://mongo.test:27018' });
        expect(db.client.options.hosts.map(String)).toEqual(['mongo.test:27018']);
    });

    it('reuses one client per process', () => {
        expect(getDb('events', {}).client).toBe(getDb('other', {}).client);
    });

    it('creates a new client after closing', async () => {
        const first = getDb('events', {}).client;
        await closeDb();
        expect(getDb('events', {}).client).not.toBe(first);
    });

    it('reads process.env by default', () => {
        expect(getDb('events').databaseName).toBe('events');
    });

    it('closes safely when no client exists', async () => {
        await closeDb();
        await expect(closeDb()).resolves.toBeUndefined();
    });
});
