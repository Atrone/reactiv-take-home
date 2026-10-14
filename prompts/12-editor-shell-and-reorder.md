# Prompt 12 — Editor shell and reorder

Implement only this prompt. Preconditions: prompt 11 is done. Reducer tests pass. Section inspectors may be placeholders.

## Read first

- Architecture sections 4 and 6: inspector versus preview responsibilities, desktop split, narrow layout, move buttons, selection, empty states
- Take-home PDF pages 1–2, Editor Behaviour, and page 4, User Experience
- Acceptance criteria A01, F03, F04, F11, F12. Only A01 fully passes here

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Move up and move down are the reorder UI. Do not add drag-and-drop.
- The shell does not fetch and does not hold the token.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/12-editor-shell-and-reorder.md`.
- Plain CSS. No component library.

## Goal

Replace the JSON placeholder with an editor shell: a section list, add buttons for the three types, move and remove controls, a selected-section panel, and a preview column. The preview can render a typed placeholder per section until prompts 13–15. The layout works at desktop width and does not overflow the page horizontally.

## Implement

1. On `/`, the loader result hydrates the reducer once. Use the dispatch rules from prompt 11. A dirty draft must not be reset if the loader data identity changes later; for this prompt, hydrating only from the initial loader value is enough if the code makes a second hydrate impossible.
2. Layout:
   - At widths of 1024px and up, the section list and inspector are one column and the preview is the other.
   - Below 1024px, show a `Editor` / `Preview` control that reveals one pane at a time. Both controls remain in the tab order.
   - The page itself does not scroll horizontally. The preview pane may scroll vertically.
   - Include a phone frame around the preview, about 390px wide on desktop, scaled down so a 375px viewport still fits.
3. Section list:
   - One row per section, labeled with its registry label and a short content hint (first image alt, title, or CTA label).
   - The row is a button that selects the section.
   - `Move up` and `Move down` buttons with accessible names that include the section label, disabled at the ends.
   - `Remove` with an accessible name. Removing the last section shows an empty editor message and an empty preview message, each with the add controls still available.
4. Add controls: `Add carousel`, `Add text`, `Add button`. They dispatch `addSection` and move focus to the new section's inspector heading or the new row. Focus must not be lost.
5. Inspector panel: for this prompt, show the selected section's type and id and a sentence that the fields arrive in the next prompts. Do not build the real fields yet, except if a stub input is required to prove the panel is wired. Prefer no fake inputs that would later be thrown away.
6. Preview panel: render the sections in array order inside the phone frame. Each placeholder shows the type and the distinguishing hint. Reordering the list must reorder the placeholders immediately, with no network call.
7. Landmarks and labels: the list is a labelled region `Sections`, the inspector is `Section settings`, the preview is `Phone preview`. Buttons have visible focus.
8. Save, import, and export buttons may be visible and disabled with `title` or helper text `Not available yet`, or omitted until later prompts. If you render them disabled, keep their accessible names stable so later prompts do not rename them: `Save`, `Export JSON`, `Import JSON`.
9. Tests with Testing Library:
   - the hydrated demo document shows six rows
   - adding a carousel results in seven rows
   - move down on the first section swaps the first two preview placeholders
   - two text placeholders keep their own titles when one row is moved
   - remove on a middle section leaves the others in order
   - the empty state appears after removing every section
   - no test or component reads `CONFIG_SERVICE_TOKEN`

## Out of scope

- Real text, CTA, and carousel fields; live image rendering; save behavior.

## Acceptance criteria that fully pass

- **A01.** The app uses React Router v7 framework mode with the server runtime, TypeScript, and React Context plus `useReducer` for editor state. Evidence: the route, the providers, and the existing framework config.

These do not fully pass:

- F03 and F04, because the preview is still a placeholder and export/reload are not done
- F11 and F12, because the real fields and the three viewport checks are not done

## Take-home PDF requirements

- Page 1, Technology Requirements: the locked stack and Context/Hooks are now how the editor works.
- Page 2, Editor Behaviour, reorder and multiple sections: the shell can hold and reorder many sections. The requirement is not fully met until each type's real fields update a real preview.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Start the app against the seeded service and confirm the six demo rows render from the loader, and that move up/down changes placeholder order without a request to port 4001

## Done when

- A01 is true and the shell tests pass.
- The note records the breakpoint you used.
- You have not started prompt 13.
