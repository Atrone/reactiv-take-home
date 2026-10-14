# 05 — Configuration service authentication and errors

12 October 2026. Prompt 06 was not started. No acceptance ID fully passes.

## Authentication

Every path under `/v1` checks `Authorization: Bearer <token>` before a configuration read or write. The comparison uses `crypto.timingSafeEqual`. A missing header, an empty bearer token, a non-bearer scheme, and a mismatched token all return 401 `UNAUTHORIZED` with `Authentication failed.` The sentence does not say which of those cases it was, and the body does not echo the supplied token.

The check runs for paths that are not registered yet. Hiding a route is not the control, and CORS is not registered. Responses do not include `Access-Control-Allow-Origin`. A repository spy on a probe route is not called when the credential is missing or wrong. With the right token, that same unregistered path is Fastify's 404 and still does not return a configuration document.

`replace-me` is not a credential. A missing, blank, or placeholder `CONFIG_SERVICE_TOKEN` refuses to listen. The placeholder, including surrounding spaces, exits 1 with `Invalid environment variable: CONFIG_SERVICE_TOKEN` and does not print the value. A different token that only contains that text, such as `replace-me-extra`, can boot. If a server is constructed with the placeholder anyway, `Bearer replace-me` is still 401.

`GET /health` stays public. It returns `{"status":"ok"}`, does not read the database, and does not print the token. The service still binds to `127.0.0.1` by default.

## Tenant

The service tenant is `DEMO_TENANT_ID` from the environment. `X-Tenant-Id` and a body `tenantId` are ignored. That is commented next to the auth hook. A later optional prompt can replace this with a session-derived tenant. The caller is not trusted now.

## Request id

An incoming `X-Request-Id` is kept only when it matches `^[A-Za-z0-9_-]{1,80}$`. Spaces, newlines, a value longer than 80 characters, duplicate headers, and a value that contains the service token are replaced with a UUID. The id is on the `X-Request-Id` response header and on every error body.

## Errors

`/v1` failures go through one mapper and `formatError` from the contracts package. An unexpected exception is 500 `INTERNAL` with `The configuration service could not complete the request.` The JSON has no stack, SQL, token, or configuration document. The log records the request id and the error code. A 500 log may include stack frames. The error message line is left out, and the token, `Authorization` header, cookie, and parsed body are redacted.

## Write limits

These are registered now so later POST and PUT routes inherit them. They run after the bearer token matches. An unauthenticated write is 401 before them.

- A `Content-Type` other than `application/json` is 415 `UNSUPPORTED_MEDIA_TYPE`. `application/json; charset=utf-8` is still JSON.
- A body larger than 256 KiB, by `Content-Length` or by the bytes read, is 413 `PAYLOAD_TOO_LARGE` before JSON parsing. An invalid body of exactly 256 KiB is 400, not 413.
- Invalid JSON is 400 `MALFORMED_JSON`.

Authenticated POST and PUT attempts share an in-memory fixed window. The default is 600 per minute. `RATE_LIMIT_WRITES_PER_MINUTE` overrides it, and a test can pass `writeRateLimitPerMinute` when it builds the server. A full window returns 429 `RATE_LIMITED` and does not call the repository. GET is not counted. This is a local guard, not a proven production quota. A fixed window can allow two bursts around the minute boundary.

## Status codes

Implemented:

- 200 `GET /health`
- 401 `UNAUTHORIZED`
- 400 `MALFORMED_JSON`
- 413 `PAYLOAD_TOO_LARGE`
- 415 `UNSUPPORTED_MEDIA_TYPE`
- 429 `RATE_LIMITED`
- 500 `INTERNAL`

An authenticated request to an unregistered path is the framework's 404. That is not the tenant-scoped `NOT_FOUND` for a missing configuration. 201, 404 for a missing configuration, 412, 422, and 428 are not implemented. Create, load, and update handlers are not registered.

## Commands and results

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 100 in `@reactiv/config-service`, and 10 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- Boot with `CONFIG_SERVICE_TOKEN=replace-me` and a database URL exited 1. Stderr was `Invalid environment variable: CONFIG_SERVICE_TOKEN`. It did not print the placeholder or the database URL.
- Boot with a local dummy token on `127.0.0.1:4018`. `GET /health` returned 200 and `{"status":"ok"}`. `GET /v1/configurations/cfg_demo` without a token returned 401 and `{"error":{"code":"UNAUTHORIZED","message":"Authentication failed.","requestId":"..."}}`. The response had `X-Request-Id`. It had no `Access-Control-Allow-Origin`. The body and the process log did not contain the token. The process was then stopped.

## Acceptance progress

A08 does not pass. Unauthenticated and wrongly authenticated `/v1` requests are rejected before repository access. Create and update routes are not registered, so A08 does not fully pass.

A07 does not pass. The error JSON shape and safe 500s exist. The full status matrix is not done.

A09 does not pass. The token is read from the server environment in the service. This prompt did not add a browser client. Browser bundles are not proven.
