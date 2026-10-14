# 09 — Server-only configuration client

12 October 2026. Prompt 10 was not started. The editor still does not load a configuration.

## Client

`apps/editor/app/services/configuration.server.ts` is the only editor module that reads `CONFIG_SERVICE_TOKEN` or opens a socket to `CONFIG_SERVICE_URL`. The file name ends in `.server.ts`. React Router 7.18.4 excludes those modules from the client bundle and fails the build if a client module imports one. Route files stay ordinary modules.

The URL and token are read from the process environment at call time. The editor does not load `.env`. A missing URL, a missing token, a blank value, or a token whose trimmed text is `replace-me` throws `EditorServerEnvError` before `fetch`. An unusable URL, including a non-HTTP scheme or userinfo, throws the same way. The sentence names the variable. It does not include the token or the rejected URL.

`assertEditorServerEnv()` is that check. `app/entry.server.tsx` calls it before rendering, and each client method calls it again before opening a socket. This app has no separate listen entry, so the process does not exit at startup the way the configuration service does. The request fails instead. With both variables unset, `GET /` returned 500 and the body named `CONFIG_SERVICE_URL` and `CONFIG_SERVICE_TOKEN`. With the token set to `replace-me`, the body was `Invalid environment variable: CONFIG_SERVICE_TOKEN` and did not contain `replace-me`.

Successful calls send `Authorization: Bearer <token>` and `Accept: application/json`. POST and PUT also send `Content-Type: application/json`. Redirects are not followed, so the bearer token stays on the configured URL. The timeout is 5 seconds. A timeout or a refused connection returns `{ ok: false, kind: "unavailable" }`. The raw `fetch` error is not returned.

A 401 returns `{ ok: false, kind: "misconfigured", message: "The editor could not reach its configuration service." }`. That sentence does not say the user must sign in. The response body is not copied, so a token in that body is not returned.

GET and PUT treat 200 as success. POST treats 201 as success. The body is parsed with `configurationSchema`. A success status whose body fails that schema is `{ ok: false, kind: "internal" }`. The ETag on a success result is the response header. The client does not build one from `revision`.

Other statuses are parsed with the shared error schema after unknown keys are removed. The result keeps the HTTP status, `code`, `requestId`, and `issues` (`path` and `message` only). The service `message` and any other field, including a token or a stack, are dropped. A body that still does not match the schema is an internal result.

`getConfiguration(id)`, `createConfiguration(document)`, and `updateConfiguration(id, document, etag)` are the three calls. `updateConfiguration` sets `If-Match` to the strong ETag it was given. It does not invent a revision.

## Demo scope

`getDemoScope()` in `apps/editor/app/services/session.server.ts` returns `{ tenantId, configurationId }` from `DEMO_TENANT_ID` and `DEMO_CONFIGURATION_ID`. This is demo scope, not production authentication. The function may receive the request. It does not read `tenantId`, `actorId`, or `configurationId` from the query string or the body. A missing or blank id throws a sentence that names the variable and does not include the value.

## What is not wired

There is no route loader, action, `clientLoader`, or `clientAction`. The home page is still the placeholder. Nothing in the editor calls this client to load the demo seed.

## Commands and results

- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 28 in `@reactiv/editor`.
- `apps/editor/package.json` does not depend on `pg`.
- A search for `CONFIG_SERVICE_TOKEN` under `apps/editor`, excluding `node_modules`, hits only `app/services/configuration.server.ts` and `app/services/credential-boundary.test.ts`.

The editor was started on `http://127.0.0.1:5199/` and then stopped.

- With `CONFIG_SERVICE_URL` and `CONFIG_SERVICE_TOKEN` unset, `GET /` returned 500. The body named both variables. It did not include the local token, `replace-me`, or "sign in", and it did not render the placeholder.
- With the URL set and the token `replace-me`, `GET /` returned 500. The body was `Invalid environment variable: CONFIG_SERVICE_TOKEN` and did not contain `replace-me`.
- With those two variables taken from the local `.env` into the process environment, `GET /` returned 200 and the HTML included "The editor is not built yet." The body did not contain the token. A browser load showed the heading "Editor" and that sentence. Resource requests stayed on port 5199. None went to port 4001, and the browser did not request `configuration.server`. That observation is not a production bundle inspection or a Playwright trace.

`pnpm dev:editor` uses the process environment. It does not read `.env` on its own. The same is true of `pnpm dev:service`.

## Acceptance progress

A09 does not pass. The token is read only in the `.server.ts` client. Browser bundles, production HTML, loader payloads, and a Playwright network trace are not inspected yet.

A10 does not pass. This client is the module a loader will call. No loader calls it yet.

A11 does not pass. There is no `clientLoader` or `clientAction`. The real server loader does not exist yet.

Page 3 of the take-home PDF is not fully met. The credential stays in this server module, and the placeholder page does not call the private service. A loader and an action do not use the client yet.

F01 does not pass. The seeded document is still not loaded by the editor.
