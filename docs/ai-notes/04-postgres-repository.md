# 04 — Postgres repository

12 October 2026. Prompt 05 was not started. No acceptance ID fully passes.

## Storage

The take-home PDF allows more than one store. This project uses Postgres. The conditional update is one SQL statement, and Compose already has a named volume for the data directory. The README tradeoff is prompt 30.

`pg` 8.23.1 is a dependency of `@reactiv/config-service` only. `@types/pg` 8.23.1 is a devDependency of that package. There is no Prisma, Drizzle, or other ORM. `apps/editor/package.json` does not depend on `pg`. The boundary test that checks the editor package still passes.

## Schema

`db/migrations/001_configurations.sql` creates `configurations` with `tenant_id`, `id`, `schema_version`, `revision`, `data` jsonb, and `updated_at`. The primary key is `(tenant_id, id)`. `schema_version` and `revision` must be positive. `data` must be a JSON object. There is no `position` column and no jsonb index.

`updated_at` is `timestamptz NOT NULL DEFAULT now()`. Insert omits that column. The conditional update assigns `updated_at = now()`. Write functions do not take a timestamp.

The jsonb value is the document `data` object, so section order is the array order. `schema_version` is a column. The repository reads a row back through `configurationSchema`. A row that fails that schema throws `ConfigurationContractError` and is not returned as a configuration.

## Repository

`apps/config-service/src/configurations/repository.ts` takes a `pg` pool. It does not import Fastify or React.

- `insertConfiguration({ tenantId, id, document })` inserts `schema_version` from the document, revision 1, and `data`. The same tenant and id returns `{ ok: false, reason: "unique-violation" }`. It does not upsert.
- `getConfiguration({ tenantId, id })` selects with `tenant_id` and `id`. A miss is `{ ok: false, reason: "not-found" }`.
- `updateConfiguration({ tenantId, id, expectedRevision, document })` runs the conditional `UPDATE` in one transaction and commits only when a row comes back. If no row comes back, a second `SELECT` filtered by `tenant_id` and `id` chooses `not-found` or `revision-conflict`.

There is no function that loads by id without `tenantId`. `cfg_demo` is not seeded.

## Migration command

`pnpm db:migrate` reads `DATABASE_URL` from the shell or the uncommitted `.env`, applies `db/migrations/*.sql` in filename order, and records names in `schema_migrations`.

`.env` was created from `.env.example` with `CONFIG_SERVICE_TOKEN` replaced by a local dummy. `.env` is listed in `.gitignore`. The dummy is not written here.

- First `pnpm db:migrate` printed `Applied 001_configurations.sql` and exited 0.
- Second `pnpm db:migrate` printed `No pending migrations.` and exited 0.

`docker compose up -d postgres` exited 0. The Postgres container was already running. Repository tests create `reactiv_test` when it is missing and migrate `DATABASE_URL_TEST` with the same runner.

After the suite, `reactiv` and `reactiv_test` each have `schema_migrations` containing only `001_configurations.sql`, and `configurations` has 0 rows. `cfg_demo` is absent.

## Concurrent update

Two connections both sent the conditional update with `expectedRevision` 1. The first connection ran that `UPDATE` inside an open transaction and held the row. The second connection's update was still unfinished after 200ms. After the first transaction committed, the second returned `revision-conflict`. The stored revision was 2. The stored document was the first update's document. Exactly one update succeeded.

A separate test runs the second update only after the first `updateConfiguration` call has returned. That second call also returns `revision-conflict`, and the stored revision stays 2.

A rejected update leaves the previous `data` text and `updated_at` text unchanged. The HTTP layer does not exist yet, so this is repository evidence only.

## Commands and results

- `pnpm install` exited 0 and added `pg` and `@types/pg` to the config service.
- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 43 in `@reactiv/config-service`, and 10 in `@reactiv/editor`.

## Acceptance progress

P05 does not pass. Postgres is the store. Restart behavior is not tested, and the README does not exist.

P06 does not pass. A rejected conditional update leaves the previous JSON and timestamp readable in Postgres. The HTTP layer does not exist yet.

D05 does not pass. Rows store id, schema version, timestamp, payload, and revision. API responses do not exist yet.
