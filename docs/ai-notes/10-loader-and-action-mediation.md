# 10 — Loader and action mediation

13 October 2026. Prompt 11 was not started. The page at `/` is still not the editor.

## Route

`apps/editor/app/routes/editor.tsx` is mounted at `/` from `app/routes.ts`. It is a normal route module. The loader and the action import `configuration.server.ts`. React Router 7.18.4 removes `loader` and `action` from the browser module, so that import does not stay in the client graph. The private client stays in `.server.ts`. The route file was not renamed to `.server.tsx`.

The placeholder home route is gone. The credential search allows this one route file to import the server client. A component file that imports it still fails that search.

## Loader

`GET /` calls `getDemoScope(request)` and then `getConfiguration(configurationId)`. The request may be passed in. Its query string is not the configuration id. `getDemoScope` still reads only `DEMO_TENANT_ID` and `DEMO_CONFIGURATION_ID`.

A success payload is `{ title, configuration, etag }`. The title is `Editor`. `configuration` is the shared configuration, so `revision` is on that object. `etag` is the strong `ETag` header the service sent. A later save has to send that validator as `baseEtag`. The client does not build one from `revision`.

The payload does not include the tenant id, the service URL, or the bearer token. The configuration is parsed again with `configurationSchema` before it is returned, so an unknown field does not pass through.

A refused connection or a timeout is status 503 and `{ error: { code: "SERVICE_UNAVAILABLE", message, requestId } }`. A private 401 stays the sentence "The editor could not reach its configuration service." with status 500. That sentence does not say to sign in. A missing id is status 404 with the service `requestId` and "Configuration not found." An unreadable body is status 500. A thrown setup error uses the same safe sentence and does not copy the thrown text. None of these paths call `createDemoDocument` or `createConfiguration`. The loader does not insert a row.

A missing demo id is a 500 page error and does not call the private service.

## Action

`POST /` reads a JSON body `{ document, baseEtag }`. `baseEtag` is the strong tag the loader showed. Fields named `tenantId`, `configurationId`, and `actorId` are not read. The id passed to `updateConfiguration` is `getDemoScope().configurationId`.

If `Origin` is present and its origin is not `new URL(request.url).origin`, the action returns 403 and does not call the private service. An unparseable `Origin`, including the header value `null`, is rejected the same way.

A missing `Origin` is allowed. React Router 7.18.4 runs `throwIfPotentialCSRFAttack` before both document mutations and single-fetch actions. That check leaves `originDomain` null when the header is absent, so it does not reject the request. A same-origin framework submission is covered by that check. This action uses the same missing-header rule, and it still rejects a present cross-origin `Origin` when the action function is called directly.

An invalid `document` returns 422 with the shared error issues from `issuesFromZodError` and `formatError`. `updateConfiguration` is not called. A missing or blank `baseEtag` returns 428 and is not invented from `revision`. A body that is not a JSON object returns 400.

A valid document calls `updateConfiguration(configurationId, document, baseEtag)`. The server client attaches the bearer token. This action never sees that token and does not return it. Success returns the updated configuration and the `ETag` from the PUT response. A service failure returns the structured error: status, code, safe message, `requestId`, and issues when the code is `VALIDATION_FAILED`.

## Page

The page is temporary. A successful load renders the configuration as formatted JSON inside a `<pre>`. A failed load renders the error message and `Request id:`. There is no save button. The document sends `Cache-Control: private, no-store`. The module has no `useEffect`, no `clientLoader`, and no `clientAction`.

## Commands and results

- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 74 in `@reactiv/editor`.

Postgres was already running. `pnpm db:seed` exited 0 and printed `Left the existing row alone.` The configuration service listened on `127.0.0.1:4001`. The editor listened on `http://127.0.0.1:5199/`. Both processes were stopped after the checks. `pnpm dev:editor` and `pnpm dev:service` used the process environment. They did not read `.env` on their own. Seed did.

- `GET /` returned 200, `Cache-Control: private, no-store`, and HTML with a heading "Editor" and a `<pre>`. The six section ids were `section-carousel-1`, `section-text-1`, `section-cta-1`, `section-carousel-2`, `section-text-2`, and `section-cta-2`. The image ids were `image-carousel-1-1`, `image-carousel-1-2`, `image-carousel-2-1`, and `image-carousel-2-2`. The text included "New this week". The body did not contain the token, the tenant id, the service URL, port 4001, or `Bearer`.
- In the browser, the document request was `http://127.0.0.1:5199/`. Every resource origin was `http://127.0.0.1:5199`. None used port 4001. The page text included the six section ids. The dev module for `app/routes/editor.tsx` did not contain `configuration.server`, `getConfiguration`, `updateConfiguration`, the token, the tenant id, or port 4001.
- While that page loaded, the configuration service log showed `GET /v1/configurations/cfg_demo` with status 200. That call was from the editor server. The log lines did not include the token. The `Authorization` header was not recorded. Prompt 25 records it.
- After the configuration service was stopped, reload returned 503. The page showed "The configuration service is unavailable." and a request id. It did not show "New this week", the section ids, a `<pre>`, the token, the tenant id, the service URL, or "sign in". The browser origins were still only `http://127.0.0.1:5199`.

## Acceptance progress

A11 passes. Initial load is the server loader. Persistence is the server action. Shipping editor source has no `clientLoader` and no `clientAction`. The action tests call the mocked server client, not `fetch` from a browser bundle.

A10 is implemented and not fully passed. This check showed the browser talking only to the editor origin, and the service receiving the configuration GET from the server. Full pass is the prompt 25 network trace, including the service `Authorization` header.

A01 does not pass. React Context and `useReducer` are prompt 12.

Page 3 of the take-home PDF, Server-Side API Access, is met for this route: the loader fetches the configuration on the initial page load, the action is the persistence path, and the page's data path is the app server. The manual browser check above is the observation for this page. Prompt 25 automates it.

F01 does not fully pass. The loader showed the seeded six-section document, and a failed load did not substitute a factory document. The editor-and-preview reload proof is prompt 20.

Not passed: reloading restores a saved edit in a real editor session. The loader returns the stored document, which is the mechanism. The user-facing proof is prompt 20.
