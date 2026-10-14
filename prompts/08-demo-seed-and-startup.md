# Prompt 08 — Demo seed and startup

Implement only this prompt. Preconditions: prompt 07 is done. Create, load, and conditional update pass.

## Read first

- Architecture sections 6 and 11: seed explicitly, do not reseed when a load fails, Compose, `.env.example`, fail startup when credentials are missing
- Take-home PDF page 3, suggested user flow step 1: the app loads with a default or previously saved configuration
- Acceptance criteria F01 and Q03. F01 does not fully pass until the editor loads the seed in prompt 20. Q03 passes in this prompt

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- The seed is an explicit command. No request path may insert the demo row because a read failed.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/08-demo-seed-and-startup.md`.
- Do not build the editor UI.

## Goal

A deterministic seed writes one demo configuration for the demo tenant. Both processes fail with a clear message when required configuration is missing. Copying `.env.example` unchanged must not yield a working token.

## Implement

1. `pnpm db:seed` inserts `DEMO_CONFIGURATION_ID` for `DEMO_TENANT_ID` using `createDemoDocument` from prompt 03, with deterministic ids so the row is stable across runs. Use fixed section ids `section-carousel-1`, `section-text-1`, `section-cta-1`, `section-carousel-2`, `section-text-2`, `section-cta-2`, and fixed image ids. The document must pass the shared schema.
2. The seed sets revision 1 only when the row does not exist. If the row exists, the seed does nothing and exits 0. It must not reset a merchant's later edits. Print a line that says whether it inserted or left the existing row alone.
3. The seed refuses to run when `CONFIG_SERVICE_TOKEN` is `replace-me` or when `DEMO_TENANT_ID` or `DEMO_CONFIGURATION_ID` is blank.
4. Config service startup, in addition to prompt 05:
   - missing or blank `DATABASE_URL`, `DEMO_TENANT_ID` → non-zero exit, message names the variable
   - token missing, blank, or `replace-me` → non-zero exit
   - do not connect and then create tables as a side effect of `GET`
5. Add a `dev` script note in `docs/ai-notes` only, not the README yet, listing the exact commands you used: compose postgres, migrate, seed, start the service. Prompt 30 turns that into the README.
6. Tests:
   - seed on an empty test database inserts the six-section document at the configured id
   - running seed twice leaves revision and `updatedAt` unchanged
   - a test that calls `GET` for a missing id does not create a row
   - starting the service config parser with `replace-me` fails
   - starting the service config parser with a blank database URL fails

Keep the service's HTTP tests from prompts 05–07 passing. Point them at `reactiv_test` so they do not depend on the demo seed.

## Out of scope

- Auto-creating a configuration inside `GET` or inside a future loader
- Editor pages
- README

## Acceptance criteria that fully pass

- **Q03.** Environment variables configure the token, database URL, service URL, and demo ids. `.env.example` names them without a usable secret. Missing required server configuration, including the placeholder token `replace-me`, causes an understandable setup error and does not fall back to a built-in credential. Evidence: startup tests and a boot attempt with the example file copied and unchanged.

F01 does not pass yet. The default document is stored only after someone runs the seed. The UI does not load it.

## Take-home PDF requirements

- Page 4, environment variables and sensible defaults: required settings fail closed. The demo content is an explicit seed, not a silent fallback.
- Page 3, suggested flow step 1, is prepared and not yet user-visible.

Not passed: reloading the page restores data, because there is no page that loads the configuration.

## Verification

- `docker compose up -d postgres`
- `pnpm db:migrate`
- `pnpm db:seed` twice
- `GET /v1/configurations/cfg_demo` with the local token returns the six sections
- `pnpm test`
- `pnpm typecheck`

## Done when

- Q03's failure behavior is tested.
- The note lists the commands a later README should copy, including that seed does not overwrite.
- You have not started prompt 09.
