# 26 — Responsive layout and accessibility

13 October 2026. Prompt 27 was not started.

## Layout

The desktop split stays at 1024px. At 1440 CSS pixels the inspector and the phone sit side by side, and the Editor / Preview switch is hidden. At 768 and 375 the switch is the layout. Save, Export JSON, and Import JSON stay in the header, so they remain on screen when Preview is the visible pane.

The import control can shrink inside that header. It uses `min-width: 0` and `max-width: 100%`, and the file input uses `width: min(12rem, 100%)`. That is the overflow change. The first Playwright run already reported `document.documentElement.scrollWidth - clientWidth <= 1` at all three widths, including 0 at 375 in the browser. No element had to be clipped to hide a measured page scroll.

Carousel slides still scroll sideways inside the phone. The scroller is wider than its port, the phone frame's own scroll width stays within one pixel of its client width, and the page does not grow sideways.

## Keyboard and announcements

Move up and Move down are `type="button"`, so Enter and Space activate them. After a move, focus returns to that section's move control when the control stays enabled. When the move disables it, focus moves to that section's select button. It does not move to the page heading.

Removing a section focuses the neighbor the reducer selects. Removing the last section focuses Add carousel.

At 375px, Tab from Select Carousel landed on Move down. Move up was disabled, so it was skipped. The keyboard focus outline was solid 3px `#0b57d0`. Enter swapped that carousel with the following text section. Move down then disabled, and focus stayed on Select Carousel for the same section. With three sections, Space on Move down reordered the list and left focus on that same Move down button. Page overflow stayed 0.

`Saved.` and `The draft was not saved.` were already `aria-live="polite"`. Import errors use the same polite attribute on `#document-status`. Those three messages are not shown together.

The live-preview case that types through every field now has a 20 second limit. Alone it takes about 3 seconds, and the 5 second default was too tight while the configuration service tests ran beside it. The assertions are unchanged.

## Commands and results

- `pnpm exec playwright test e2e/responsive-layout.spec.ts` exited 0. Four tests passed: 375, 768, 1440, and the Move down focus check.
- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest passed 65 tests in `@reactiv/contracts`, 222 in `@reactiv/config-service`, and 340 in `@reactiv/editor`.

## Acceptance progress

F11 passes. At 375, 768, and 1440 CSS pixels, Save, Export JSON, Import JSON, the fields, and the phone preview are reachable, and the page does not scroll horizontally. Horizontal scrolling stays in the carousel. The evidence is `e2e/responsive-layout.spec.ts`.

F12 already passed in prompt 23. This prompt adds the keyboard focus evidence and does not remove labels. The narrow-window Tab and Enter check is recorded above.

Page 2, Editor Behaviour: the editor is usable at a phone width, a tablet width, and a desktop width.

Page 4, User Experience: Save, import, export, the fields, and the move controls stay reachable and focusable.
