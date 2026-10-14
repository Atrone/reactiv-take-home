# 01 — Scaffold the workspace

12 October 2026. Prompt 02 was not started. No acceptance ID fully passes.

## Pinned React Router

`npm view react-router@7` listed 7.18.4 as the newest 7.x release. The architecture note reviewed that version on 10 October 2026. `react-router`, `@react-router/dev`, `@react-router/node`, and `@react-router/serve` are pinned to 7.18.4 with no caret. The lockfile resolves those packages, and the transitive `@react-router/express` dependency of `@react-router/serve`, to 7.18.4. React Router 8 was not installed. The dev server printed v8 future-flag warnings; those flags were left off.

`apps/editor/react-router.config.ts` sets `ssr: true`. The app uses `@react-router/dev/vite`, `app/routes.ts`, and `app/entry.server.tsx`. It does not use `createBrowserRouter` as the shell.

## Commands and results

- `pnpm install` (pnpm 12.11.2) first exited 1 with `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2`. `pnpm approve-builds esbuild` then `pnpm install` exited 0. pnpm wrote `allowBuilds.esbuild: true` and `minimumReleaseAgeExclude` for `vitest@5.0.4`, `@vitest/mocker@5.0.4`, and `@vitest/spy@5.0.4` in `pnpm-workspace.yaml`.
- `pnpm typecheck` exited 0. That compiled `@reactiv/contracts` with `tsc`, typechecked the config service with `tsc --noEmit`, and ran `react-router typegen && tsc` in the editor. `packages/contracts/dist/index.js` was present afterward.
- `pnpm test` exited 0. Vitest 5.0.4 ran one file and one test in `@reactiv/config-service`. The editor has no test script. This does not claim editor coverage.
- `pnpm dev:service` with `CONFIG_SERVICE_TOKEN` and `DATABASE_URL` unset exited 1. Stderr named both `CONFIG_SERVICE_TOKEN` and `DATABASE_URL`.
- With `CONFIG_SERVICE_TOKEN=replace-me` and `DATABASE_URL` unset, the same command exited 1 and named `DATABASE_URL`.
- With `CONFIG_SERVICE_TOKEN` set to whitespace and `DATABASE_URL` set to the example URL, it exited 1 and named `CONFIG_SERVICE_TOKEN`.
- With `CONFIG_SERVICE_TOKEN=replace-me` and `DATABASE_URL=postgres://reactiv:reactiv@127.0.0.1:5432/reactiv`, `GET http://127.0.0.1:4001/health` returned 200 and `{"status":"ok"}`. The response had no `Access-Control-Allow-Origin` header. A request header carrying the placeholder was not copied into the body. `GET /v1/configurations` returned 404. The process was then stopped. Health did not connect to Postgres.
- `pnpm --filter @reactiv/editor exec react-router --version` printed `7.18.4`.
- `apps/editor/package.json` does not depend on `pg` or `fastify`.
- The editor dev server listened on `http://127.0.0.1:5173/` without `CONFIG_SERVICE_TOKEN` or `DATABASE_URL` set. `GET /` returned 200 and the HTML included “The editor is not built yet.” A browser snapshot of that URL showed the heading “Editor” and that sentence. The dev server was then stopped.
- The first `docker version` check failed because the Docker Desktop engine pipe was not present. A later `docker info` reported server version 28.0.4. `docker compose config` exited 0. With `--profile config-service`, the private service publishes `127.0.0.1:4001` only, and an unset token interpolates to a blank string rather than a committed credential. `docker compose ps -a` listed no containers. Postgres was not started. No `.env` file was created.

## Acceptance progress

A01 does not pass. React Router 7.18.4 framework mode and TypeScript strict are installed, and the server runtime is enabled. Context and Hooks are not in place.

Q03 does not pass. `.env.example` exists, and the config service exits non-zero when `CONFIG_SERVICE_TOKEN` or `DATABASE_URL` is missing or blank. The editor does not read the token.

## Follow-up tests

Same day. Added tests for the boot checks, listen host and port, the health response, the process entrypoint, the Compose and example-env boundary, the editor placeholder, and the dev-server bind. `pnpm test` then ran 40 tests, all passing, and `pnpm typecheck` exited 0.

One health test failed first: Fastify's request log included a token supplied in the query string. Request logs now keep the path and drop the query string. The response was already only `{"status":"ok"}`. The re-run passed.
