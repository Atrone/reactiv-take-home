# Prompt 05 — Configuration service authentication and errors

Implement only this prompt. Preconditions: prompt 04 is done and repository tests pass. The service still has no configuration routes.

## Read first

- Architecture section 7, authentication paragraphs and the error JSON
- Architecture section 4, the private service boundary
- Take-home PDF page 3, Private Authentication, and page 2–3, consistent error responses and status codes
- Acceptance criteria A07, A08, A09. A08 does not fully pass until create, load, and update all enforce auth in prompt 07. A09 does not pass until the browser proof in prompt 25

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Missing or wrong credentials fail before any configuration read or write. Hiding a route or relying on CORS is not authentication.
- Do not log the token, the `Authorization` header, or cookies. Log the request id and the error code.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/05-configuration-service-auth-and-errors.md`.
- The service binds to `127.0.0.1` by default. Do not add `Access-Control-Allow-Origin: *`.

## Goal

Protect the future configuration routes with a server-held bearer token and a single error mapper. Health stays public and useless for data.

## Implement

1. Auth hook on every route under `/v1/*`. Compare the `Authorization: Bearer <token>` header to `CONFIG_SERVICE_TOKEN` using a constant-time comparison. Reject missing, empty, non-bearer, and mismatched tokens with HTTP 401 and error code `UNAUTHORIZED`. The message is a safe sentence such as `Authentication failed.` It must not say whether the token was missing or merely wrong, and it must not echo the supplied token.
2. If `CONFIG_SERVICE_TOKEN` is missing, blank, or the literal `replace-me`, refuse to listen, same as prompt 01. `replace-me` is not a valid credential.
3. Request ID: accept an incoming `X-Request-Id` only if it matches `^[A-Za-z0-9_-]{1,80}$`; otherwise generate a UUID. Put it on the response header `X-Request-Id` and on every error body. Do not accept newlines or spaces.
4. Error mapper used by all `/v1` failures. It emits only the contract error object. Unexpected exceptions become HTTP 500, code `INTERNAL`, message `The configuration service could not complete the request.`, with the request id. The response body has no stack, SQL, token, or upstream body. The server log may include the stack and the request id, and must not include the token or the configuration document.
5. Body handling for `/v1` writes, even though the write routes arrive in the next prompts. Register the limits now so later routes inherit them:
   - `Content-Type` other than `application/json` on `POST` and `PUT` returns 415 `UNSUPPORTED_MEDIA_TYPE`
   - a body larger than 256 KiB returns 413 `PAYLOAD_TOO_LARGE` before JSON parsing
   - invalid JSON returns 400 `MALFORMED_JSON`
6. `GET /health` stays unauthenticated, returns no configuration, and does not require the database. It still must not print the token.
7. Tenant: the service's tenant for this take-home is `DEMO_TENANT_ID` from the environment. Ignore any `X-Tenant-Id` or body `tenantId` from the caller. Document that in a short comment next to the auth hook. A later optional prompt can replace this with real session-derived tenants. Do not trust the caller now.
8. Rate limit: an in-memory counter on authenticated write attempts, default 600 per minute, overridable with `RATE_LIMIT_WRITES_PER_MINUTE`. When exceeded, return 429 `RATE_LIMITED` and do not touch the database. This is a local guard, not a proven production quota. Tests must be able to set a low limit.
9. Tests with the app injected, using Fastify's inject or equivalent, and a fake repository if the database is unnecessary for these cases:
   - `/health` without a token returns 200 and the body has no token
   - `GET /v1/configurations/cfg_demo` without a token returns 401 and does not call the repository. Use a repository spy
   - the same request with a wrong token returns 401 and does not call the repository
   - a request with the right token that falls through to a not-yet-implemented handler may return 404 for the path. That is fine. It must not return configuration data
   - oversized `Content-Length` or an oversized body returns 413
   - `text/plain` returns 415
   - `{` returns 400 `MALFORMED_JSON`
   - a thrown repository error returns 500 without a stack in the JSON
   - two responses carry request ids, and a too-long `X-Request-Id` is replaced rather than reflected

Do not implement the successful create, get, or update handlers in this prompt. A 404 from the framework for an unregistered path is acceptable after auth succeeds.

## Out of scope

- Successful persistence handlers, ETags, the editor, seed data.

## Acceptance criteria

No acceptance ID fully passes.

Progress that must be true:

- A08: unauthenticated and wrongly authenticated requests are rejected before repository access for the `/v1` namespace. Create and update routes are not registered yet, so A08 does not fully pass.
- A07: the error JSON shape and safe 500s exist. The full status matrix is not done.
- A09: the token is read from the server environment in the service. Browser bundles are not proven.

## Take-home PDF requirements

Page 3, Private Authentication, is in place for the service process: the credential lives in server environment, and direct calls without that credential do not read or mutate data. The PDF also requires that the browser never sees the credential. This prompt must not add a browser client. The browser proof is later.

Page 2–3, appropriate HTTP status codes: 401, 400, 413, 415, 429, and 500 are implemented for the cases above. 200, 201, 404 for a missing configuration, 412, 422, and 428 arrive with the real handlers.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Boot the service with token `replace-me` and confirm it exits
- Boot with a real local token and confirm an unauthenticated `GET /v1/configurations/cfg_demo` is 401

## Done when

- The auth tests pass and a repository spy proves auth runs first.
- The note records the status codes you implemented.
- You have not started prompt 06.
