# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The suite-wide `../CLAUDE.md` and the design in `../README.md` also apply.

## Commands
Tool versions come from `mise.toml` (Node 24, pnpm, Terraform). Run everything from the repo root:
- `pnpm install`: install dependencies (also sets up the husky pre-commit hook)
- `pnpm test`: builds the packages, then runs unit and type-level tests with coverage. Coverage below 100% fails. `build`'s tests bundle a fixture app (`packages/build/test/fixtures/events`), which needs `runtime` built.
- `pnpm test:watch`: Vitest in watch mode
- `pnpm lint`: ESLint, then Prettier in check mode
- `pnpm format`: apply Prettier
- `pnpm typecheck`: `tsc -b` across the packages, then the test files too (`tsconfig.test.json`). Vitest doesn't type-check `*.test.ts` files.
- `pnpm build`: compile each package to `dist/`
- `node packages/build/bin/sbwp.js build` in an app directory: try the CLI against a local app

Type-level tests live in `*.test-d.ts` files next to the code. Markdown is excluded from Prettier so docs keep their hand-written layout.

## What this repo is
The `platform` repo: the `runtime`, `build`, and `web` npm packages, Terraform modules, reusable GitHub Actions workflows, and `local-dev/` config. Nothing here is deployed. Releasing means publishing, and apps adopt new versions through their own PRs.

## Rules
- **Build only what an app needs.** Start with what Events needs, and add more only when a second app needs the same thing.
- **This repo stores no secrets.** No AWS credentials and no npm token. Publishing uses npm trusted publishing (GitHub OIDC) from the release workflow. Never add an `NPM_TOKEN` secret as a workaround.
- **Keep the packages separate.** `runtime` must never depend on React or esbuild, and `web` must never depend on backend code.
- **One shared version.** Changes to `build`'s routes JSON output and the Terraform modules that read it must ship in the same release. A breaking change to anything apps depend on (manifest API, handler contract, routes JSON, module inputs, Node major version) needs a `feat!:` PR title.
- **Types are part of the API.** The generic types behind `defineApp`, the handler contract, and `createClient` need type-level tests (`expectTypeOf`) alongside the runtime tests.
- **Security-sensitive code:**
    - The wrapper fails closed: 401 when a non-public route receives no claims, 403 when required scopes are missing.
    - JWT verification exists only in the local dev server, never in `runtime`.
    - The fake sign-in issuer must never be reachable from deployed code.
- **The SSM parameter names read by the modules are a contract with `platform-infra`.** Changing one takes coordinated PRs: infra first, then the module.
- **The platform owns the Node major version.** The esbuild target, the Lambda runtime, and `engines.node` must agree.
