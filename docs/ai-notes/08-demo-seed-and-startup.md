# 08 — Demo seed and startup

12 October 2026. Prompt 09 was not started. The editor still does not load a configuration.

## Seed

`pnpm db:seed` is the only writer of the demo row. `GET /v1/configurations/:id` still returns 404 when this tenant has no such id, and that miss does not insert. The seed does not run migrations and does not create tables. `pnpm db:migrate` remains the only command that applies `db/migrations`.

The command reads unset keys from `.env`, the same way migrate does. A shell value wins, including a blank one. It refuses to connect when setup is incomplete:

- `CONFIG_SERVICE_TOKEN` missing, blank, or `replace-me` (surrounding spaces included)
- `DATABASE_URL` missing or blank
- `DEMO_TENANT_ID` missing or blank
- `DEMO_CONFIGURATION_ID` missing or blank

Each problem is one stderr line that names the variable. The placeholder and the database URL are not printed. Copying `.env.example` unchanged hits `Invalid environment variable: CONFIG_SERVICE_TOKEN` and exits 1.

When the checks pass, the seed inserts `DEMO_CONFIGURATION_ID` for `DEMO_TENANT_ID` only if that row is absent. The insert uses `createDemoDocument` and a fixed id queue, so the document is the same on every run and passes the shared schema. Revision is 1, from the existing insert statement. `updated_at` is the database default.

If the row is already there, the seed does not write. It exits 0. A later merchant edit keeps its revision, timestamp, and document. A unique-constraint race after the lookup is treated the same way: the existing row stays.

Stdout is one of these lines:

- `Inserted the demo configuration.`
- `Left the existing row alone.`

The fixed ids, in generator order, are `section-carousel-1`, `image-carousel-1-1`, `image-carousel-1-2`, `section-text-1`, `section-cta-1`, `section-carousel-2`, `image-carousel-2-1`, `image-carousel-2-2`, `section-text-2`, `section-cta-2`. Screen order is still carousel, text, CTA, carousel, text, CTA. The copy, colors, URLs, and aspect ratios come from `createDemoDocument`.

## Service startup

In addition to the prompt 05 checks, startup now requires `DEMO_TENANT_ID`. A missing or blank tenant exits 1 with `Missing required environment variable: DEMO_TENANT_ID`. A missing, blank, or `replace-me` token still exits 1, and so does a missing or blank `DATABASE_URL`. There is no built-in token or database URL. `DEMO_CONFIGURATION_ID` is required by the seed, not by process startup. The service tenant for requests is still `DEMO_TENANT_ID`.

The service process does not read `.env`. Migrate and seed do. A service process whose environment omits a required variable fails even when the file on disk has a value. Health still does not query Postgres, and listening does not create tables.

## Commands a later README should copy

`pnpm db:seed` does not overwrite an existing row. Run it after migrate. Running it again is safe.

```
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm dev:service
```

`pnpm db:migrate` and `pnpm db:seed` fill unset variables from `.env`. `pnpm dev:service` uses the process environment. The local `.env` must already contain a token other than `replace-me`, the database URL, and `DEMO_TENANT_ID`. The example file copied unchanged is not that environment.

## Commands and results

- `docker compose up -d postgres` left `reactiv-postgres-1` running.
- `pnpm db:migrate` exited 0. Stdout was `No pending migrations.`
- `pnpm db:seed` exited 0. Stdout was `Inserted the demo configuration.`
- `pnpm db:seed` again exited 0. Stdout was `Left the existing row alone.`
- Starting the service from the unchanged `.env.example` values exited 1. Stderr was `Invalid environment variable: CONFIG_SERVICE_TOKEN`. It did not print the placeholder or the database URL.
- With the local `.env` values in the process environment, the service listened on `127.0.0.1:4001`. `GET /v1/configurations/cfg_demo` with the bearer token returned 200, `ETag: "1"`, `Cache-Control: private, no-store`, revision `1`, schema version `1`, and `updatedAt` `2026-10-12T23:31:37.504Z`. The six section ids were `section-carousel-1`, `section-text-1`, `section-cta-1`, `section-carousel-2`, `section-text-2`, `section-cta-2`, in the types carousel, text, CTA, carousel, text, CTA. The image ids were `image-carousel-1-1`, `image-carousel-1-2`, `image-carousel-2-1`, `image-carousel-2-2`. The body did not contain the token. The process was then stopped.
- `pnpm dev:service`, with those same process values, served `GET /health` 200. The process was then stopped.
- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 199 in `@reactiv/config-service`, and 10 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.

The service HTTP tests still use `reactiv_test`. They do not read the demo row in the dev database. The seed tests delete only `tenant_demo` / `cfg_demo` on `reactiv_test`.

## Acceptance progress

Q03 passes. `.env.example` names `CONFIG_SERVICE_TOKEN`, `CONFIG_SERVICE_URL`, `DATABASE_URL`, `DEMO_TENANT_ID`, and `DEMO_CONFIGURATION_ID`. The token value is `replace-me`, which is not a credential. Startup and the seed exit non-zero for a missing required value and for that placeholder, and they do not substitute a built-in secret. Evidence: the config-parser tests, the process boot from the unchanged example file, and the seed refusal tests.

F01 does not pass. The six-section document is stored only after someone runs `pnpm db:seed`. The editor does not load it. Reloading a page cannot restore it, because there is no page that loads the configuration.
