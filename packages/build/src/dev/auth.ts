import { createHash } from 'node:crypto';
import type { AppManifest } from '@sbwp/runtime';
import {
    ACCESS_TOKEN_SECONDS,
    REFRESH_TOKEN_SECONDS,
    signAccessToken,
    signRefreshToken,
    verifyRefreshToken,
    type FakeUser,
    type Keys
} from './tokens.js';

export const REFRESH_COOKIE = 'sbwp_refresh';
/** The custom header `/refresh` and `/logout` require, as protection against cross-site request forgery. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'sbwp';

export type AuthRequest = {
    readonly method: string;
    readonly path: string;
    readonly query: URLSearchParams;
    readonly headers: Readonly<Record<string, string | undefined>>;
    readonly body: string;
};

export type AuthResponse = {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body?: string;
};

const json = (
    status: number,
    body: unknown,
    headers: Record<string, string> = {}
): AuthResponse => ({
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
    body: JSON.stringify(body)
});

const escape = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Only same-site paths, so the sign-in page can't be used as an open redirect. */
export const safeReturnTo = (value: string | null | undefined): string =>
    value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')
        ? value
        : '/';

const cookie = (value: string, maxAge: number): string =>
    `${REFRESH_COOKIE}=${value}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export const readCookie = (header: string | undefined, name: string): string | undefined =>
    header
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name}=`))
        ?.slice(name.length + 1);

/** A stable fake user ID for an email, so the same test user keeps their data across sign-ins. */
export const fakeSub = (email: string): string =>
    `fake-${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16)}`;

const loginPage = (app: AppManifest, returnTo: string): string => {
    const scopes = app.scopes
        .map(
            (scope) =>
                `<label><input type="checkbox" name="scope" value="${escape(scope)}"${scope === app.baseScope ? ' checked' : ''}> ${escape(scope)}</label>`
        )
        .join('\n');
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Dev sign-in: ${escape(app.name)}</title>
<style>
body { font: 16px system-ui, sans-serif; max-width: 24rem; margin: 3rem auto; padding: 0 1rem; }
@media (prefers-color-scheme: dark) { body { background: #121212; color: #eee; } }
label { display: block; margin: 0.5rem 0; }
input[type=email], input[type=text] { width: 100%; padding: 0.4rem; box-sizing: border-box; }
button { margin-top: 1rem; padding: 0.5rem 1rem; }
p { opacity: 0.7; }
</style>
</head>
<body>
<h1>Dev sign-in</h1>
<p>Local only. Pick a test user and the scopes to sign in with.</p>
<form method="post" action="/api/auth/login">
<input type="hidden" name="return_to" value="${escape(returnTo)}">
<label>Email <input type="email" name="email" value="alice@test" required></label>
<label>Name <input type="text" name="name" value="Alice"></label>
<fieldset><legend>Scopes</legend>
${scopes}
</fieldset>
<button type="submit">Sign in</button>
</form>
</body>
</html>
`;
};

/** Handles the platform's `/api/auth/*` routes with the fake issuer. Returns undefined for other paths. */
export const handleAuth = async (
    app: AppManifest,
    keys: Keys,
    request: AuthRequest
): Promise<AuthResponse | undefined> => {
    const route = `${request.method} ${request.path}`;
    switch (route) {
        case 'GET /api/auth/login':
            return {
                status: 200,
                headers: {
                    'content-type': 'text/html; charset=utf-8',
                    'cache-control': 'no-store'
                },
                body: loginPage(app, safeReturnTo(request.query.get('return_to')))
            };
        case 'POST /api/auth/login': {
            const form = new URLSearchParams(request.body);
            const email = form.get('email')?.trim() ?? '';
            if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
                return json(400, {
                    error: { code: 'bad_request', message: 'Enter an email address' }
                });
            }
            const name = form.get('name')?.trim();
            const user: FakeUser = {
                sub: fakeSub(email),
                email,
                ...(name ? { name } : {}),
                scopes: form.getAll('scope').filter((scope) => app.scopes.includes(scope))
            };
            return {
                status: 303,
                headers: {
                    location: safeReturnTo(form.get('return_to')),
                    'set-cookie': cookie(await signRefreshToken(keys, user), REFRESH_TOKEN_SECONDS),
                    'cache-control': 'no-store'
                }
            };
        }
        case 'POST /api/auth/refresh':
        case 'POST /api/auth/logout': {
            if (request.headers[CSRF_HEADER] !== CSRF_VALUE) {
                return json(403, {
                    error: { code: 'forbidden', message: `Missing ${CSRF_HEADER} header` }
                });
            }
            if (request.path === '/api/auth/logout') {
                return json(200, { redirectTo: '/' }, { 'set-cookie': cookie('', 0) });
            }
            const token = readCookie(request.headers.cookie, REFRESH_COOKIE);
            const user = token ? await verifyRefreshToken(keys, token) : undefined;
            if (!user) {
                return json(401, { error: { code: 'unauthorized', message: 'Sign in required' } });
            }
            return json(200, {
                accessToken: await signAccessToken(keys, user),
                expiresIn: ACCESS_TOKEN_SECONDS
            });
        }
        default:
            return request.path === '/api/auth' || request.path.startsWith('/api/auth/')
                ? json(404, { error: { code: 'not_found', message: 'Not found' } })
                : undefined;
    }
};
