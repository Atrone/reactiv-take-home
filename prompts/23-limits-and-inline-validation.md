# Prompt 23 — Limits and inline validation

Implement only this prompt. Preconditions: prompt 22 is done. Save, import, and failure recovery pass.

## Read first

- Architecture section 5, the validation table, including the instruction to preserve in-progress input and block Save and export until the draft is valid
- Acceptance criteria F12 and R07
- Take-home PDF page 4, User Experience: bad input is handled gracefully

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- The numeric limits remain the single constant object from prompt 02. Do not copy new numbers into the UI.
- Exceeding a limit returns an error and does not truncate the stored document or the draft.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/23-limits-and-inline-validation.md`.

## Goal

The same limits apply to the inspector, import, and the private API. Users can correct one bad field without losing the rest of the draft. Empty optional fields do not crash.

## Limits to enforce

Use the prompt 02 constants:

- title 200, description 5,000, CTA label 1–120 after a non-blank check, alt 300, URL 2,048
- 20 images per carousel, 100 images in the document, 100 sections
- 256 KiB for an import file and for an API body
- colors and URLs as already specified

Document required versus optional fields in a short `docs/field-rules.md` that prompt 30 can fold into the README:

- Required to save: CTA label, valid colors, valid URLs for every image and CTA that is non-empty, unique ids, schema version 1
- Optional: text title, text description, image alt, an empty image list, an empty section list
- A non-empty image URL must be valid. An empty image URL cannot be saved

## Implement

1. The inspector shows the limit message next to the field that broke it, using the issue `path` from `validateDraft`. Example: `Title must be 200 characters or fewer.`
2. Inputs do not max-length-truncate in a way that deletes pasted text without a message. You may set `maxLength` only if the visible error still explains the limit. Prefer keeping the over-limit string in the draft and blocking Save, so the user can delete characters themselves. Do not slice the string in the reducer.
3. Adding a 21st image to one carousel is blocked or, if the control allows the click, the draft shows an error and Save and export stay disabled. Pick one behavior and test it. Blocking the `Add image` button at 20, with an explanation, is the better UX. The API must still reject a 21st image if a client bypasses the button.
4. API tests, if not already present, for one byte over 256 KiB, 101 sections, 21 images, a 201-character title, and a blank CTA label. Each returns 422 or 413 as appropriate and leaves the previous row unchanged.
5. Import of those same cases leaves the current draft unchanged. The 256 KiB file does not get parsed when `file.size` already exceeds the limit.
6. Empty title, empty description, and empty carousel do not throw. Save is allowed for an empty title and for an empty carousel. Save is not allowed for a blank CTA label.
7. Tests for F12:
   - a temporary bad color shows a field-specific error and the other section's title remains
   - clearing the bad color or completing it removes that error
   - blank CTA label disables Save and names the field
   - empty image list still renders the empty state from prompt 15

## Out of scope

- New limit numbers. Do not switch to the checklist's 1 MiB or 50-section examples.
- Rate-limit tuning beyond what prompt 05 already did.

## Acceptance criteria that fully pass

- **F12.** Fields and section controls have clear labels. Bad input, blank fields, and empty image lists do not crash the app. Validation errors identify the field, and the user can correct them without losing other edits. Required and optional fields are documented in `docs/field-rules.md`. Evidence: component tests and that file.
- **R07.** File size, API body size, section count, image count, and field lengths use the documented limits. Exceeding a limit returns an actionable error and does not truncate or mutate stored data. Evidence: API and import tests at one past each limit, plus the constants module as the single source.

## Take-home PDF requirements that fully pass

- Page 2–3, validation of inputs, now visible in the editor as well as the API.
- Page 4, User Experience: bad input is handled without taking down the page or wiping unrelated edits.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Paste a 201-character title, confirm Save is disabled and the description in another section is unchanged, then delete the extra character and save

## Done when

- F12 and R07 pass.
- The note lists the limits and says they come from the architecture table, not the checklist's 1 MiB example.
- You have not started prompt 24.
