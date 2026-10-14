# Prompt 25 — Credential boundary proof

Implement only this prompt. Preconditions: prompt 24 is done. The editor can load, edit, and save.

## Read first

- Architecture sections 4 and 7, the browser → app server → private API path
- Architecture section 13, the app-boundary test rows
- Take-home PDF page 3, Private Authentication and Server-Side API Access
- Acceptance criteria A09, A10, Q01, and verification scenario T05

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- A passing test must fail if the token string is introduced into the client bundle or into a loader payload.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/25-credential-boundary-proof.md`.
- Do not weaken the product to make the test easier, for example by removing Save.

## Goal

Prove the private token never reaches the browser and that configuration reads and writes from the browser terminate at the editor origin.

## Implement

1. Production or dev client build of the editor. Pick the command the framework uses to emit the browser bundle (`react-router build` or the documented equivalent for the pinned version).
2. A test or script that reads the built client assets and fails if they contain the value of `CONFIG_SERVICE_TOKEN` used for that build. Use a distinctive test token such as `boundary-token-do-not-leak` so a substring collision with ordinary code is unlikely. Also fail if the bundle contains `CONFIG_SERVICE_TOKEN` as a property the client reads from `import.meta.env`.
3. Playwright:
   - Start the editor and the config service with that distinctive token, or stub the service if the stub still exercises the real server client. The test is stronger against the real service. Use the real service if Postgres is available.
   - Record browser requests while loading `/`, editing a title, and saving.
   - Assert every configuration read and write URL is the editor origin, not port 4001 and not `CONFIG_SERVICE_URL`.
   - Assert no browser request header contains the distinctive token.
   - Assert the HTML and the JSON payload of the loader do not contain the token.
   - Export JSON and assert the file text does not contain the token.
4. A server-side trace: the test config service, or a spy in front of the real one, must observe at least one authenticated `GET` and one authenticated `PUT` during that browser session. Calling `pg` from the editor does not satisfy this. Assert the editor package still has no `pg` dependency.
5. Write `docs/boundary.md` with a short trace a reviewer can follow: browser `GET /` → editor loader → `configuration.server.ts` → `GET /v1/configurations/:id`. And: browser action POST → editor action → `PUT /v1/configurations/:id` with `If-Match`. List the modules that are allowed to read the token. This file is the Q01 evidence, together with the code.

## Out of scope

- Penetration testing beyond this boundary, TLS certificates, and a public deployment.

## Acceptance criteria that fully pass

- **A09.** The service credential exists only in server environment and server modules. It is absent from browser bundles, HTML, loader payloads, exports, `localStorage`, browser request headers, and logs. The repository does not contain a real token. Evidence: bundle test, Playwright network test, export assertion, the prompt 24 log test, and a search that `.env` is gitignored.
- **A10.** Browser configuration traffic goes to the app server, and that server calls the private API with the server-held credential. Evidence: Playwright URLs plus the service's observed `Authorization` header on GET and PUT.
- **Q01.** UI, reducer, server client, contracts, and storage are separate. The `.server` client is the only editor module that talks to the private API. A reviewer can follow `docs/boundary.md` from an edit to a Save without a second copy of the validation rules. Evidence: that note and the import graph. Server-only modules are not imported by client components; the framework build is the check.

## Take-home PDF requirements that fully pass

- Page 3, Private Authentication: credentials live only on the server and are not exposed to the browser. Direct browser calls to the configuration service are not how the app works, and the network trace shows they do not happen.
- Page 3, Server-Side API Access: the browser communicates with the app server, which calls the configuration service.
- Page 4, separation of concerns: UI, state, server data access, and shared validation are distinct modules.

## Verification

- `pnpm test`
- `pnpm typecheck`
- The new Playwright boundary project, with its command recorded in the note
- Confirm `.env` is not tracked: `git status --short` must not show `.env` as a file you are about to add. Do not commit unless the user asks

## Done when

- A09, A10, and Q01 pass.
- The note records the bundle search and the Playwright result without the token value.
- You have not started prompt 26.
