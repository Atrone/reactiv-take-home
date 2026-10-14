# Prompt 01 — Scaffold the workspace

Run this first. The repository is empty except for `prompts/`. Implement only this prompt.

## Read first

- `prompts/00-sequence.md`
- Architecture sections 4, 14, and 17 (topology, repository layout, submission checklist)
- Take-home PDF pages 1 and 3–4: framework, TypeScript, environment variables, README expectation. Do not write the README yet
- Acceptance criteria A01 and Q03. They do not fully pass in this prompt

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- React Router v7 framework mode with the server runtime enabled. TypeScript strict. REST. A separate Fastify service. Postgres via Docker Compose. Shared contracts package. pnpm workspaces.
- Pin `react-router` and every `@react-router/*` package to the same patched 7.x release. The architecture reviewed v7.18.4 on 10 October 2026. Use 7.18.4 or a newer patched 7.x, and record the exact version in `docs/ai-notes/01-scaffold-the-workspace.md`. Do not use React Router 8 or Next.js.
- The configuration-service token is read only from server environment variables. Never prefix it with `VITE_` or any other client-exposed prefix. Never default it to a real or guessable credential.
- Every new function has a block comment describing purpose, inputs, and side effects, and line comments on the steps inside the body.
- Append a factual note to `docs/ai-notes/01-scaffold-the-workspace.md`.
- The local shell is Windows PowerShell. Package scripts must stay cross-platform.
- Do not commit `.env`. Do not add a git commit unless the user asks.
- Do not build editor features, API routes, or database tables in this prompt.

## Preconditions

- The workspace exists and `prompts/00-sequence.md` is present.
- Docker is available for later prompts. This prompt must still produce a valid Compose file if the daemon is not running; say so in the note. Do not pretend Postgres was started.

## Goal

Create a runnable two-process workspace with an empty editor shell and a configuration service that boots only when its required environment is present. A reviewer should be able to see the trust boundary in the directory tree before any feature work.

## Implement

1. Create this layout. A smaller layout is not a substitute.

   - `apps/editor/` — React Router v7 framework app
   - `apps/config-service/` — Fastify service
   - `packages/contracts/` — empty package named `@reactiv/contracts`, exported for both apps
   - `db/migrations/` and `db/seed/` — empty directories with a short placeholder file that says the SQL arrives in later prompts
   - `tests/e2e/` — placeholder only
   - `docs/ai-notes/`
   - `compose.yaml`
   - `.env.example`
   - `.gitignore` that ignores `.env`, `node_modules`, build output, and Playwright output
   - Root `package.json` with pnpm workspace scripts: `typecheck`, `test`, `dev`, `dev:editor`, `dev:service`

2. Editor app.

   - Framework mode, `ssr: true`. Follow the official framework-mode setup for the pinned version (`@react-router/dev`, Vite plugin, a server entry). Do not use `createBrowserRouter` as the application shell.
   - One route at `/` that renders a plain page saying the editor is not built yet. No configuration fetch.
   - TypeScript `strict` is on. No `any` in app code.
   - The editor package must not depend on `pg`, Fastify, or the config-service source.

3. Configuration service.

   - Fastify listens on `HOST` and `PORT`. Default host `127.0.0.1`, default port `4001`.
   - On startup, require `CONFIG_SERVICE_TOKEN` and `DATABASE_URL`. If either is missing or blank, exit with a non-zero code and a message that names the variable and does not invent a credential.
   - `GET /health` returns `{ "status": "ok" }` and does not read configuration rows. It is the only route. It must not echo the token.
   - Do not enable open CORS.

4. Compose.

   - Service `postgres` using Postgres 16, a named volume `reactiv_pg`, and a database `reactiv`.
   - Map Postgres to `127.0.0.1:5432` only.
   - Do not put the real token in `compose.yaml`. The config-service Compose service may be declared so later prompts can use it, but it must receive the token from the environment, not from a committed literal.
   - Document in a comment at the top of `compose.yaml` that the private service is not a public port. When the service is added to Compose, publish it on `127.0.0.1` only.

5. `.env.example` must name, with placeholder values and one-line comments:

   - `CONFIG_SERVICE_TOKEN=replace-me`
   - `CONFIG_SERVICE_URL=http://127.0.0.1:4001`
   - `DATABASE_URL=postgres://reactiv:reactiv@127.0.0.1:5432/reactiv`
   - `DATABASE_URL_TEST=postgres://reactiv:reactiv@127.0.0.1:5432/reactiv_test`
   - `DEMO_TENANT_ID=tenant_demo`
   - `DEMO_CONFIGURATION_ID=cfg_demo`
   - `CONFIG_SERVICE_HOST=127.0.0.1`
   - `CONFIG_SERVICE_PORT=4001`
   - `EDITOR_PORT` if the framework needs it

   The example token is the literal `replace-me`, which later auth must treat as invalid if someone copies it unchanged into a running service. State that in the example comment. Do not add a second fallback token in code.

6. Add Vitest at the workspace root or per package, with one passing test that the health route function or a tiny pure helper returns the expected status. This proves the runner. Do not claim editor coverage.

7. Add a root `tsconfig` base that both apps extend. Shared code compiles from `packages/contracts`.

## Out of scope

- Zod schemas, SQL, section components, loaders that call the service, seeds, Playwright, README, Decision Log.
- Installing a UI kit, state library, ORM, or GraphQL server.

## Acceptance criteria

No acceptance ID fully passes in this prompt.

Progress that must be true, without claiming a pass:

- A01: React Router v7 framework mode and TypeScript are installed and the server runtime is enabled. Context/Hooks are not in place yet, so A01 does not pass.
- Q03: `.env.example` exists and the config service fails closed when required variables are missing. The editor does not read the token yet, so Q03 does not pass.

## Take-home PDF requirements

These choices are now fixed and must stay fixed:

- Page 1, Technology Requirements: React Router v7 in framework mode, TypeScript, REST as the protocol that later prompts will implement.
- Page 3, Private Authentication: credentials will live only on the server. This prompt must not introduce a client-exposed variable.
- Page 4, Environment variables: secrets and service settings come from the environment. There is no insecure default credential.

These PDF requirements do not pass yet: preview components, import/export, persistence, loaders/actions, tests of editor behavior, README, Decision Log.

## Verification

From the repo root in PowerShell:

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
- Start the config service with the required variables unset and confirm a non-zero exit and a message that names the missing variable.
- Start it with `CONFIG_SERVICE_TOKEN` and `DATABASE_URL` set to the example placeholders and confirm `GET http://127.0.0.1:4001/health` returns the ok status. Database connectivity is not required for health in this prompt.
- `pnpm exec react-router --version` or the app's dev script shows the pinned 7.x version. In `apps/editor`, confirm the framework config has the server runtime enabled.
- Confirm `apps/editor/package.json` does not depend on `pg` or `fastify`.

## Done when

- Both packages typecheck, the sample test passes, and the service refuses to boot without its token or database URL.
- The note in `docs/ai-notes/01-scaffold-the-workspace.md` records the pinned React Router version, the commands you ran, and their results.
- You have not started prompt 02.
