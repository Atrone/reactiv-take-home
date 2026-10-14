# Prompt 06 — Create and load a configuration

Implement only this prompt. Preconditions: prompt 05 is done. Auth tests pass. `PUT` is not implemented yet.

## Read first

- Architecture section 7, the contract table rows for `GET` and `POST`
- Take-home PDF pages 2–3: load by ID, create, validation, status codes, schema fields
- Acceptance criteria A03, A04, A08, D05, D06, D07

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Re-validate every write with the shared Zod schema even if the caller claims to have validated it.
- The service generates `id`, `revision`, and `updatedAt`. Never take them from the body.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/06-create-and-load-configuration.md`.
- Do not implement `PUT` here.

## Goal

`POST /v1/configurations` stores a new document and `GET /v1/configurations/:id` reads it back for the same tenant. Unknown ids return not-found. A second create never overwrites the first.

## HTTP contract

`POST /v1/configurations`

- Auth required.
- Body is an `EditableDocument`.
- On success, HTTP 201, `Location: /v1/configurations/<id>`, `Content-Type: application/json`, body is `Configuration`.
- Strong `ETag` header whose value is the quoted revision, for example `"1"`. Not a weak ETag.
- Generate the id in the service as `cfg_` plus a UUID. Do not accept an id in the body.
- Persist with the repository insert and revision 1.
- Invalid document: HTTP 422 `VALIDATION_FAILED` and `issues` with field paths. The database is unchanged.
- Malformed JSON and oversize bodies stay on the prompt 05 behavior.

`GET /v1/configurations/:id`

- Auth required.
- 200 and the `Configuration` body when the tenant has that id, plus the strong ETag for its revision.
- 404 `NOT_FOUND` when that tenant has no such id. The message must not reveal whether another tenant has the id. The repository call stays tenant-scoped.
- Response `Cache-Control: private, no-store`.

There is no list endpoint.

## Tests

Use the test database and the real repository, not a fake, for the success paths. A spy is still appropriate for the auth tests that must prove the repository is not called.

- Create a valid six-section demo document. The response is 201, includes an id the client did not send, `schemaVersion` 1, `revision` 1, an ISO `updatedAt`, and the same ordered sections.
- `GET` that id with the token returns the same payload.
- `GET` an unknown id returns 404.
- A second `POST` returns a different id. `GET` of the first id still returns the first payload.
- `POST` with schema version 2, a `quiz` section, a bad color, a `javascript:` URL, or a duplicate section id returns 422 and `GET` of any previously created id is unchanged.
- `POST` and `GET` without a token, and with a wrong token, return 401 and do not insert or read. Assert the row count is unchanged on the unauthenticated `POST`.
- A body that includes `id` or `updatedAt` is 422 because those keys are not part of `EditableDocument`.
- The success response parses with the shared `Configuration` schema.

## Out of scope

- `PUT`, editor UI, seed of `cfg_demo`, ETag on update.

## Acceptance criteria that fully pass

- **A03.** Loading a known id returns that configuration. An unknown id returns 404 rather than another configuration or a default document. Evidence: the known-id and unknown-id tests.
- **A04.** Creating a valid configuration stores it, assigns a service-generated id, and returns 201. A second create does not overwrite the first. Evidence: two creates and two gets.

These do not fully pass yet:

- A02, because update is missing
- A08, because update is not yet covered, even though create and load reject bad credentials
- D05, D06, D07, because update responses and a stored-record comparison after a rejected update are not done

## Take-home PDF requirements that are met for create and load

- Page 2–3: load a configuration by ID; create a configuration; explicit schemas; validation of hex colors and URLs; 201 and 404; version rejection for schema version other than 1.
- Page 2: each stored configuration includes id, schemaVersion, updatedAt, and data. `revision` is also present.
- Page 3: these two operations require private authentication.

Not met yet: update, server-side loaders and actions, the editor, reload in the browser.

## Verification

- `pnpm test`
- `pnpm typecheck`
- With Postgres running, create a document with `Invoke-RestMethod` or an equivalent PowerShell request and fetch it with the bearer token. Then repeat the fetch without the token and confirm 401.

## Done when

- A03 and A04 tests pass.
- The note records a sample 201 body with the token redacted.
- You have not started prompt 07.
