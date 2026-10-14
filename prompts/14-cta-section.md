# Prompt 14 — CTA section

Implement only this prompt. Preconditions: prompt 13 is done. Text sections edit and preview correctly.

## Read first

- Architecture section 6, CTA clicks reveal the destination without leaving the editor; opening it is a secondary action
- Take-home PDF page 1–2, Call to Action Section
- Acceptance criteria F10 and F12

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- A click on the preview CTA must not navigate the editor page away and must not submit the editor form.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/14-cta-section.md`.
- Register the CTA inspector and renderer on the static registry.

## Goal

The inspector edits label, destination URL, button color, and label color. The preview shows a button that uses those colors and reveals the URL without discarding the editing session.

## Implement

1. Labelled fields: `Label`, `Link`, `Button color`, `Label color`.
2. Raw strings stay in the draft while the URL or either color is incomplete. Inline errors name the field. A blank label is an inline error `Enter a label.` and must not throw.
3. Preview button:
   - Text is the label, rendered as text
   - Background and foreground colors follow the same last-valid-color rule as text. Defaults are background `#112233` and label `#ffffff`
   - The control is a `<button type="button">`, not an `<a href>`, so activation cannot navigate
   - Activating it shows the configured URL as text inside the preview, for example `Destination: https://example.com/sale`. It does not call `location.assign` or open a window
   - A second control, `Open destination`, is an anchor with `target="_blank"` and `rel="noreferrer"`. It is the only control that navigates, and only as a new tab. If the URL is invalid, omit the anchor and keep the button
4. Low-contrast warning when the label color on the button color is below 4.5:1. Warning only.
5. Two CTAs on one screen keep independent labels, URLs, and colors.
6. Tests:
   - editing the label updates the preview button text
   - editing the URL updates the revealed destination and does not change the other CTA
   - button color and label color can be set to two different valid hex values and both are present as styles or attributes you can assert
   - clicking the preview button leaves the current location unchanged
   - an invalid URL string `notaurl` remains in the input
   - HTML in the label is shown as text

Document the navigation choice in the component's block comment so prompt 30 can copy it into the README: preview activation reveals the URL; `Open destination` is the explicit navigation.

## Out of scope

- Carousel, Save, import.

## Acceptance criteria that fully pass

- **F10.** Each CTA shows an editable label, destination URL, button color, and label color. The preview uses the configured destination and colors. Navigation does not discard the editing session: the preview button reveals the URL, and only `Open destination` opens a new tab. Evidence: component tests and the block comment that prompt 30 will lift into the README.

## Take-home PDF requirements that fully pass

- Page 1–2, Call to Action Section: a button with a label; editable label and link; editable hex colors for the button and the label text.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manual check: click the preview CTA and confirm the editor is still on `/` with the draft intact

## Done when

- F10 tests pass.
- The note records the navigation behavior in one sentence.
- You have not started prompt 15.
