# Prompt 16 — Live preview behavior tests

Implement only this prompt. Preconditions: prompts 13–15 are done. All three section types render.

## Read first

- Architecture section 6, immediate preview and local reducer state
- Architecture section 13, the reducer and UI test rows
- Take-home PDF pages 1–2: changes are reflected in real time; multiple sections of each type; reorder
- Acceptance criteria F02, F03, Q02, R01, and the verification scenario T01

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Tests must fail if the preview stops updating. Do not assert only that a reducer function was called.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/16-live-preview-behavior-tests.md`.
- You may fix defects these tests uncover. Do not start import, save UX, or image-resilience work except where a test cannot run without a small hook that already should exist.

## Goal

Lock the core editor behavior with automated tests: every supported field updates the preview immediately, repeated sections stay independent, and a delayed network call is not required for those updates.

## Tests to add or extend

Hydrate from the six-section demo fixture. Stub any image requests.

1. Title, description, both text colors, CTA label, CTA URL, both CTA colors, an image URL, image alt, and aspect ratio each change the preview when edited. Assert the visible output, not the draft object alone. One test may walk the fields, but each field needs its own assertion.
2. Editing the first text section does not change the second text section's title, description, or colors. Repeat that independence check for two CTAs and two carousels.
3. The screen can contain two of each type at once, which the fixture already does. Add one more of each type and assert the preview count.
4. Move a text section past the other text section using the buttons. The preview order follows. Each section keeps the colors and copy it had before the move.
5. Start a save that never resolves. Implementation note: if the Save button is still disabled, call the same delay from a test double around `saveStarted` or a temporary test-only control is not allowed. Instead, unit-test the UI by mocking `fetch` to the editor action so that it hangs, and if Save is not wired yet, do not fake a passing test. In that case, prove "no network required" by editing with `fetch` mocked to throw if called, and assert the preview still updated and `fetch` was not called. That is the correct test until prompt 20 wires Save. Revisit it in prompt 20 only if the mock needs to move; do not leave a test that calls the private service.
6. Memoize section preview components with stable ids as React keys. The key is the section id, never the array index. A test renders two sections, reorders them, and asserts the input values moved with the sections rather than staying in the old rows.

## Fixes you may make

- Wrong React keys
- A preview that reads loader data instead of the draft
- A field that updates the draft and not the preview

## Out of scope

- New features beyond fixing those defects
- Performance benchmark, import, export

## Acceptance criteria that fully pass

- **F02.** Editing every supported field updates the preview immediately from local draft state, without Save, refresh, or a successful network request. Editing one section does not change another section's settings. Evidence: the tests above, including the fetch mock that throws.
- **F03.** The user can have at least two carousels, two text sections, and two CTAs on the same screen. Each has its own settings and its own preview. Evidence: the fixture test plus the add-one-more test.
- **Q02.** Automated tests exercise editing against the preview, independence of repeated types, reordering that preserves settings, and correct rendering of carousel, text, and CTA values. The assertions observe the DOM. Evidence: `pnpm test`.
- **R01.** One serializable section model drives the editor state and the preview. The renderer walks `draft.data.sections` in order rather than hardcoded positions. Evidence: reorder test and a code path that maps the array. Export and persistence use the same model in later prompts; if a later prompt introduces a second model, that regresses R01.

## Take-home PDF requirements that fully pass

- Page 1–2, Editor Behaviour: changes are reflected in real time; the UI can modify the required fields; the user can add multiple sections of each type and reorder them. Reorder's survival across export and reload is still required by F04 and is not fully passed until prompt 20.
- Page 4, meaningful automated tests for the core editor and preview behavior.

## Verification

- `pnpm test` and confirm the new tests fail when you temporarily break one assertion locally, then restore it. Mention that check in the note.
- `pnpm typecheck`

## Done when

- F02, F03, Q02, and R01 pass.
- The note names the test file that would fail if preview updates depended on a successful save.
- You have not started prompt 17.
