# 23 — Limits and inline validation

13 October 2026. Prompt 24 was not started.

## Limits

The numbers come from the architecture validation table in section 5 of `docs/Reactiv_Assessment_Architecture_Client_Inspired.md`. They do not come from the checklist's 1 MiB example. `LIMITS` in `packages/contracts/src/limits.ts` is the only copy. The inspector, import, and the private API read that object and its sentences.

| Input | Limit |
| --- | --- |
| Title | 200 characters |
| Description | 5,000 characters |
| CTA label | 1–120 characters after the non-blank check |
| Alt text | 300 characters |
| URL | 2,048 characters |
| Images in one carousel | 20 |
| Images in the document | 100 |
| Sections | 100 |
| Import file and API body | 256 KiB |

Required and optional fields are in `docs/field-rules.md`. A CTA label, valid colors, valid non-empty URLs, unique ids, and schema version 1 are required to save. Text title, text description, image alt, an empty image list, and an empty section list are optional. An empty image URL cannot be saved.

## Editor

`validateDraft` issues keep their `path`. The inspector shows the schema sentence beside the field that broke a length limit, for example `Title must be 200 characters or fewer.` Color, blank-label, and invalid-URL copy stay the local sentences already covered by earlier tests. An empty color or an empty image URL stays quiet in the inspector and still blocks Save.

Over-limit text stays in the draft. Inputs have no `maxLength`, and the reducer does not slice the string. Save stays disabled while `validateDraft` fails. Export stays clickable and shows `Fix the highlighted fields before exporting.` It does not download.

Add image is disabled at 20 slides in that carousel, and at 100 slides in the document, with the matching sentence. Add carousel, Add text, and Add button are disabled at 100 sections. The reducer returns the same state at those ceilings and does not consume an id.

## Import and API

A file whose `file.size` is already over 256 KiB is not read. Import of 101 sections, 21 images in one carousel, a 201-character title, or a blank CTA label shows the issue and leaves the current draft in place.

The private API returns 413 for a body one byte over 256 KiB and 422 for the other cases above. The previous row's data, revision, and `updatedAt` stay unchanged.

## Checks

- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest passed 62 tests in `@reactiv/contracts`, 221 in `@reactiv/config-service`, and 334 in `@reactiv/editor`.
- In the browser, on `http://127.0.0.1:5173/`, the text section `Outage kept` received a 201-character title. Save was disabled. The field showed `Title must be 200 characters or fewer.` Its description stayed `A short list from the front table.` The other text section stayed `From the floor` / `Notes from the people who unpack the boxes.` Shortening the title to 200 characters removed the error and enabled Save. Save showed `Saved.` and then disabled itself. The stored title was then set back to `Outage kept` and saved again, so the home screen is readable.

## Acceptance progress

F12 passes. Bad input stays on the page, names the field, and leaves the other section's text in place. Empty title, empty description, and an empty carousel do not throw, and an empty carousel still shows the empty state. A blank CTA label disables Save and names the label. Required and optional fields are documented in `docs/field-rules.md`.

R07 passes. File size, API body size, section count, image count, and field lengths use `LIMITS`. One past each limit returns 413 or 422, or an import message, and does not truncate or replace the stored row or the current draft.
