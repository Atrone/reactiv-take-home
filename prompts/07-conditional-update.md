# Prompt 07 — Conditional update

Implement only this prompt. Preconditions: prompt 06 is done. Create and load pass their tests.

## Read first

- Architecture section 7, the `PUT` row, `If-Match`, and status codes 412 and 428
- Architecture section 8, the conditional SQL and the rule that success is returned only after commit
- Take-home PDF pages 2–3: update, validation, consistent errors, appropriate status codes
- Acceptance criteria A02, A05, A06, A07, A08, D05, D06, D07, P06. D07's API half is this prompt. D07 fully passes in prompt 19

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- `PUT` replaces the whole document. There is no patch of a single section.
- The expected revision comes only from `If-Match`, not from the body.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/07-conditional-update.md`.
- Do not build the editor.

## Goal

`PUT /v1/configurations/:id` commits a validated document only when the caller's strong ETag matches the stored revision. A stale or missing precondition does not change the row. Invalid payloads do not change the row.

## HTTP contract

`PUT /v1/configurations/:id`

- Auth required, same hook as prompt 05.
- Body is an `EditableDocument`.
- Require `If-Match` with the strong quoted revision from the last `GET` or write, such as `"1"`. Missing `If-Match` returns 428 `PRECONDITION_REQUIRED` and does not write.
- `If-Match: *` returns 428. A weak ETag returns 428. A revision that is not the current one returns 412 `PRECONDITION_FAILED` and does not write.
- Success: the repository update commits, then the handler returns 200 and the new `Configuration`. `revision` is the previous revision plus 1. `updatedAt` is the database timestamp. `ETag` is the new quoted revision. `Cache-Control: private, no-store`.
- Unknown id for this tenant: 404 `NOT_FOUND` after the repository distinguishes not-found from conflict. Do not create the row on `PUT`.
- Invalid document: 422 `VALIDATION_FAILED` with `issues`, and the previous row is still readable with the same `updatedAt` and `data`.
- Validate the body before the conditional update so a bad payload does not burn a revision.
- 413, 415, and 400 behave as in prompt 05.

Map repository results to those statuses inside the service. The repository remains free of HTTP types if that split is already true; a thin mapper in `src/http/` is the right place.

## Tests

- Update a created document with the correct `If-Match`. `GET` returns the new sections, the new revision, and a later timestamp.
- Update with the previous ETag after a successful update returns 412. `GET` still shows the winner's document.
- Two updates that both send the original ETag: one 200, one 412, stored revision increased by one.
- Missing `If-Match` returns 428 and the row is unchanged.
- `If-Match: *` returns 428 and the row is unchanged.
- Unknown id returns 404 and does not insert.
- Invalid color, invalid URL, duplicate ids, and schema version 2 return 422 and the previously stored JSON compares equal, including `updatedAt`.
- `PUT` without a token and with a wrong token returns 401 and does not change the row. This, together with the prompt 06 auth tests, is the A08 evidence for all three operations.
- A successful body matches the `Configuration` schema. An error body matches the error schema and has no stack or token.
- Force a repository throw and confirm 500 `INTERNAL` with a request id and no stack in the JSON.

## Out of scope

- The editor's conflict screen, save reconciliation, seed, loaders. Those consume this API later.

## Acceptance criteria that fully pass

- **A02.** REST implements load-by-id, create, and update. Request, response, and error schemas are the shared contracts. Evidence: contract tests plus these route tests. A configuration picker is not required.
- **A05.** Updating an existing id stores the whole validated payload and returns 200 with new metadata. An unknown target returns 404. Evidence: update, get, and unknown-id tests.
- **A06.** Invalid data that bypasses any future browser checks fails with 422, and the previous record is unchanged. Evidence: direct invalid `PUT` and a stored-row comparison.
- **A07.** Errors use the documented `code`, `message`, and `requestId` structure; validation errors include field `issues`. 400, 401, 404, 412, 413, 415, 422, 428, and 500 are used as specified. Bodies omit secrets and stack traces. Evidence: the status tests in prompts 05–07.
- **A08.** Load, create, and update all reject a missing credential and a wrong credential before data is read or mutated. Evidence: spy or unchanged row counts on all three operations.
- **D05.** Stored and returned configurations include string `id`, numeric `schemaVersion`, timestamp `updatedAt`, and `data`. Create and update responses match the schema. The service assigns ids and timestamps. Evidence: response parses and a database read.
- **D06.** The payload is an ordered section list with the required carousel, text, and CTA fields, and a full-document update round-trips them. Evidence: write the six-section fixture, update one field, read it back.
- **D07 does not fully pass yet.** The API half is required here: `#123` and `#12ABEF` are accepted and normalized; `#12`, `#GGGGGG`, and script, data, and file URLs are rejected on writes. Evidence: direct API tests. D07 also requires the same rules on import and plain-text rendering. Those pass in prompts 13 and 19. Do not mark D07 passed in this note.
- **P06.** A rejected or failed update leaves the previous complete configuration readable. `data` and `updatedAt` stay together. Validation happens before mutation. Evidence: 422 and 412 tests.

## Take-home PDF requirements that fully pass for the API

- Page 2–3, API Design: REST endpoints to load by ID, create, and update; explicit schemas; validation; consistent errors; HTTP status codes; schema version 1 with rejection of unknown versions.
- Page 2, configuration object: id, schemaVersion, updatedAt, data, plus the architecture's revision.
- Page 3, Private Authentication, for the service boundary: all three operations require the server-side token.

Not passed yet: browser never sees the token (A09), loaders and actions (A10, A11), refresh in the UI (P02).

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manual PowerShell calls for one successful conditional update and one stale `If-Match`, with the token only in a local variable, not printed in the note

## Done when

- The IDs listed above have passing tests.
- The note records the ETag format you shipped.
- You have not started prompt 08.
