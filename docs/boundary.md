# Credential boundary

The browser talks to the editor. The editor server talks to the private configuration API. The bearer token stays in that server.

## Load

1. The browser sends `GET /` to the editor origin.
2. The loader in `apps/editor/app/routes/editor.tsx` runs on the server. `getDemoScope()` chooses the demo configuration. The query string does not choose the tenant or the configuration id.
3. The loader calls `getConfiguration()` in `apps/editor/app/services/configuration.server.ts`.
4. That module reads `CONFIG_SERVICE_TOKEN` from the server environment and sends `GET /v1/configurations/:id` to `CONFIG_SERVICE_URL` with `Authorization`.
5. The loader returns the configuration, its strong ETag, a page title, and a request id. The token is not one of those fields.

## Save

1. The browser posts `{ document, baseEtag }` to `POST /?index` on the editor origin. The request does not set `Authorization`.
2. The action in `apps/editor/app/routes/editor.tsx` checks the origin, parses the JSON, and validates the document with `editableDocumentSchema` from `@reactiv/contracts`.
3. The action calls `updateConfiguration()` in `apps/editor/app/services/configuration.server.ts`.
4. That module sends `PUT /v1/configurations/:id` with `If-Match` set to the loaded strong ETag and `Authorization` set from the server environment.
5. The action returns the saved configuration or a safe error. The token is not in that result.

An edit is local reducer state until Save. The reducer does not call the private API. The same `editableDocumentSchema` is what the configuration service parses. The editor does not keep a second copy of those rules.

## Modules allowed to read the token

The editor process has one reader:

- `apps/editor/app/services/configuration.server.ts`

The configuration service process has to know the credential in order to check it:

- `apps/config-service/src/env.ts` reads the variable.
- `apps/config-service/src/http/v1-guard.ts` compares the request header to that value.
- `apps/config-service/src/http/request-id.ts` will not use the token as a request id.
- `apps/config-service/src/http/service-error.ts` redacts the token from error text.
- `apps/config-service/src/index.ts` and `apps/config-service/src/db/seed-env.ts` run the startup check that rejects a missing token and the placeholder `replace-me`.

`apps/config-service/src/http/bearer-auth.ts` compares a header to a value it is given. It does not read the environment.

The UI under `apps/editor/app/features/`, the reducer in `editor-reducer.ts`, and `packages/contracts` do not read the token. Postgres access stays in `apps/config-service/src/configurations/repository.ts`. The editor package does not depend on `pg`.

Client components do not import `.server` modules. `react-router build` is the check that those modules stayed out of the browser bundle.
