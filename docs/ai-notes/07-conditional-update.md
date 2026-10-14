# 07 — Conditional update

12 October 2026. Prompt 08 was not started. The editor, seed, and `cfg_demo` were not added.

## ETag format

The strong validator is a quoted decimal revision with no weak prefix. Create returns `ETag: "1"`. A successful update returns the next revision in the same form, such as `ETag: "2"`. `If-Match` must send that exact value, including the quotes. `Cache-Control` on the configuration response is `private, no-store`. There is no `Location` header on `PUT`.

These `If-Match` values are `428` `PRECONDITION_REQUIRED` and do not write: missing, empty, `*`, a weak tag (`W/"1"` or `w/"1"`), an unquoted number, a list, a leading zero, and a number outside the positive 32-bit revision column (`1` through `2147483647`). A well-formed revision that is not the stored one is `412` `PRECONDITION_FAILED` when this tenant has the row. A well-formed revision for an id this tenant does not have is `404` `NOT_FOUND`. `PUT` does not insert.

The expected revision is only the `If-Match` value. `id`, `revision`, `updatedAt`, and `tenantId` in the body are `422`. The header is checked before the document schema. A missing or unusable `If-Match` is `428` even when the body would also fail validation. A usable `If-Match` with an invalid document is `422`, and the repository update is not called, so the revision is not incremented.

`PUT` replaces the whole section list. There is no `PATCH`. The handler returns `200` only after the repository commits the conditional update.

## Sample update

The service listened on `127.0.0.1:4027`. The bearer token stayed in a local variable. `POST /v1/configurations` returned `201`, `ETag: "1"`, `Cache-Control: private, no-store`, and no `Access-Control-Allow-Origin`. The new id was `cfg_9ca9cf48-d0cb-4df0-94e1-0fba83d498ed`, revision `1`, `updatedAt` `2026-10-12T22:36:29.756Z`.

`PUT` of that id with `If-Match: "1"` and title color `#123` and description color `#12ABEF` returned `200`, `ETag: "2"`, `Cache-Control: private, no-store`, revision `2`, and `updatedAt` `2026-10-12T22:36:29.835Z`. The stored title was `After`. The colors were `#112233` and `#12abef`.

The same `If-Match: "1"` after that update returned `412`:

```json
{"error":{"code":"PRECONDITION_FAILED","message":"The configuration revision does not match.","requestId":"ff7abbaf-781c-4037-905b-e10f9855305a"}}
```

The body had no stack and no token. `GET` still returned revision `2`, title `After`, and `updatedAt` `2026-10-12T22:36:29.835Z`, with `ETag: "2"`. The process log did not contain the token or the database URL. Both sample rows were then deleted. A count of those ids afterward was 0. `cfg_demo` is still not seeded.

## Commands and results

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 168 in `@reactiv/config-service`, and 10 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- With Postgres running, PowerShell created a document and updated it with the strong ETag from the create response. A second `PUT` with that original ETag returned `412`, and `GET` still showed the updated document.

## Acceptance progress

A02 passes. Load, create, and update are registered. Request, response, and error bodies use the shared schemas. Evidence: the contract tests and the create, load, and update route tests. A configuration picker is not part of this prompt.

A05 passes. A matching `If-Match` stores the whole validated document and returns `200` with revision plus one, a database `updatedAt`, and the new strong ETag. An unknown id returns `404` and does not insert. Evidence: the update, get, unknown-id, and other-tenant tests.

A06 passes. Invalid color, URL, duplicate ids, schema version `2`, and service-owned keys return `422` with `issues`. The stored JSON text, revision, and `updatedAt` compare equal, and `GET` still returns the previous document. Evidence: the invalid `PUT` tests.

A07 passes. Errors use `code`, `message`, and `requestId`. Validation errors include `issues`. `400`, `401`, `404`, `412`, `413`, `415`, `422`, `428`, and `500` are covered across prompts 05–07. Bodies omit the token and stack traces. Evidence: the status tests in those prompts, including the forced repository `500`.

A08 passes. Load, create, and update reject a missing credential and a wrong credential before the repository is called. An unauthenticated `PUT` leaves the stored revision, data, and `updatedAt` unchanged. Evidence: the prompt 06 auth tests and the update spy and unchanged-row tests.

D05 passes. Create and update responses parse as `Configuration`, with string `id`, numeric `schemaVersion`, timestamp `updatedAt`, `data`, and `revision`. The service assigns the id and the database assigns `updatedAt`. Evidence: response parses and the stored-row reads.

D06 passes. The six-section fixture is stored, one text field is updated, and `GET` returns the new sections in order with the new revision and a later timestamp. A later `PUT` of a one-section document replaces the whole list. Evidence: the round-trip test.

D07 does not pass. The API half is in place: `#123` and `#12ABEF` are accepted and stored as `#112233` and `#12abef`. `#12`, `#GGGGGG`, and script, data, and file URLs return `422` and leave the previous row unchanged. Import and plain-text rendering are still required. Those are prompts 13 and 19.

P06 passes. A `422` or `412` leaves the previous complete configuration readable. `data` and `updatedAt` stay together. Validation runs before the conditional update. Evidence: the `422` and `412` tests.

Page 2–3 API design is in place for this service: load by id, create, and update, explicit schemas, validation, consistent errors, and schema version `1` with other versions rejected. The configuration object is `id`, `schemaVersion`, `updatedAt`, `data`, and `revision`. All three operations require the server-side token.

Not passed yet: the browser never sees the token (A09), loaders and actions (A10, A11), and refresh in the UI (P02).
