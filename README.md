# Reactiv home screen editor

This repository is a local editor for a mobile app home screen. A merchant edits carousel, text, and button sections, sees them in a phone preview immediately, and saves the ordered document through a private configuration API. Reloading the page restores the last successful save. The browser never holds the service token.

These instructions were followed on this checkout with PowerShell, Node.js v24.18.0, pnpm 12.11.2, and Docker Engine 28.0.4. The commands below are `pnpm` scripts, so they are not tied to PowerShell. `package.json` asks for Node.js 20 or newer.

## Setup

1. Install Node.js 20 or newer, pnpm 12.11.2, and Docker with Compose.
2. Copy `.env.example` to `.env`.
3. Replace the `CONFIG_SERVICE_TOKEN` value `replace-me` with a local token. `replace-me` will not boot. The configuration service and the editor both reject that placeholder, including when it has surrounding spaces, and they do not substitute a built-in credential.
4. From the repository root:

```
docker compose up -d postgres
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev:service
pnpm dev:editor
```

Run the last two commands in separate terminals and leave them running. Open `http://127.0.0.1:5173/`.

`pnpm install` does not compile `@reactiv/contracts`. `pnpm db:seed`, `pnpm dev:service`, and `pnpm dev:editor` compile that package before they start, because the service and the editor import `packages/contracts/dist`.

`pnpm db:migrate` and `pnpm db:seed` read unset variables from `.env`. A value already set in the shell wins, including a blank one. `pnpm dev:service` and `pnpm dev:editor` do the same through `scripts/with-env.mjs`, then start the processes. The service and the editor still do not open `.env` themselves. `pnpm db:seed` inserts the demo row only when it is missing. Running it again prints `Left the existing row alone.`

`docker compose up -d postgres` starts Postgres 16 and keeps data in the named volume `reactiv_pg`. The config-service Compose profile is not the API. Its image exits on purpose. Start the API with `pnpm dev:service`. It listens on `http://127.0.0.1:4001`. `GET /health` returns `{"status":"ok"}` and does not query Postgres.

## Environment variables

| Variable | Role |
| --- | --- |
| `CONFIG_SERVICE_TOKEN` | Bearer token for the private API. Required. `replace-me` will not boot. |
| `CONFIG_SERVICE_URL` | Base URL the editor server uses. Example: `http://127.0.0.1:4001`. |
| `DATABASE_URL` | Postgres URL for the configuration service. |
| `DATABASE_URL_TEST` | Database the repository tests create when it is missing. |
| `DEMO_TENANT_ID` | Server-selected demo tenant. The browser does not choose it. |
| `DEMO_CONFIGURATION_ID` | Server-selected demo configuration. Required by the seed and the editor. |
| `CONFIG_SERVICE_HOST` | Bind address. Keep this on loopback. Defaults to `127.0.0.1` when unset. |
| `CONFIG_SERVICE_PORT` | API port when `PORT` is unset. Default `4001`. |
| `EDITOR_PORT` | Editor dev-server port. Default `5173`. |

Copying `.env.example` unchanged fails startup with `Invalid environment variable: CONFIG_SERVICE_TOKEN`. The message does not print the token.

## Tests

```
pnpm test
pnpm typecheck
pnpm exec playwright test
pnpm test:journeys
pnpm test:boundary
powershell -NoProfile -File .\scripts\restart-check.ps1
```

`pnpm test` builds `@reactiv/contracts` and runs Vitest in the contracts package, the configuration service, and the editor. `pnpm typecheck` typechecks those three packages.

`pnpm exec playwright test` is the carousel scroll check, the 375, 768, and 1440 viewport checks, and the arrow-key and drag reorder checks. `pnpm test:journeys` is the reviewer journeys. `pnpm test:boundary` checks that the service credential stays off the browser. The restart script stops and starts the config-service process against `reactiv_pg`. It does not run `docker compose down` and it does not delete the volume. The shell used for that script in this repository is PowerShell.

The local preview measurement was:

```
pnpm exec playwright test --config playwright.preview-benchmark.config.ts
```

That command is recorded in `docs/preview-benchmark.md`. It is not part of `pnpm test`.

