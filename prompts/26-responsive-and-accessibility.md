# Prompt 26 — Responsive layout and accessibility

Implement only this prompt. Preconditions: prompt 25 is done. The boundary tests pass.

## Read first

- Architecture section 6, responsive layout, labels, focus, live announcements, keyboard reorder
- Take-home PDF page 2, responsive and user-friendly, and page 4, User Experience
- Acceptance criteria F11 and the label/focus parts of F12 that prompt 23 did not already cover. F12 already passed if labels and errors exist; this prompt must not regress them
- Verification scenario T07

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Horizontal scrolling belongs to carousels inside the phone preview, not to the page.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/26-responsive-and-accessibility.md`.

## Goal

At 375, 768, and 1440 CSS pixels, a person can reach Save, import, export, the fields, and the preview. Keyboard users can reorder sections and stay oriented.

## Implement

1. Viewports:
   - 1440: inspector and preview side by side. The phone frame is fully visible without page-level horizontal scroll.
   - 768 and 375: the Editor / Preview switch from prompt 12 is the layout. Save, import, and export remain visible without horizontal page scroll in the pane that contains them. If the switch hides the preview, the preview pane itself must still show a complete phone frame when selected.
2. Carousel horizontal overflow stays inside the phone frame at all three widths.
3. Keyboard:
   - Move up and move down are buttons, operable with Enter and Space
   - After a move, focus remains on the move control for that same section id, or moves to a sensible replacement if the control unmounts. It must not jump to the top of the page
   - After remove, focus moves to a neighboring section control or to the add controls when the list is empty
   - Visible focus styles on inputs and buttons
4. Live region: `Saved.`, `The draft was not saved.`, and import errors are announced with `aria-live="polite"`. One region is enough.
5. Playwright tests at the three widths:
   - set the viewport, load the editor, and assert `document.documentElement.scrollWidth <= clientWidth` with a tolerance of 1 pixel
   - assert Save, Export JSON, and Import JSON are visible in the editor pane
   - at 375, select Preview and assert the phone preview is visible and the page still does not scroll horizontally
   - keyboard test: focus Move down, press Enter, assert the section order changed and the active element is still a control for that section

## Out of scope

- A full WCAG audit, drag-and-drop, and a custom screen-reader test lab. The contrast warning from prompt 13 stays a warning.

## Acceptance criteria that fully pass

- **F11.** At 375, 768, and 1440 CSS pixels, the required controls, Save, import/export, and the preview are usable. The page has no accidental horizontal overflow. Horizontal scrolling is confined to carousels. Evidence: the three Playwright viewport tests.

F12 already passed in prompt 23. Extend its evidence with the keyboard focus test. If that test fails, fix the shell. Do not remove labels to make the layout fit.

## Take-home PDF requirements that fully pass

- Page 2, Editor Behaviour: the UI is responsive and user-friendly at a phone width, a tablet width, and a desktop width.
- Page 4, User Experience: the main controls remain reachable and focusable.

## Verification

- Playwright at the three sizes
- `pnpm test`
- `pnpm typecheck`
- Manually tab from the section list through Move down and activate it with the keyboard at a narrow window

## Done when

- F11 passes at all three widths.
- The note records any overflow you had to fix.
- You have not started prompt 27.
