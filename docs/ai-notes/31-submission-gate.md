# 31 — Submission gate

13 October 2026. Prompt 32 was not started.

## Clean checkout

The drill used a temporary copy of the tree, without `node_modules`, build output, or the workspace `.env`. The workspace `.env` was not deleted or rewritten. `docker compose up -d postgres` reused the Compose project `reactiv` and the named volume `reactiv_pg`. That volume was not deleted.

The copy followed the README: Node.js v24.18.0, pnpm 12.11.2, Docker, copy `.env.example` to `.env`, set a local token, `docker compose up -d postgres`, `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, then `pnpm dev:service` and `pnpm dev:editor` on `127.0.0.1:4001` and `127.0.0.1:5173`.

`pnpm db:migrate` printed `No pending migrations.` The first `pnpm db:seed` exited 1 because `packages/contracts/dist/index.js` did not exist after `pnpm install`. Seed and both dev servers import that build. `package.json` now compiles `@reactiv/contracts` at the start of `db:seed`, `dev:service`, and `dev:editor`. `pnpm dev` compiles it once, then starts the two serve scripts. The README says so. `apps/config-service/src/boundary.test.ts` asserts those script prefixes. After that change, `pnpm db:seed` printed `Left the existing row alone.`

The workspace processes already bound to ports 4001 and 5173 were stopped so the copy could listen there. Postgres kept running. `GET http://127.0.0.1:4001/health` returned 200 and `{"status":"ok"}`. `GET http://127.0.0.1:5173/` returned 200.

## Browser journey

The page loaded the saved home screen. The text title was changed to `Gate title 31`. The phone preview showed that title before Save. Save then showed `Saved.`, and `PUT /v1/configurations/cfg_demo` returned 200. A reload showed `Gate title 31` in the section list and the preview.

Export JSON produced a file with `schemaVersion` and `Gate title 31`. The file did not contain the service token. The title was then changed to `Before import`. Importing the exported file showed `Imported, not saved.` and the preview returned to `Gate title 31`.

A listener recorded `window` `error` and `unhandledrejection` events on the document element for that load, the edit, Save, the reload, export, and import. The attribute stayed unset. Broken example.com images showed `Image unavailable` and did not raise a window error.

The copy's dev processes were stopped after the checks. Ports 4001 and 5173 were free. `reactiv_pg` was still present.

## Commands and results

All of these ran in the clean copy.

- `pnpm test` exited 0. Vitest 5.0.4 passed 66 tests in `@reactiv/contracts`, 223 in `@reactiv/config-service`, and 354 in `@reactiv/editor`. The config-service count includes the new setup-script test.
- `pnpm typecheck` exited 0.
- `pnpm exec playwright test` exited 0. Six tests passed: carousel scroll, 375, 768, 1440, ArrowDown, and drag.
- `pnpm test:journeys` exited 0. Six tests passed: T01, T02, T03, both T06 tests, and T07.
- `pnpm test:boundary` exited 0. One test passed. The run reported `boundary upstream: postgres`, authenticated `GET` count 3, and `PUT` count 1.
- `powershell -NoProfile -File .\scripts\restart-check.ps1` exited 0.

```
Saved title=P05 restart 2026-10-14T01:21:14.616Z revision=23
After restart title=P05 restart 2026-10-14T01:21:14.616Z revision=23 volume=reactiv_pg
Restored previous title=Gate title 31
P05 behavior passed. The named volume survived the config-service restart. docker compose down -v was not run.
```

The preview benchmark command was not run again. The README records the 13 October 2026 measurement in `docs/preview-benchmark.md` and says that command is not part of `pnpm test`.

## Secret scan

The scan walked the workspace and skipped `node_modules`, `dist`, `build`, `.react-router`, coverage, and Playwright output. It then scanned `docs/` and `apps/editor/build/client` for the workspace `.env` token even though build output was otherwise excluded.

- `git check-ignore -v .env` reported `.gitignore:2:.env`.
- `git status --short --ignored -- .env` reported `!! .env`.
- `git ls-files` lists no committed `.env`. This workspace has no commit yet, so nothing is tracked. `git add -n -- .` listed `.env.example` and did not list `.env`.
- The workspace token appeared only in the untracked, ignored `.env`.
- The clean-copy token did not appear in the workspace.
- `docs/` and `apps/editor/build/client` did not contain the workspace token.
- The scan found no private key, AWS access key, GitHub personal access token, or Slack token.

## Decision log

`docs/decision-log.md` was not edited. It is 703 words. Wrapped at 85 characters it is 75 lines, which is under two pages at 46 lines per page.

## Remote

No GitHub repository, GitLab project, or other public remote was created. The user has not asked for one in this session. The PDF's request for a public link is that publishing step. It is `waiting on the user` in `docs/submission-checklist.md`. That does not fail the product bar for Q06.

## Acceptance progress

Q06 passes on this checkout for the runnable source, the README, the Decision Log, typecheck, tests, and the edit, import, export, save, and reload journey. The public URL is not part of that pass.

F01–F12, D01–D08, A01–A11, P01–P06, Q01–Q06, and R01–R09 are `pass` in `docs/submission-checklist.md`. SCL01, SCL03, and SCL04 are `not claimed`. SCL02 is `demo API only, not a production claim`.