## Architecture

The browser talks only to the editor. React Router 7.18.4 loaders and actions, in `apps/editor/app/routes/editor.tsx`, run on the server. They call the server-only client in `apps/editor/app/services/configuration.server.ts`. That client calls a private Fastify API, which reads and writes Postgres. The credential boundary is written out in `docs/boundary.md`. The document, the save race, and what was not built are in `docs/architecture.md`.

An edit is local reducer state until Save. The preview does not wait on the network. Save posts the document and the loaded strong ETag to the editor action. The action sends `PUT /v1/configurations/:id` with `If-Match` and the server-held bearer token.

## Storage

Postgres was chosen so the demo has a durable volume and a conditional update. The assessment also allows SQLite, files, and memory. Those were not used. In-memory storage was not used.

Restarting the config-service process against the same named volume keeps the last committed configuration. The prompt 29 check did that on 13 October 2026: revision 18 and the title `P05 restart 2026-10-13T22:53:03.207Z` were still there after the process started again. `docker compose down -v` deletes `reactiv_pg` and drops the data. This note does not claim that deleting the volume keeps it.

Concurrency is one conditional `UPDATE` that changes a row only when `tenant_id`, `id`, and `revision` still match. A stale `If-Match` returns 412 and does not write. That 412 behavior is the demo API. It is not a production multi-user product.

There is one demo tenant, `tenant_demo`, chosen by the server environment. Postgres row-level security is not enabled.

## Aspect ratios

The document stores the names `portrait`, `landscape`, and `square`. The preview maps them to `3 / 4`, `16 / 9`, and `1 / 1`, with `object-fit: cover`. The acceptance checklist suggested landscape `4 / 3`. This project followed the architecture note instead, so landscape is `16 / 9`.

## Fields, limits, and import

Save, export, import, and the private API use one document schema. Required fields, optional fields, and the numeric limits are in `docs/field-rules.md`. An invalid draft stays on the page. Save and export stay blocked until the draft is valid. Crossing a limit returns an error. It does not shorten the document.

The portable file is UTF-8 JSON. It has `schemaVersion` and `data.sections` only. It does not include the configuration id, tenant, revision, or timestamp. Import replaces the draft after the whole file validates. It does not save by itself.

```json
{
  "schemaVersion": 1,
  "data": {
    "sections": []
  }
}
```

Section order is the array order. There is no second position field.

## Call to action

The preview button shows the destination as text. It does not leave the editor. `Open destination` is a separate link with `target="_blank"` and `rel="noreferrer"`. It is omitted when the URL is not an absolute HTTP or HTTPS URL.

## Schema version

Schema version 1 is the only document format this repository accepts. Any other version, including version 2 and the string `"1"`, is rejected. The stored row and the current draft are not mutated.

A future migration would be a pure function from version N to N+1, with a fixture that preserves order, ids, copy, and colors. It would run on read or on an explicit migrate command, and a contract test would cover that fixture. That function does not exist yet.

## Adding a quiz or video section

Persistence can stay a JSON document in the existing `data` column. Add the new member to the section union and the Zod schema in `packages/contracts`, add a factory on `sectionRegistry`, add one inspector and one renderer on `sectionUiRegistry`, and add fixtures. The editor shell already asks the registry for the inspector and the preview. A quiz section is not implemented. The same seam is what a video section would use.

## What is not implemented

Autosave, a configuration picker, Shopify, native apps, a publish step, a content delivery network, claimed availability targets, and multi-tenant production authentication are not implemented. Section reordering is implemented: drag a handle, or focus it and use Arrow Up and Arrow Down. The Move up and Move down buttons are not in the UI. Color pickers write the same color fields as the text inputs.

The conditional 412 response exists for this demo API. It is not a production multi-user product.

## Local preview observation

On 13 October 2026, one local production-build run recorded a paint p95 of **17.699999809265137 ms** across 50 title edits. That figure is a local observation from `docs/preview-benchmark.md`. It is not a shopper-traffic or availability claim. The fixture had 30 sections, which is inside the shared limits and smaller than the 100-section ceiling.
