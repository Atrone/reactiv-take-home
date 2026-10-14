# 19 — JSON import

13 October 2026. Prompt 20 was not started.

## File

`Import JSON` is a file input with the accessible name `Import JSON`. It accepts `.json`. Save stays disabled and still says `Not available yet`.

The chosen file is checked in order. `file.size` is compared with the shared 256 KiB ceiling before the file is read. A larger file shows `This file is larger than 256 KiB.` and the draft stays. A file that cannot be read shows `This file could not be read.`

JSON is parsed inside a failure path. An empty file, a non-JSON file, and `{` show `This file is not valid JSON.` The draft stays.

A parsed value is checked with `editableDocumentSchema`. A failure shows the field paths and the schema messages. The draft is replaced only after that check succeeds. Rejected cases include a missing `data.sections`, a section missing `type`, section type `quiz`, schema version `2` or `0`, `#12` and `#GGGGGG`, `javascript:`, `data:`, and `file:` URLs, a duplicate section id, and duplicate image ids in one carousel. `#123` and `#12ABEF` pass and are stored as `#112233` and `#12abef`.

`id`, `revision`, and `updatedAt` are not stripped. The strict schema rejects them, and the status says `The portable file must contain only schemaVersion and data.` A file cannot select a different server configuration. There is no migration. Version 1 is the only version.

A valid file dispatches `importDocument` once. The preview and the inspector show the imported sections. The status text is `Imported, not saved.` `baseEtag` and the saved baseline stay as they were. The configuration service is not called. After a failure, choosing a valid file still imports.

## Checks

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 286 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- In the browser, on `http://127.0.0.1:5173/`, the first text title was changed to `Before import` and Export JSON downloaded one file. The parsed title was `Before import`, the top-level keys were `schemaVersion` and `data`, and the page made no fetch. The title was then changed to `After export`. Importing `{` showed `This file is not valid JSON.`, left `After export` in the title and the preview, and made no fetch. Importing that exported file showed `Imported, not saved.` The inspector title returned to `Before import`, the preview showed `Before import` and `From the floor`, and the section id stayed `section-text-1`. That import made no fetch. A reload showed `New this week` again, so the import was not written to the server.

## Acceptance progress

D03 passes. Invalid JSON, an empty file, and an unreadable file show a useful error. The previous draft stays, a later valid file still imports, and the tests assert `fetch` was not called.

D04 passes. Parseable JSON with missing fields, an unsupported section type, invalid colors, invalid URLs, duplicate ids, or service-owned keys is rejected before the draft changes. The previous title stays visible.

D07 passes. Import uses the same editable-document schema as an API write. `#123` and `#12ABEF` pass. `#12`, `#GGGGGG`, and script, data, and file URLs fail. The prompt 13 markup-as-text test still passes.

D02 does not fully pass. A valid import replaces the draft and the preview, and the status says `Imported, not saved.` Save and reload of that draft are prompt 20.

D08's runtime half passes. Schema version 2 is rejected, the message names that version, and the draft stays. The README sentence remains prompt 30.

R02's duplicate-id half passes. A repeated section id is rejected and the previous draft stays. Stable ids through save and reload are prompt 20.

Page 2, Import / Export, import half: a valid file restores that state in the editor, and a malformed file does not damage the current draft. Restoring it after a browser refresh requires Save, which is the next prompt.

Import does not persist and does not change `baseEtag`.
