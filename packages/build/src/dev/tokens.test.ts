import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeJwt, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
    FAKE_ISSUER,
    loadKeys,
    signAccessToken,
    signRefreshToken,
    verifyAccessToken,
    verifyRefreshToken
} from './tokens.js';

const keyFile = async () => join(await mkdtemp(join(tmpdir(), 'keys-')), 'nested', 'key.json');
const alice = {
    sub: 'fake-1',
    email: 'alice@test',
    name: 'Alice',
    scopes: ['events:guest', 'events:host']
};

describe('dev tokens', () => {
    it('creates a private key file once and reuses it', async () => {
        const file = await keyFile();
        const first = await loadKeys(file);
        expect((await stat(file)).mode & 0o777).toBe(0o600);
        const token = await signAccessToken(first, alice);
        const second = await loadKeys(file);
        expect(await verifyAccessToken(second, token)).toBeDefined();
        expect(JSON.parse(await readFile(file, 'utf8'))).toHaveProperty('d');
    });

    it("signs access tokens with Cognito's claim shape", async () => {
        const keys = await loadKeys(await keyFile());
        const claims = await verifyAccessToken(keys, await signAccessToken(keys, alice));
        expect(claims).toMatchObject({
            iss: FAKE_ISSUER,
            sub: 'fake-1',
            token_use: 'access',
            email: 'alice@test',
            name: 'Alice',
            scope: 'events:guest events:host',
            'cognito:groups': ['events:guest', 'events:host']
        });
    });

    it('leaves out an empty name', async () => {
        const keys = await loadKeys(await keyFile());
        const user = { sub: 's', email: 'bob@test', scopes: [] };
        expect(decodeJwt(await signAccessToken(keys, user))).not.toHaveProperty('name');
        expect(await verifyRefreshToken(keys, await signRefreshToken(keys, user))).toEqual(user);
    });

    it('round-trips the user through a refresh token', async () => {
        const keys = await loadKeys(await keyFile());
        expect(await verifyRefreshToken(keys, await signRefreshToken(keys, alice))).toEqual(alice);
    });

    it('expires access tokens after an hour', async () => {
        const keys = await loadKeys(await keyFile());
        const old = await signAccessToken(keys, alice, Math.floor(Date.now() / 1000) - 3601);
        expect(await verifyAccessToken(keys, old)).toBeUndefined();
    });

    it('does not accept a refresh token as an access token, or the reverse', async () => {
        const keys = await loadKeys(await keyFile());
        expect(await verifyAccessToken(keys, await signRefreshToken(keys, alice))).toBeUndefined();
        expect(await verifyRefreshToken(keys, await signAccessToken(keys, alice))).toBeUndefined();
    });

    it("rejects another key's tokens", async () => {
        const mine = await loadKeys(await keyFile());
        const theirs = await loadKeys(await keyFile());
        expect(await verifyAccessToken(mine, await signAccessToken(theirs, alice))).toBeUndefined();
    });

    it('rejects a different issuer', async () => {
        const keys = await loadKeys(await keyFile());
        const token = await new SignJWT({ token_use: 'access' })
            .setProtectedHeader({ alg: 'ES256' })
            .setIssuer('https://cognito-idp.us-east-1.amazonaws.com/pool')
            .setExpirationTime('1h')
            .sign(keys.privateKey);
        expect(await verifyAccessToken(keys, token)).toBeUndefined();
    });

    it('rejects garbage', async () => {
        const keys = await loadKeys(await keyFile());
        expect(await verifyAccessToken(keys, 'not.a.jwt')).toBeUndefined();
    });
});
