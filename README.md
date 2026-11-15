# platform
Shared code for the apps suite: npm packages, Terraform modules, reusable CI workflows, and local dev config. Apps pin one platform version and upgrade on their own schedule.

> **Status:** in progress. `packages/runtime` has the routes manifest, handler contract and Lambda wrapper. `build`, `web`, the Terraform modules and the reusable workflows come next. The design lives in the suite README (`../README.md`).

## What's here

| Part | Purpose |
|---|---|
| `packages/runtime` | Backend library: wraps route handlers, validates requests with zod, builds the `User` from token claims, and provides `ctx.db`, `ctx.secrets`, and `ctx.log`. It never exposes AWS to app code. |
| `packages/build` | CLI: reads an app's routes manifest, bundles one Lambda per route with esbuild, writes the routes JSON, and runs the local dev environment (`dev`), including the local API server and fake sign-in. |
| `packages/web` | Frontend package: auth client (`useUser()`, `<RequireAuth>`), typed API client (`createClient<typeof routes>()`), test helpers, and the base Mantine theme. |
| `modules/` | Terraform modules apps use by pinned git tag, e.g. `app-api`, `static-site`, `app-auth`. |
| `.github/workflows/` | Reusable workflows for app PR checks and the build → dev → prod pipeline. |
| `local-dev/` | Caddy config and the fixed port pair for each app. |

The packages are published publicly to npmjs.com as `@sbwp/runtime`, `@sbwp/build`, and `@sbwp/web`. Each is a separate package so Lambda bundles never include React and the esbuild tooling never ships at runtime.

## Versioning and releases
- **One version for everything.** The packages, modules, and workflows share a single version and a single git tag (e.g. `v1.4.0`), because `build`'s output and the Terraform modules' input have to match.
- **release-please** keeps a release PR open that updates versions and changelogs. Merging it tags the release and publishes to npm. Versions are never edited by hand.
- **Trusted publishing:** each package names this repo's release workflow as its trusted publisher on npmjs.com, so CI publishes with GitHub's short-lived OIDC token and adds provenance. No npm token is stored. Each package's first version is published manually, since trusted publishing can only be configured once a package exists. Every package sets `publishConfig.access: "public"`.
- PR titles follow Conventional Commits. While the version is 0.x, breaking changes bump only the minor version.

## Security
This repo stores no secrets: no AWS credentials and no npm token. The reusable workflows run in each calling app's context with that app's own OIDC role.

## Using `runtime`
An app declares its routes once, in its manifest:

```ts
import { defineApp, route } from '@sbwp/runtime';

export default defineApp({
    name: 'events',
    scopes: ['events:guest', 'events:host'],
    baseScope: 'events:guest',
    routes: [
        route('GET', '/events/:id', './handlers/getEvent'),
        route('POST', '/events', './handlers/createEvent', { scopes: ['events:host'] }),
        route('GET', '/health', './handlers/health', { public: true })
    ]
});
```

Each handler file exports `handler`, made with `defineHandler` (or `definePublicHandler` for public routes). The zod schemas validate the request and type it, and `user.has` only accepts the app's own scopes:

```ts
import { defineHandler, NotFoundError } from '@sbwp/runtime';
import { z } from 'zod';
import app from '../app.js';

export const handler = defineHandler(
    app,
    { params: z.object({ id: z.string() }) },
    async ({ params, user }, ctx) => {
        const event = await ctx.db.collection('events').findOne({ _id: params.id });
        if (!event) {
            throw new NotFoundError();
        }
        return user.has('events:host') ? event : { ...event, rsvps: undefined };
    }
);
```

- A returned value is a 200 JSON response, `undefined` is a 204, and `created(x)`, `noContent()` and `reply(status, x)` cover the rest.
- Thrown `HttpError`s (`BadRequestError`, `NotFoundError`, ...) become their status. Anything else is logged and becomes a 500 with no details.
- `wrap(handler, { method, path })` turns a handler into the route's Lambda function. The `build` CLI generates that call, so apps never write it. It fails closed: 401 without a user, 403 without every required scope.
- `ctx.db` is the app's own Mongo database (`MONGODB_URI`, defaulting to local Mongo), opened on first use. `ctx.log` writes JSON lines tagged with the request ID and route.
- Unit tests call `handler.handle(request, ctx)` directly with a fake `ctx`.

## Development
Tool versions are pinned in `mise.toml`. `pnpm test`, `pnpm lint`, `pnpm typecheck` and `pnpm build` run from the root. CI runs all four on every PR and push to main, and checks that PR titles follow Conventional Commits.
