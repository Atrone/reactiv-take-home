# Prompt 09 — Server-only configuration client

Implement only this prompt. Preconditions: prompt 08 is done. The demo seed can be read with a direct service call. The editor still does not load it.

## Read first

- Architecture sections 4 and 7: `.server.ts` client, bounded timeout, server-held credential, validate service responses, map a private 401 to a safe error
- React Router server-module docs for the pinned version (architecture sources T1–T3)
- Take-home PDF page 3: credentials only on the server; the browser never calls the configuration service with credentials
- Acceptance criteria A09, A10, A11. They do not fully pass in this prompt

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- The only module in the editor app that may open a socket to `CONFIG_SERVICE_URL` or read `CONFIG_SERVICE_TOKEN` is `apps/editor/app/services/configuration.server.ts`.
- Do not add a `clientLoader` or `clientAction`.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/09-server-only-configuration-client.md`.
- Do not render an editor yet.

## Goal

A server-only HTTP client that create, get, and update the private API with the server token, validates the JSON it gets back, and returns typed results the loader and action can use in the next prompt.

## Implement

1. `apps/editor/app/services/configuration.server.ts`
   - Reads `CONFIG_SERVICE_URL` and `CONFIG_SERVICE_TOKEN` at call time from the server environment.
   - If the URL is missing, the token is missing, or the token is `replace-me`, throw a setup error that names the variable and does not include a credential. The editor process should fail the same way at startup if you already have a server entry where that check is natural. A check inside the client plus a small `assertEditorServerEnv()` called from the server entry both count, as long as a missing token cannot reach the browser.
   - Sends `Authorization: Bearer <token>` and `Accept: application/json`.
   - `getConfiguration(id)`, `createConfiguration(document)`, `updateConfiguration(id, document, etag)`.
   - Timeout 5 seconds. On timeout or network failure, return a typed `unavailable` result. Do not throw a raw `fetch` error to a future UI without mapping it.
   - If the service responds 401, return a typed `misconfigured` result whose safe message is `The editor could not reach its configuration service.` Do not say the user must sign in. Do not include the token.
   - Parse success bodies with the `Configuration` schema. A success status with an invalid body is an internal result, not editor data.
   - Parse error bodies with the error schema. Keep `issues`, `code`, and `requestId`. Drop anything else.
   - `updateConfiguration` sends `If-Match` with the strong ETag it was given. It does not invent a revision.
2. The file name ends in `.server.ts` so the framework build fails if a client module imports it. Add a comment at the top that states that rule.
3. `apps/editor/app/services/session.server.ts`
   - Exports `getDemoScope()` which returns `{ tenantId, configurationId }` from `DEMO_TENANT_ID` and `DEMO_CONFIGURATION_ID`.
   - Ignores request query parameters and body fields named `tenantId`, `actorId`, or `configurationId`. The function signature may accept the request and must not read those fields from it.
   - This is demo scope, not production authentication. Say that in the block comment.
4. Unit tests with a local stub HTTP server, or `fetch` mocked at the boundary:
   - get sends the bearer token and does not put the token in the returned value
   - a 401 from the stub becomes `misconfigured` and the message does not contain the token
   - a hanging stub trips the timeout and becomes `unavailable`
   - an invalid 200 body becomes an internal result
   - update sends the `If-Match` value it was given
   - a 422 body preserves `issues` and `requestId`
5. Add a static test or lint check that searches `apps/editor` for `CONFIG_SERVICE_TOKEN` and fails if any file other than `configuration.server.ts` and server-only env helpers references it. The test must also fail if a client component file imports `configuration.server`.

## Out of scope

- Wiring the client to a route loader, UI, import/export.

## Acceptance criteria

No acceptance ID fully passes.

Progress that must be true:

- A09: the token is read in a `.server.ts` module. Bundles and browser network traffic are not inspected yet.
- A10: the client is the module the loader will use. No browser path exists yet.
- A11: no `clientLoader` or `clientAction` exists. The real loader does not exist yet.

## Take-home PDF requirements

Page 3, Private Authentication and Server-Side API Access: this client is the only place the editor process can hold the credential. The PDF requirement is not fully met until a loader and action use it and a browser proof shows the page does not call the private service.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Confirm the editor still has no `pg` dependency
- Confirm a search for `CONFIG_SERVICE_TOKEN` under `apps/editor` hits only the server module and the test that guards it

## Done when

- The client tests pass, including the 401 mapping.
- The note records the timeout and the safe 401 message.
- You have not started prompt 10.
