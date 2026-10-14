# 02 — Shared contracts and validation

12 October 2026. Prompt 03 was not started. No acceptance ID fully passes.

## Zod

`npm view zod version` reported 4.6.7 as `latest`. `@reactiv/contracts` depends on `zod` 4.6.7 with no caret. The lockfile contains `zod@4.6.7` and no `zod@3`. Nothing in the repo required Zod 3. pnpm added `zod@4.6.7` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` during install. Vitest 5.0.4, already used by both apps, is the contracts test runner. `@types/node` 24.19.2 matches the other packages so `TextEncoder` typechecks.

Zod 4 `z.object()` strips unknown keys, so the document and error objects use `z.strictObject()`. Color normalization uses `.overwrite()` rather than `.transform()`. In Zod 4.6.7, `toJSONSchema` cannot represent a transform. The first hex pattern used a non-capturing group, so `normalizeHexColor("#123")` and `normalizeHexColor("#12ABEF")` returned null and a successful overwrite would have kept the original text. The pattern now captures the digits. `#123` becomes `#112233`, and `#12ABEF` becomes `#12abef`.

## Schema choices

`/v1` is `HTTP_API_PREFIX`. `schemaVersion` is the literal `1`. `revision` is an integer greater than or equal to 1 on `Configuration`. A write body that includes `id`, `revision`, `updatedAt`, or `tenantId` fails `editableDocumentSchema`.

CTA labels are trimmed at the ends and then checked for 1–120 characters. The stored label is the trimmed string. Internal spaces stay. Title, description, and alt text are not trimmed, so a description keeps its line breaks. `http:` and `https:` URLs both pass. `updatedAt` accepts `Z`, `+00:00`, and `-00:00`. Zod's default datetime accepts only `Z`; zero offsets are UTC, and a non-zero offset such as `-04:00` fails. Image ids are unique inside one carousel. The same image id may appear in another carousel.

`payloadUtf8ByteLength` counts UTF-8 bytes with `TextEncoder`. A 256 KiB payload passes `isPayloadWithinLimit`. One extra byte fails. A string of U+00E9 characters can fail while its JavaScript length is still under 256 KiB. Callers use this before `JSON.parse`.

`editableDocumentJsonSchema`, `configurationJsonSchema`, and `errorBodyJsonSchema` are `z.toJSONSchema` output. There is no handwritten second schema. `issuesFromZodError` turns Zod's unrecognized-key list into paths such as `id` and `data.sections[0].position`.

## Commands and results

- `pnpm typecheck` exited 0. That typechecked `@reactiv/contracts` (including its tests), the config service, and the editor.
- `pnpm test` exited 0. Vitest 5.0.4 passed 29 tests in `@reactiv/contracts`, 30 in `@reactiv/config-service`, and 10 in `@reactiv/editor`.
- `@reactiv/editor` and `@reactiv/config-service` depend on `@reactiv/contracts`. Neither app package depends on `zod`. A contracts test reads both app trees and finds no `zod` import in application source.

## Acceptance progress

D05 and D06 do not pass. The shared types and Zod schemas include `id`, `schemaVersion`, `updatedAt`, `revision`, and the ordered section fields. The API does not store or return them yet.

D07 does not pass. `#123` and `#12ABEF` normalize in the parser. `#12`, `#GGGGGG`, `#11223344`, and script, data, and file URLs fail in unit tests. Import and the API do not enforce this yet.

D08 does not pass. `schemaVersion` other than `1` fails in the parser, including `2` and the string `"1"`. The README explanation does not exist yet.

R07 does not pass. `LIMITS` and the byte-length helper are tested. The UI and API do not enforce them yet.

A06 and A07 do not pass. The error object and codes exist. HTTP status mapping does not.

## Follow-up tests

The same schemas gained tests for edges found while reviewing the implementation. `@reactiv/contracts` now has 42 passing tests. `pnpm typecheck` and `pnpm test` still exit 0. The config service still has 30 tests, and the editor still has 10.

A section whose fields would be a valid text block still fails when `type` is `quiz` or `Carousel`. The issue path is the `type` field. `#123` and an already-lowercase `#12abef` both normalize, and `#1234`, `#`, and a color with surrounding spaces fail. A CTA label of 122 characters with surrounding spaces stores 120 characters. A label of only tabs and newlines fails. A 200-character title of spaces and a 5,000-character description that starts with a newline are stored unchanged.

An over-long URL reports only `URL must be 2048 characters or fewer.` Empty, protocol-less, protocol-relative, empty-host, and password-only URLs fail on both image and CTA fields. An accepted URL is stored as written: uppercase `HTTPS`, a query and fragment, a colon in the path, a port, and surrounding spaces stay. The URL parser accepts those spaces, and the schema does not rewrite the string to the parsed href.

A space is a valid section id and image id. An empty id fails. The second and third copies of one id are the duplicate issues. A document with 101 images fails at `data.sections`. A 21st slide fails the carousel limit. `null` produces the issue path `$`. Missing `title`, `aspectRatio`, `url`, and `type` fail on those paths. `data.meta`, a nested `schemaVersion`, a non-array `sections` value, and `position` on an image fail.

`revision` 1 is valid. `-1` fails. `updatedAt` stores `+00:00` and `-00:00` unchanged. A local timestamp, a date, a lowercase `z`, and `+0000` fail. `LIMITS` is frozen. 131,072 `é` characters and 65,536 emoji are exactly 256 KiB and pass. One more emoji fails. `formatError` rejects a validation failure without issues, field issues on other codes, an empty message or request id, an unknown code, and `sql` or `authorization`. An empty issues list on `INTERNAL` is omitted. Editing an issue after the body is built does not change the body. The generated request schema has `schemaVersion` and `data`. The configuration schema adds `id`, `revision`, and `updatedAt`.
