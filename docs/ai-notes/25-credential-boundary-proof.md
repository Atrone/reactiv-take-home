# 25 — Credential boundary proof

13 October 2026. Prompt 26 was not started.

## Boundary

`docs/boundary.md` is the trace from a browser load to `GET /v1/configurations/:id`, and from Save to `PUT /v1/configurations/:id` with `If-Match`. The only editor module that reads `CONFIG_SERVICE_TOKEN` or calls the private API is `apps/editor/app/services/configuration.server.ts`. The UI, the reducer, and `packages/contracts` stay off that variable. Validation stays on `editableDocumentSchema`. The editor package has no `pg` dependency.

## Client bundle

`apps/editor/app/services/client-bundle-boundary.test.ts` runs the pinned command, `react-router build`, through `@react-router/dev/bin.js` with the boundary credential in the process environment. It scans `apps/editor/build/client`, including source maps, and skips the server build. The scan reported no credential value, no `import.meta.env` read of `CONFIG_SERVICE_TOKEN`, and no occurrence of that variable name. A fixture that contains the value, a dotted `import.meta.env` read, or a bracket read fails the same scan.

## Browser session

`pnpm test:boundary` runs `playwright test --config playwright.boundary.config.ts`. The web server command is `node e2e/boundary/serve-boundary.mjs`. Postgres was reachable, so the launcher used a dedicated database `reactiv_boundary`, migrated and seeded it, and started the real configuration service. A spy on the editor's `CONFIG_SERVICE_URL` recorded `Authorization` and forwarded each call to that service. The editor listened on `http://127.0.0.1:4271/`.

The session loaded `/`, selected the demo text section, changed the title, saved, and exported JSON. The spy reported `boundary upstream: postgres` and authenticated `GET` count 3 and `PUT` count 1 on `/v1/configurations/cfg_demo`. The PUT carried `If-Match`. Every configuration read and write URL was the editor origin. The document HTML, the loader `.data` payload, the export file, `localStorage`, the request headers, and `test-results/boundary-process.log` omitted the credential. The log line `boundary-mode=postgres` was present.

## Commands and results

- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest passed 65 tests in `@reactiv/contracts`, 222 in `@reactiv/config-service`, and 340 in `@reactiv/editor`.
- `pnpm test:boundary` exited 0. One Playwright test passed.
- `.gitignore` lists `.env`. `git status --short` produced no file list: this directory is not a git repository (`git rev-parse` exited 128), so `.env` is not a path waiting to be added. No commit was created.
- Prompt 24 still covers log redaction: `packages/contracts/src/request-log.test.ts` and `apps/config-service/src/http/request-log.test.ts`.

## Acceptance progress

A09 passes. The credential is read in server modules. The client bundle scan, the Playwright session, the export assertion, the prompt 24 log tests, and the `.gitignore` entry are the evidence. The repository's committed placeholder remains `replace-me` in `.env.example`.

A10 passes. Browser configuration traffic stayed on the editor origin. The spy observed `Authorization` on the real service's authenticated `GET` and `PUT`.

Q01 passes. `docs/boundary.md` follows an edit through Save. `react-router build` is the check that server-only modules stayed out of the client bundle.
