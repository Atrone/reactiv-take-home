# 30 — README, architecture, and Decision Log

13 October 2026. Prompt 31 was not started.

## Documents

- `README.md`
- `docs/architecture.md`
- `docs/decision-log.md` — 2 pages. The count is 730 words and 84 wrapped lines at 85 characters, which is 2 pages at 46 lines per page and 2 pages at 50 lines per page.
- `scripts/with-env.mjs`, and the `dev:service` and `dev:editor` scripts in `package.json`, so those two commands load unset keys from `.env`. `node --env-file=.env --run dev:service` started `tsx` without `CONFIG_SERVICE_TOKEN`, `DATABASE_URL`, or `DEMO_TENANT_ID`. The processes themselves still do not open `.env`.

## What the documents say that the notes do not already prove

Every file in `docs/ai-notes/` from prompts 01–29 was present. No note was missing.

The Phase 2 notes supplied for this prompt skip Decision 3. The Decision Log says that and does not invent the missing decision.

Drag-and-drop is in `apps/editor/app/features/editor/section-drag.ts`. The Move up and Move down buttons are absent. The README describes drag and the arrow keys, and it does not list drag-and-drop as unimplemented.

The notes describe a GitHub Actions workflow on commits to main. This checkout has no `.github/workflows` file. The Decision Log says the workflow is not in the tree.

## Commands and results

Shell: PowerShell. Node.js v24.18.0. pnpm 12.11.2. Docker Engine 28.0.4.

- `docker compose up -d postgres` left `reactiv-postgres-1` running.
- `pnpm install` exited 0. The workspace was already up to date.
- `pnpm db:migrate` exited 0. Stdout was `No pending migrations.`
- `pnpm db:seed` exited 0. Stdout was `Left the existing row alone.`
- Ports 4001 and 5173 were already listening. `GET http://127.0.0.1:4001/health` returned 200 and `{"status":"ok"}`. `GET http://127.0.0.1:5173/` returned 200 and the editor heading.
- `pnpm dev:service` with `PORT=4025` listened on `http://127.0.0.1:4025`. `GET /health` returned 200 and `{"status":"ok"}`. The process was then stopped.
- `pnpm dev:service` with `CONFIG_SERVICE_TOKEN=replace-me` and `PORT=4026` exited 1. Stderr was `Invalid environment variable: CONFIG_SERVICE_TOKEN`. It did not print the placeholder.
- `pnpm dev:editor` with `EDITOR_PORT=5181` listened on `http://127.0.0.1:5181/`. `GET /` returned 200. The HTML included the editor heading, Save, and the drag hint, and it did not include `replace-me`. The process was then stopped.
- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest 5.0.4 passed 66 tests in `@reactiv/contracts`, 222 in `@reactiv/config-service`, and 354 in `@reactiv/editor`.

The preview benchmark command was not run again. The README cites the 13 October 2026 paint p95 already in `docs/preview-benchmark.md`.

## Acceptance progress

D08, P05, Q04, Q05, and R03 pass on this checkout.

D08: schema version 1 is the only accepted document format, version 2 is rejected without a write, and the README says a future migration would be a pure function from version N to N+1 with a preserving fixture, applied on read or on an explicit migrate command, plus a contract test. That function does not exist.

P05: the README states Postgres, the named volume, the prompt 29 restart, the conditional update on `revision`, and the single demo tenant. Row-level security is described as not enabled.

Q04: the README has setup, environment variables, start commands, test commands, architecture, and tradeoffs. A clean checkout run remains prompt 31.

Q05: `docs/decision-log.md` is 2 pages and follows the supplied notes and the code that was inspected.

R03: `sectionRegistry` and `sectionUiRegistry` are the seam from prompt 03. The README explains a quiz or video section as a union member, a Zod schema, a factory, one inspector, one renderer, and fixtures, with persistence left as the JSON document.
