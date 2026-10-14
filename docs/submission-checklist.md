# Submission checklist

13 October 2026. Results are from the clean-checkout run in `docs/ai-notes/31-submission-gate.md` and from the tests and documents already in the tree. A row is `pass` only when that evidence is still present and the check was run or inspected in this prompt.

| ID | Result | Evidence |
| --- | --- | --- |
| F01 | pass | Seeded load and saved reload in `apps/editor/app/features/editor/save-and-reload.test.tsx`. The clean checkout saved `Gate title 31`, reloaded `/`, and showed that title. |
| F02 | pass | `apps/editor/app/features/editor/live-preview-behavior.test.tsx`. Typing the title updated the phone before Save. |
| F03 | pass | The same live-preview file covers two sections of each type. The reloaded screen showed two carousels, three text sections, and two buttons, each with its own copy. |
| F04 | pass | Reorder through export and reload in `save-and-reload.test.tsx`. `pnpm exec playwright test` passed the arrow-key and drag checks. |
| F05 | pass | `e2e/carousel-scroll.spec.ts` and `apps/editor/app/features/sections/carousel-section.test.tsx`. The scroll check passed in the clean copy. |
| F06 | pass | Add, edit, remove, and the empty carousel state in `carousel-section.test.tsx`. |
| F07 | pass | Portrait `3 / 4`, landscape `16 / 9`, and square `1 / 1` survive export and reload in `save-and-reload.test.tsx`. The ratios are in the README. |
| F08 | pass | Multiline Unicode description round trip in `save-and-reload.test.tsx`. |
| F09 | pass | Separate title and description colors on two text sections in `save-and-reload.test.tsx`. |
| F10 | pass | `apps/editor/app/features/sections/cta-section.test.tsx`. The preview button stays in the editor. `Open destination` is the new-tab link. |
| F11 | pass | `e2e/responsive-layout.spec.ts` passed at 375, 768, and 1440 CSS pixels. |
| F12 | pass | Inline errors and empty states in the editor tests. Required and optional fields are in `docs/field-rules.md`. |
| D01 | pass | Export tests in `apps/editor/app/features/editor/json-export.test.tsx`. The clean-checkout export contained `schemaVersion` and `Gate title 31` and did not contain the service token. |
| D02 | pass | Import, Save, and reload in `save-and-reload.test.tsx`. The clean checkout imported the exported file and showed `Imported, not saved.` |
| D03 | pass | Malformed, empty, and unreadable files in `apps/editor/app/features/editor/json-import.test.tsx`. Journey T03 passed. |
| D04 | pass | Semantic rejection before the draft changes in `json-import.test.tsx`. |
| D05 | pass | Stored `id`, `schemaVersion`, `updatedAt`, and `data` in `apps/config-service/src/configurations/create-and-load.test.ts` and `conditional-update.test.ts`. |
| D06 | pass | Ordered carousel, text, and CTA settings in `packages/contracts/src/document.test.ts` and the round-trip tests. |
| D07 | pass | The same document schema on API writes and import. `#123` and `#12ABEF` pass. `#12`, `#GGGGGG`, and script, data, and file URLs fail. Markup stays text. |
| D08 | pass | Version 2 is rejected in the import tests and journey T03. The README describes a future pure migration from version N to N+1. That function is not implemented. |
| A01 | pass | React Router 7.18.4 framework mode, TypeScript, and `EditorProvider` in `apps/editor`. |
| A02 | pass | REST `GET`, `POST`, and `PUT` under `/v1/configurations` in the config-service tests. |
| A03 | pass | Known id returns 200 and an unknown id returns 404 in `create-and-load.test.ts`. |
| A04 | pass | Two creates stay distinct and `POST` returns 201 in `create-and-load.test.ts`. |
| A05 | pass | `PUT` updates a known id and returns 404 for an unknown id in `conditional-update.test.ts`. |
| A06 | pass | Invalid writes return 422 and leave the stored row unchanged in `conditional-update.test.ts`. |
| A07 | pass | Documented error code and safe message, including 404, 422, and injected failures, in the config-service HTTP tests. |
| A08 | pass | Missing and wrong tokens are rejected before a read or a write on load, create, and update. |
| A09 | pass | `apps/editor/app/services/client-bundle-boundary.test.ts` and `pnpm test:boundary`. The export and the browser session omitted the credential. |
| A10 | pass | `e2e/boundary/credential-boundary.spec.ts` passed against Postgres: authenticated `GET` count 3 and `PUT` count 1, all on the editor origin. |
| A11 | pass | Server loader and server action in `apps/editor/app/routes/editor.tsx`. The shipping route has no `clientLoader` or `clientAction`. |
| P01 | pass | Save shows `Saved.` only after the service acknowledges the write. The clean-checkout `PUT /v1/configurations/cfg_demo` returned 200. |
| P02 | pass | Reload after Save restored `Gate title 31` from the loader. The loader does not read `localStorage`. |
| P03 | pass | `apps/editor/app/features/editor/failure-recovery.test.tsx` and journey T06. A failed Save keeps the draft, and retry can succeed. |
| P04 | pass | The same failure tests and journey T06. A closed service port shows the load error and does not invent the demo document. Retry loads the stored screen. |
| P05 | pass | Postgres volume `reactiv_pg`. The README states restart, durability, and the single demo tenant. `scripts/restart-check.ps1` exited 0: revision 23 and its title survived a config-service restart. `docker compose down -v` was not run. |
| P06 | pass | A rejected update leaves the previous document readable in `conditional-update.test.ts`. |
| Q01 | pass | `docs/boundary.md` traces an edit through Save. `pnpm test` includes the client-bundle scan. |
| Q02 | pass | `pnpm test` exited 0 in the clean copy: 66 contract tests, 223 config-service tests, and 354 editor tests. |
| Q03 | pass | `.env.example` names the variables. Startup tests reject `replace-me` and a missing database URL. The clean copy booted from a copied `.env` with a local token. |
| Q04 | pass | `README.md` has setup, variables, start commands, tests, architecture, and tradeoffs. The clean copy followed it. `pnpm db:seed` and both dev commands now compile `@reactiv/contracts` first. |
| Q05 | pass | `docs/decision-log.md` is 703 words and 75 lines wrapped at 85 characters, about 1.6 pages. It was not edited in this prompt. |
| Q06 | pass | The tree has the source, the README, and the Decision Log. `pnpm typecheck` and `pnpm test` passed. The clean checkout edited, saved, reloaded, exported, and imported with no uncaught browser error. |
| Public repository link | waiting on the user | No GitHub or GitLab remote was created. The user has not asked for one. |
| R01 | pass | One `draft.data.sections` list drives the inspector, the phone, export, and save. |
| R02 | pass | Stable section ids through edit, reorder, export, import, and reload. Duplicate ids are rejected. |
| R03 | pass | `sectionRegistry` and `sectionUiRegistry`. The README explains a quiz or video section without a new table. |
| R04 | pass | `packages/contracts/src/brand-fixtures.test.ts` and `apps/editor/app/features/sections/brand-fixtures.test.tsx`. |
| R05 | pass | `apps/editor/app/features/editor/save-reconciliation.test.tsx`: preview keeps B, the editor stays unsaved, and reload shows A. |
| R06 | pass | Reserved frames and `Image unavailable` in the image tests. Journey T07 passed. A broken image did not block the title field. |
| R07 | pass | Shared `LIMITS` in the contract, API, and import tests. Crossing a limit does not shorten the document. `docs/field-rules.md` lists the limits. |
| R08 | pass | `docs/preview-benchmark.md` and `e2e/preview-benchmark.spec.ts` still record the 13 October 2026 local p95 of 17.699999809265137 ms. That command was not run again. The README says it is not part of `pnpm test`. |
| R09 | pass | Correlation id on a failed save in `apps/editor/app/features/editor/correlation.test.tsx` and the config-service request log tests. |
| SCL01 | not claimed | Tenant isolation and row-level security are not implemented. Prompt 32 was not started. |
| SCL02 | demo API only, not a production claim | A stale `If-Match` returns 412 and the editor keeps the draft. The README limits this to the demo API and one demo tenant. |
| SCL03 | not claimed | No capacity test was run. Prompt 33 was not started. |
| SCL04 | not claimed | No availability percentage or recovery-time objective is claimed. The local restart above is not that claim. |
