# Prompt 02 — Shared contracts and validation

Implement only this prompt. Preconditions: prompt 01 is done. `pnpm typecheck` and `pnpm test` pass. No SQL and no editor UI exist yet.

## Read first

- `prompts/00-sequence.md` locked choices
- Architecture sections 5, 7, and 9 (data contract, validation policy, error JSON, import document)
- Take-home PDF pages 2–3: configuration fields, validation, consistent errors, schema evolution
- Acceptance criteria D05, D06, D07, D08, A06, A07, R07. This prompt builds the shared rules. It does not fully pass those IDs, because they also require the API, the UI, or the README

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- All runtime document and error schemas live in `packages/contracts`. Do not hand-write a second validator in either app.
- Zod, one pinned major for the whole repo. Prefer current stable Zod 4. If a dependency forces Zod 3, use Zod 3 everywhere and record why.
- Every new function has a block comment (purpose, inputs, side effects) and line comments on the steps inside the body.
- Append `docs/ai-notes/02-shared-contracts-and-validation.md`.
- Do not add route handlers, React components, or database access.

## Goal

Define the only document shape, the only error shape, and the only limit constants both processes will use. Unit tests must prove the validation rules before any HTTP layer exists.

## Contract to implement

Portable document, strict objects, no extra keys:

```ts
type Image = { id: string; url: string; alt: string };

type Section =
  | {
      id: string;
      type: "carousel";
      images: Image[];
      aspectRatio: "portrait" | "landscape" | "square";
    }
  | {
      id: string;
      type: "text";
      title: string;
      description: string;
      titleColor: string;
      descriptionColor: string;
    }
  | {
      id: string;
      type: "cta";
      label: string;
      url: string;
      backgroundColor: string;
      labelColor: string;
    };

type EditableDocument = { schemaVersion: 1; data: { sections: Section[] } };

type Configuration = EditableDocument & {
  id: string;
  revision: number;
  updatedAt: string;
};
```

Keep these meanings separate in names and comments:

- `/v1` is the HTTP contract.
- `schemaVersion` is the document format. Only `1` is accepted. Any other number, string, or missing version fails.
- `revision` is the concurrency counter for one configuration. It is not `schemaVersion`.

`POST` and `PUT` bodies are `EditableDocument` only. Reject bodies that include `id`, `revision`, `updatedAt`, or `tenantId`.

`GET`, `POST` success, and `PUT` success bodies are `Configuration`. `updatedAt` is an ISO-8601 UTC timestamp. `revision` is an integer greater than or equal to 1. `id` is a non-empty string.

Error body, and no other error shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Some fields need attention.",
    "requestId": "generated-request-id",
    "issues": [{ "path": "data.sections[2].url", "message": "Use an absolute HTTP(S) URL." }]
  }
}
```

Export these error codes for later HTTP mapping: `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_FAILED`, `MALFORMED_JSON`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `PRECONDITION_REQUIRED`, `PRECONDITION_FAILED`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`, `INTERNAL`. The schema requires `code`, `message`, and `requestId`. `issues` is present for validation failures and omitted or empty otherwise.

## Validation policy

Put the numeric limits in one exported constant object so later prompts do not copy them.

| Input | Rule |
| --- | --- |
| Colors | Accept `#RGB` and `#RRGGBB`, case-insensitive. Normalize to lowercase `#rrggbb` on success. Reject `#12`, `#gggggg`, `#rrggbbaa`, named colors, and `rgb()` |
| Image and CTA URLs | Absolute `http:` or `https:` URLs. Reject missing protocol, relative paths, `javascript:`, `data:`, `file:`, `blob:`, and any URL with embedded credentials. Maximum 2,048 characters |
| Text | Plain strings. Title 0–200 characters. Description 0–5,000 characters. CTA label 1–120 characters after trim; a blank label is invalid for a saved document. Do not trim away internal spaces or description line breaks |
| Alt text | 0–300 characters |
| Images | At most 20 per carousel and at most 100 across the document. Image IDs unique within a carousel |
| Sections | At most 100. Section IDs unique in the document, non-empty, and stable strings. Array order is the only order. No `position` field |
| Payload | At most 256 KiB UTF-8. Export a byte-length helper the later file and HTTP code must call before `JSON.parse` |
| Shape | Strict known keys, valid `type` discriminator, `schemaVersion === 1`, no extra nesting |
| Empty document | `{ schemaVersion: 1, data: { sections: [] } }` is valid |
| Empty carousel | `images: []` is valid |

Unknown section types and unknown schema versions fail validation. Do not coerce them into a supported type.

Aspect ratios are the strings `portrait`, `landscape`, and `square` only. Do not put pixel ratios in the JSON. The later renderer maps them to `3 / 4`, `16 / 9`, and `1 / 1`.

## Implement

1. Schemas, inferred types, limit constants, the byte-length helper, and a `formatError` helper that builds the error object without stack traces or tokens.
2. A color normalizer used by the schema so successful parses return six-digit hex.
3. Unit tests in `packages/contracts` that cover at least:
   - `#123` and `#12ABEF` normalize to `#112233` and `#12abef`
   - `#12`, `#GGGGGG`, and `#11223344` fail
   - `https://example.com/a.png` passes; `javascript:alert(1)`, `data:text/html,hi`, `file:///tmp/a`, `/relative.png`, and `https://user:pass@example.com/a` fail
   - a document with two sections of each type parses, and order is unchanged
   - duplicate section IDs fail; duplicate image IDs inside one carousel fail
   - schema version `2` fails; section type `quiz` fails
   - an empty document and an empty carousel pass
   - a CTA with a blank label fails; a text section with an empty title passes
   - a payload whose UTF-8 byte length is 256 KiB passes the size helper; one byte over fails
   - error objects reject stack-trace fields if a caller tries to add them through the typed builder
4. Export a JSON Schema-like description only if it is generated from the Zod schemas. Do not maintain a handwritten duplicate.

## Out of scope

- HTTP status mapping, Fastify, React, draft strings that are invalid while typing, import file UI, migrations.

## Acceptance criteria

No acceptance ID fully passes in this prompt. The unit tests are the evidence later prompts will reuse.

These IDs must have their shared rules implemented and tested here, and must not be claimed as fully passed:

- D05, D06: the TypeScript and Zod shapes include `id`, `schemaVersion`, `updatedAt`, `revision`, and the ordered payload fields.
- D07: the color and URL examples in the checklist are unit-tested: `#123` and `#12ABEF` pass; `#12`, `#GGGGGG`, and script/data/file URLs fail.
- D08: unsupported `schemaVersion` fails in the parser. The README explanation does not exist yet.
- R07: the limit constants exist and the size helper is tested. UI and API enforcement do not exist yet.

## Take-home PDF requirements

Page 2, Configuration Service, is represented in the types: string `id`, numeric `schemaVersion`, timestamp `updatedAt`, and `data` whose sections carry carousel images and aspect ratio, text title, description, and both colors, and CTA label, URL, and both colors. `revision` is an additional architecture field and must stay distinct from `schemaVersion`.

Page 2–3, API Design: one explicit request schema (`EditableDocument`), one explicit success schema (`Configuration`), and one explicit error schema. Versioning is `schemaVersion: 1` with rejection of other versions. No migration framework.

These PDF requirements do not pass yet: live preview, persistence, private authentication, loaders and actions.

## Verification

- `pnpm test` including the new contract tests
- `pnpm typecheck`
- Confirm both apps depend on `@reactiv/contracts` and neither app defines its own Zod document schema

## Done when

- The tests listed above pass.
- The note records the Zod major and any case you corrected while writing the schema.
- You have not started prompt 03.
