# 16 — Live preview behavior tests

13 October 2026. Prompt 17 was not started. No production code changed. The phone already reads `state.draft.data.sections`, and each preview row is keyed by `section.id`.

## Tests

The file is `apps/editor/app/features/editor/live-preview-behavior.test.tsx`. It hydrates the six-section demo document through `EditorProvider`. `fetch` is stubbed: a slide URL would receive a local PNG, and any other URL throws. Happy-dom leaves image file loading off, so a normal edit does not request slide bytes.

The cases assert the phone DOM:

- Title, description, both text colors, CTA label, CTA URL, both CTA colors, an image URL, image alt, and aspect ratio each change the visible preview. The URL check is the Open destination `href` and the revealed `Destination:` line.
- Editing the first text block leaves the second text block's title, description, and colors. The same check covers two buttons and two carousels.
- The fixture renders two of each type, in document order. Add carousel, Add text, and Add button raise the phone to three of each, nine rows, with the original six still first.
- Move down carries the first text block past the second. The phone order follows. Each block keeps the copy and colors it had before the move.
- Save is still the disabled control from the shell, so the test does not pretend a save is in flight. Typing a title updates the phone while `fetch` throws if called, and the call log stays empty.
- Two demo text blocks are rendered, edited, and swapped with Move down. The same preview nodes move with their section ids, and the inputs keep the values typed for those sections.

`TextPreview`, `CtaPreview`, and `CarouselPreview` are already wrapped in `memo`. `PhonePreview` in `apps/editor/app/features/editor/editor-shell.tsx` maps `state.draft.data.sections` and renders `SectionPreview` with `key={section.id}`.

If the preview updated only after a successful save, `apps/editor/app/features/editor/live-preview-behavior.test.tsx` would fail. The case is `updates the preview when fetch throws and does not call fetch`: the phone title is asserted, and `fetch` is not called.

## Checks

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 261 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- The fetch case was pointed at the title `not the preview` and failed. The phone text was `Offline title`. That expectation was restored.
- The phone list was keyed by array index for one run. `moves preview nodes and input values with their section ids` failed: the first row's node stayed in place and then showed the other section's copy. The key was restored to `section.id`.

## Acceptance progress

F02 passes. Every supported field updates the preview from the local draft. One section's edit leaves the other section's settings. The evidence is `apps/editor/app/features/editor/live-preview-behavior.test.tsx`, including the fetch mock that throws and records no calls. Save, refresh, and a successful network request are not part of that update.

F03 passes. The demo screen shows two carousels, two text sections, and two buttons, each with its own preview. Adding one more of each type shows three of each. The evidence is the fixture case and the add-one-more case in the same file.

Q02 passes. The cases edit against the preview, check independence of repeated types, reorder without dropping settings, and read carousel, text, and button output from the DOM. The evidence is `pnpm test`.

R01 passes. One serializable section list is the editor draft and the phone. The preview walks `draft.data.sections` in order. The evidence is the reorder case and the `sections.map` in `PhonePreview`. Export and persistence still use this model in later prompts.

F04 does not pass. Reorder is visible immediately. Survival across export and reload is still prompt 20.

Page 1–2, Editor Behaviour: changes show up in the phone as they are typed; the tested fields can be modified; the screen can hold multiple sections of each type and reorder them. Reorder surviving export and reload remains F04.

Page 4: the new file is the automated check for this editor and preview behavior.
