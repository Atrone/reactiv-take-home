# Prompt 19 — JSON import

Implement only this prompt. Preconditions: prompt 18 is done. Export tests pass.

## Read first

- Architecture section 9, import atomicity, unsupported versions, and the rule that import does not persist and does not change the base revision
- Take-home PDF page 2, invalid or malformed files
- Acceptance criteria D02, D03, D04, D07, D08, R02. D03, D04, and D07 fully pass here. D02 fully passes in prompt 20 because it includes Save and reload. D08's rejection behavior is required here; the README sentence passes in prompt 30

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Replace the draft only after the entire file has passed size, parse, and schema checks.
- A failed import does not call the configuration service and does not dispatch `importDocument`.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/19-json-import.md`.

## Goal

`Import JSON` replaces the editor draft and preview together when the file is a valid portable document. Any malformed or semantically invalid file leaves the draft and the last saved baseline untouched and explains why.

## Implement

1. Enable `Import JSON` as a file input with an accessible name. Accept `.json`.
2. Read the file only after checking `file.size`. If `file.size` is greater than 256 KiB, do not read the contents. Show `This file is larger than 256 KiB.` Keep the draft.
3. Parse JSON inside a failure path that catches syntax errors. An empty file, a non-JSON file, and `{` show `This file is not valid JSON.` Keep the draft.
4. Validate the parsed value with the shared `EditableDocument` schema. On failure, show the first issues with their field paths. Do not replace the draft. Examples that must be rejected:
   - missing `data.sections`
   - a section missing `type`
   - section type `quiz` or any unsupported type
   - schema version `2` or `0`
   - invalid color
   - invalid URL
   - duplicate section ids
   - duplicate image ids in one carousel
5. On success, dispatch `importDocument` once. The preview and inspector both show the imported sections. `baseEtag` is unchanged. Status text is `Imported, not saved.` The configuration service is not called.
6. Importing a file that contains `id`, `revision`, or `updatedAt` fails closed because the portable schema is strict, unless you strip those keys in a documented preprocessor. Do not strip them silently. Reject the file and tell the user the portable file must contain only `schemaVersion` and `data`. That matches export and prevents a file from selecting a different server configuration.
7. The user can retry: after a failure, choosing a valid file still imports.
8. Tests, each starting from a known draft and a known saved baseline:
   - export, then modify the draft title, then import the exported file: the title returns to the exported value and the preview matches
   - invalid JSON leaves the title unchanged
   - empty file leaves the title unchanged
   - schema version 2 leaves the title unchanged and the message mentions the version
   - a duplicate section id leaves the title unchanged
   - a `javascript:` URL leaves the title unchanged
   - a successful import does not call `fetch`
   - a successful import keeps the previous `baseEtag`

There is no migration of older documents. Version 1 is the only version. Do not invent a legacy schema.

## Out of scope

- Save and reload of the imported draft. Prompt 20 completes D02.
- README migration paragraph. Prompt 30 completes the documentation half of D08.

## Acceptance criteria that fully pass

- **D03.** Invalid JSON, an empty file, or an unreadable file produces a useful error. The previous draft stays in place, and a later valid file can still be imported. The persisted server document is not written because import does not save. Evidence: component tests that assert `fetch` was not called.
- **D04.** Parseable JSON with missing fields, wrong types, unsupported section types, invalid colors, or invalid URLs is rejected. Validation finishes before the draft is replaced. Evidence: the semantic cases above, asserting the previous title is still visible after each rejection.
- **D07.** Runtime validation uses the same color and URL rules on API writes and on imports. `#123` and `#12ABEF` pass; `#12`, `#GGGGGG`, and script, data, and file URLs fail. Ordinary text is rendered as text, which prompt 13 already tests and this prompt must not regress. Evidence: the prompt 07 API tests, the import cases above, and the prompt 13 markup-as-text test.

D02 does not fully pass. The replace-draft half is required here and the Save/reload half is prompt 20.

D08's runtime half is required here: schema version 2 is rejected with a clear error and no mutation. The README half remains.

R02's duplicate-id policy is required here: duplicate section ids are rejected and the previous draft remains. The full R02 id, including stable ids through save/reload, is prompt 20.

## Take-home PDF requirements that fully pass

- Page 2, Import / Export: importing a valid file restores that state in the editor, and invalid or malformed files are handled without damaging the current draft. "Restores a previous state" in the editor is this prompt. Restoring it after a browser refresh requires Save, which is the next prompt.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manually import a broken file and then the file you just exported

## Done when

- D03 and D04 tests pass.
- The note records that import does not persist and does not change `baseEtag`.
- You have not started prompt 20.
