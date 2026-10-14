# Prompt 10 — Loader and action mediation

Implement only this prompt. Preconditions: prompt 09 is done. The server-only client tests pass. The page at `/` still does not need to be the full editor.

## Read first

- Architecture section 7, "Initial load" and "Save", including CSRF / origin and the ban on `clientLoader` and `clientAction`
- React Router loader and action docs for the pinned version
- Take-home PDF page 3, Server-Side API Access
- Acceptance criteria A10, A11, A01. A11 passes here. A10's code path exists here and is fully proven in prompt 25. A01 waits for Context in prompt 12

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- The browser talks to the editor origin only. The loader and the action call `configuration.server.ts`.
- The demo configuration id comes from `getDemoScope()`, never from the query string or the action body.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/10-loader-and-action-mediation.md`.
- Do not build inspectors, preview components, or import/export yet. A minimal page that shows loaded JSON is in scope so the path can be tested.

## Goal

On `GET /`, a server loader fetches the seeded configuration and returns it as data. On `POST /`, a server action validates an `EditableDocument`, sends a conditional `PUT` with the server token, and returns the service result. Neither function runs in the browser bundle.

## Implement

1. Route module at `apps/editor/app/routes/editor.tsx`, mounted at `/`. Keep route modules as normal route files. Do not rename the route module to `.server.tsx`; the framework already splits its loader and action. The private client stays in `.server.ts`.
2. Loader:
   - Calls `getDemoScope()` and then `getConfiguration(configurationId)`.
   - Returns the configuration and a safe page title. It may return `revision` because the later editor needs it for `If-Match`. It must not return the token, the service URL, or the tenant id as an authorization input the browser can change.
   - If the service is unavailable or misconfigured, return a structured error the page can render. Do not catch that error and substitute `createDemoDocument()`.
   - If the id is not found, return a not-found error. Do not seed inside the loader.
3. Action:
   - Accepts a JSON body `{ document, baseEtag }` posted to the app. `baseEtag` is the strong tag the loader last showed the user, not a tenant id.
   - Rejects the request when `Origin` is present and is not this app's origin. Missing `Origin` on a same-origin framework action is acceptable when the framework's own same-origin policy covers it; document which case you handled. A cross-origin `Origin` must fail without calling the private service.
   - Ignores any `tenantId`, `configurationId`, or `actorId` in the body. The id always comes from `getDemoScope()`.
   - Validates `document` with the shared schema. On failure, return 422 with the shared error issues and do not call the private service.
   - Calls `updateConfiguration` with the server-held token.
   - Returns the updated configuration, or the structured service error, to the browser. Never return the bearer token.
4. The page, still temporary:
   - Renders the loaded configuration as formatted JSON inside a `<pre>`, or renders the loader error message and request id.
   - A simple form or button is not required if a test can call the action directly. Do not spend time on styling.
5. Tests:
   - A request test or React Router stub invokes the loader and asserts it calls the private client. Mock the client module, not `fetch` inside a test that imports the client from a browser bundle.
   - The loader result has no property whose value equals the test token.
   - The loader, when the client returns not-found or unavailable, does not return the demo factory document.
   - The action with an invalid document does not call `updateConfiguration`.
   - The action with a valid document calls `updateConfiguration` with the demo id from the environment and the supplied ETag, even if the body contains a different `configurationId`.
   - A cross-origin `Origin` does not call `updateConfiguration`.
   - Source search: `apps/editor` contains no `clientLoader` and no `clientAction`.

## Out of scope

- Reducer, live preview, Save button UX, import/export, conflict UI.

## Acceptance criteria that fully pass

- **A11.** Initial configuration loading is a server loader. Persistence goes through a server action. There is no browser mount effect that loads the configuration, and no browser handler that calls the private service. Evidence: the route module, the absence of `clientLoader` / `clientAction`, and the action test that uses the server client.

A10 is implemented and not fully passed. Full pass requires a browser network trace in prompt 25 showing the page's configuration calls hit the editor origin while the private service is called from the server.

## Take-home PDF requirements that fully pass

- Page 3, Server-Side API Access: loaders fetch the configuration on the initial page load; server actions persist updates; the UI's data path is the app server. The "browser communicates only with the app server" sentence is code-complete here and observation-complete in prompt 25.

Not passed: reloading restores the configuration in a real editor session. The loader returns saved data, which is the mechanism, and the user-facing proof is prompt 20.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Seed and start Postgres, the config service, and the editor. Open `/` and confirm the six demo sections appear from the loader. Stop the config service, reload, and confirm the page shows an error rather than a freshly invented default document.
- In the browser devtools Network panel, confirm the document request does not go to port 4001 and the response JSON has no token. Record that observation in the note. Prompt 25 automates it.

## Done when

- A11 tests pass and the manual loader check behaves as specified.
- The note records the manual network observation without pasting the token.
- You have not started prompt 11.
