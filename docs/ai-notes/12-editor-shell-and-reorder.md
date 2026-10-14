# 12 — Editor shell and reorder

13 October 2026. Prompt 13 was not started. The inspectors are still placeholders.

## Shell

`/` renders `EditorProvider` and `EditorShell` when the loader succeeds. A failed load still shows the safe message and the request id. The shell reads the draft from context. It does not fetch, and it does not read the service token.

The provider hydrates in the `useReducer` initializer. That function runs once per mount and calls the existing `hydrate` command, so the draft and the baseline are separate copies and the first section is selected. A later loader payload does not run the initializer again. After the first hydrate, `savedBaseline` is set, so a second `hydrate` dispatch would also be ignored. Adding a section and then rerendering the route with a different configuration leaves the seven-row draft in place.

`selectSection` sets `selectedSectionId` only. It does not change the draft, the dirty flag, the sequence, the baseline, or the ETag. A missing id and a repeated select return the same state.

## Layout

The desktop split starts at **1024px**. At that width and above, the section list and the inspector are one column and the phone preview is the other. The pane switch is not shown. Below 1024px, `Editor` and `Preview` are both buttons, neither is disabled, and neither has `tabindex="-1"`, so both stay in the tab order. The pressed button reveals that pane. The other pane is `display: none`.

The page uses `overflow-x: clip`. The phone frame is `width: min(390px, 100%)`. Measured in the browser: at 1440 CSS pixels the frame is 390px wide, both columns are on screen, and the document scroll width matches the client width. At 375 CSS pixels the frame is 351px wide, the document does not scroll horizontally, and the pane switch shows one pane at a time. The phone screen scrolls vertically.

## Rows, reorder, and empty state

Each row shows the registry label (Carousel, Text, or Button) and a hint: the first image alt, the text title, or the button label. An empty carousel says `Empty carousel`. The row button selects the section. `Move up` and `Move down` include that label and hint in the accessible name, and they are disabled at the ends. `Remove` does too.

Add carousel, Add text, and Add button dispatch `addSection`. Focus then moves to the `Section settings` heading. Remove moves focus to the next selected row, or to the empty editor message when nothing remains. There is no drag-and-drop.

The phone lists the same sections in array order. Each placeholder shows the registry label and the hint. Move down on the first demo carousel swaps it with `New this week` in the list and in the phone. The two text placeholders keep `New this week` and `From the floor`. Removing the middle `Continue` button leaves the other rows in order. Removing every row shows `No sections yet. Add a carousel, a text block, or a button.` and `Nothing to preview yet.` The three add controls stay enabled.

The inspector shows the stored type, the section id, and `Fields for this section arrive in the next prompts.` It has no field inputs.

`Save`, `Export JSON`, and `Import JSON` are visible, disabled, and described by `Not available yet`.

The regions are labelled `Sections`, `Section settings`, and `Phone preview`. Buttons use a visible focus outline.

## Commands and results

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 145 in `@reactiv/editor`. Eight of the editor tests are the shell cases.
- `pnpm typecheck` exited 0.
- With the seeded service on port 4001, the editor rendered six rows from the loader, including `New this week` and `section-carousel-1`. Move down swapped that carousel with the first text block in the phone. The browser recorded no fetch, and the service log shows no request to port 4001 after that click. The page did not include the service token.

## Acceptance progress

A01 passes. The route is React Router v7 framework mode with the server runtime and TypeScript. The editor state is `EditorProvider`'s `useReducer`, and the shell reads it through context.

F03 does not pass. The shell can hold more than one section of each type, and the placeholders stay in order, but the preview is not the real carousel, text, or button preview.

F04 does not pass. Reorder updates the draft and the placeholders with no save. Export and reload are not implemented.

F11 does not pass. The 1024px split and a 375px frame were checked while building the shell. The three required viewport tests are prompt 26.

F12 does not pass. The shell has labelled regions, accessible control names, and a visible focus outline. The real fields and their inline errors are later.

Page 1, Technology Requirements: the editor now uses the locked stack, including Context and `useReducer`.

Page 2, Editor Behaviour: the shell holds many sections and reorders them immediately. The requirement is not fully met until each type's real fields update a real preview.

Page 4, User Experience: the main shell controls are reachable. Bad-input handling is later.
