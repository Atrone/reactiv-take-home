# 24 — Correlation and redaction

13 October 2026. Prompt 25 was not started.

## Correlation

The editor loader and action generate one request id, send it as `X-Request-Id` on the private call, and return that same id on success metadata and on error results. A service error body does not replace it. Load and save failures render `Reference: <id>`. A conflict still says `Request id:` and uses the same generated id.

Both processes write one JSON access line to stdout. The line has `requestId`, `method`, `path`, `status`, and `durationMs`. The path has no query string. The shared formatter in `packages/contracts/src/request-log.ts` drops `authorization`, `cookie`, and `set-cookie`, and it does not copy the request body. A bearer token used as the request id is replaced with `[redacted]`. Fastify's own request lines stay off through `logController`, so this access line is the request log. The existing 500 failure log can still include redacted stack frames.

## Checks

- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest passed 65 tests in `@reactiv/contracts`, 222 in `@reactiv/config-service`, and 336 in `@reactiv/editor`.
- A failed save through the editor action returns the id the stub recorded on `X-Request-Id`, and the error state shows `Reference:` with that id. The log snapshot for that request omits the bearer token and the title from the document body.
- The config-service access line for a failed `PUT` that carries a bearer token, a cookie, and a document title contains the request id, method, path, and status, and omits the token and the title.

## Manual id match

The check used a separate editor on `http://127.0.0.1:5198/` and a separate config service on `127.0.0.1:4028`. The processes already listening on 5173 and 4001 were left running. The editor loaded `cfg_demo`. Postgres was then stopped, and Save was clicked after the title was changed.

The page showed `The draft was not saved.`, `The editor could not complete the request.`, and `Reference: 46aad2d8-344e-4ac2-b33e-bb9378b69209`.

Editor stdout:

`{"requestId":"46aad2d8-344e-4ac2-b33e-bb9378b69209","method":"POST","path":"/","status":500,"durationMs":27}`

Config-service stdout:

`{"requestId":"46aad2d8-344e-4ac2-b33e-bb9378b69209","method":"PUT","path":"/v1/configurations/cfg_demo","status":500,"durationMs":7.373699999996461}`

The load before that save used `88b15676-fcda-4a9d-a8ab-4d2b9426d516` on both `GET /` and `GET /v1/configurations/cfg_demo`. Neither process log contained the bearer token or the title string from the unsaved document. The access lines did not contain `authorization`, `cookie`, or a stack. Postgres was started again, and the isolated processes were stopped. The failed save did not replace the stored document.

## Acceptance progress

R09 passes. A failed save carries one correlation id from the editor action to the config-service log and to the on-screen reference. Credentials and the configuration body are not on the access line.

A07 stays passed. The new access line does not include a stack or a token. Evidence added here: `packages/contracts/src/request-log.test.ts` and `apps/config-service/src/http/request-log.test.ts`, plus the manual log check above. Response bodies still use `code`, `message`, and `requestId`.
