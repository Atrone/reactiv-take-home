# Prompt 18 — JSON export

Implement only this prompt. Preconditions: prompt 17 is done. The editor can edit all three section types.

## Read first

- Architecture section 9, the export document and the rule that service-owned fields are omitted
- Take-home PDF page 2, Import / Export, the export half
- Acceptance criteria D01

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Export the current draft, including unsaved edits, only when `validateDraft` succeeds.
- The file contains `schemaVersion` and `data` only.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/18-json-export.md`.
- Do not implement import in this prompt.

## Goal

`Export JSON` downloads a UTF-8 JSON file of the current valid draft. Invalid drafts do not download a partial file.

## Implement

1. Enable the `Export JSON` button.
2. On click, run `validateDraft`. If it fails, do not download. Show the existing inline issues and a status message `Fix the highlighted fields before exporting.` Leave the draft unchanged.
3. If it succeeds, download pretty-printed JSON, two-space indent, UTF-8, filename `home-screen.json`. The object is exactly:

```json
{
  "schemaVersion": 1,
  "data": { "sections": [] }
}
```

   with the real sections. Keys present: `schemaVersion` and `data` only. No `id`, `revision`, `updatedAt`, `tenantId`, token, selected section, or save status.
4. Colors in the file are the normalized six-digit form.
5. Section order is the draft order. Unsaved title edits are included. Export does not call the configuration service and does not clear `dirty`.
6. Tests:
   - a valid dirty draft exports JSON whose sections equal the validated draft, including an unsaved title
   - the parsed file's top-level keys are only `schemaVersion` and `data`
   - an invalid color prevents the download helper from being called and leaves the draft title intact
   - a fixture with two sections of the same type keeps their order and their own colors
   - the file is valid JSON

Use a download helper that tests can replace, so the test does not depend on a real browser download. Prompt 29 should still perform one real browser download.

## Out of scope

- Import, Save, file-size UI beyond what validation already does. If the draft cannot be valid while over the section limit, the existing schema is enough for this prompt.

## Acceptance criteria that fully pass

- **D01.** Export downloads parseable JSON of the current draft, including unsaved edits. It includes `schemaVersion` and preserves sections, order, image URLs, ratios, copy, links, and colors. Credentials and transient UI state are absent. Evidence: the export tests.

## Take-home PDF requirements that fully pass

- Page 2, Import / Export, export half: the current configuration can be exported as a JSON file. "Configuration" here means the portable document, not the service record. The PDF's import half and malformed-file handling do not pass until prompt 19.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manually export after changing a title and confirm the file contains the new title and no token

## Done when

- D01 tests pass.
- The note includes a redacted example of the exported top-level keys.
- You have not started prompt 19.
