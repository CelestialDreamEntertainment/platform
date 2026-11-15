import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { exportJWK, generateKeyPair, importJWK, jwtVerify, SignJWT, type JWK } from 'jose';

/**
 * The fake sign-in's issuer. It exists only in the local dev server, never in deployed code, and
 * API Gateway would reject its tokens anyway because the issuer is wrong.
 */
export const FAKE_ISSUER = 'https://fake-sign-in.local.sabrinabea.com';
export const ACCESS_TOKEN_SECONDS = 60 * 60;
export const REFRESH_TOKEN_SECONDS = 30 * 24 * 60 * 60;

const ALG = 'ES256';

export type FakeUser = {
    readonly sub: string;
    readonly email: string;
    readonly name?: string;
    readonly scopes: readonly string[];
};

type Key = Awaited<ReturnType<typeof importJWK>>;
export type Keys = { readonly privateKey: Key; readonly publicKey: Key };

/**
 * Loads the dev signing key from `file`, creating it on first use, so sessions survive restarts.
 * The file lives in the app's gitignored `.platform/` folder.
 */
export const loadKeys = async (file: string): Promise<Keys> => {
    let jwk: JWK;
    try {
        jwk = JSON.parse(await readFile(file, 'utf8')) as JWK;
    } catch {
        const { privateKey } = await generateKeyPair(ALG, { extractable: true });
        jwk = await exportJWK(privateKey);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, JSON.stringify(jwk), { mode: 0o600 });
    }
    const publicJwk = { ...jwk };
    delete publicJwk.d;
    return { privateKey: await importJWK(jwk, ALG), publicKey: await importJWK(publicJwk, ALG) };
};

const sign = (
    keys: Keys,
    claims: Record<string, unknown>,
    subject: string,
    seconds: number,
    now: number
) =>
    new SignJWT(claims)
        .setProtectedHeader({ alg: ALG })
        .setIssuer(FAKE_ISSUER)
        .setSubject(subject)
        .setIssuedAt(now)
        .setExpirationTime(now + seconds)
        .sign(keys.privateKey);

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/** Signs an access token with Cognito's claim shape, plus the email and name the pre-token Lambda adds. */
export const signAccessToken = (keys: Keys, user: FakeUser, now = nowSeconds()): Promise<string> =>
    sign(
        keys,
        {
            token_use: 'access',
            email: user.email,
            ...(user.name ? { name: user.name } : {}),
            scope: user.scopes.join(' '),
            'cognito:groups': [...user.scopes]
        },
        user.sub,
        ACCESS_TOKEN_SECONDS,
        now
    );

export const signRefreshToken = (keys: Keys, user: FakeUser, now = nowSeconds()): Promise<string> =>
    sign(
        keys,
        {
            token_use: 'refresh',
            email: user.email,
            ...(user.name ? { name: user.name } : {}),
            scopes: user.scopes
        },
        user.sub,
        REFRESH_TOKEN_SECONDS,
        now
    );

const verify = async (keys: Keys, token: string, use: string) => {
    try {
        const { payload } = await jwtVerify(token, keys.publicKey, {
            issuer: FAKE_ISSUER,
            algorithms: [ALG]
        });
        return payload.token_use === use ? payload : undefined;
    } catch {
        return undefined;
    }
};

/** Verifies an access token the way API Gateway's JWT authorizer would. Returns its claims, or undefined. */
export const verifyAccessToken = async (
    keys: Keys,
    token: string
): Promise<Record<string, string | number | boolean | string[]> | undefined> =>
    (await verify(keys, token, 'access')) as
        Record<string, string | number | boolean | string[]> | undefined;

/** Verifies a refresh token and returns the user it was issued for. */
export const verifyRefreshToken = async (
    keys: Keys,
    token: string
): Promise<FakeUser | undefined> => {
    const payload = await verify(keys, token, 'refresh');
    if (!payload) {
        return undefined;
    }
    const { sub, email, name, scopes } = payload as {
        sub: string;
        email: string;
        name?: string;
        scopes: string[];
    };
    return { sub, email, ...(name ? { name } : {}), scopes };
};
