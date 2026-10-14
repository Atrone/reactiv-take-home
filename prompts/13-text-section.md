# Prompt 13 — Text section

Implement only this prompt. Preconditions: prompt 12 is done. The shell hydrates the demo document and can reorder placeholders.

## Read first

- Architecture sections 5 and 6: text limits, in-progress color strings, last valid color in the preview, contrast warning, plain text, line breaks
- Take-home PDF page 1, Textarea Section
- Acceptance criteria F02, F08, F09, F12, D07. This prompt is the editing and safe-rendering exit gate. F08 and F09 fully pass in prompt 20. D07 fully passes in prompt 19. F02 waits until prompt 16

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Render text with React text nodes. Do not use `dangerouslySetInnerHTML`.
- Do not reset a color input to the previous value on each keystroke.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/13-text-section.md`.
- Register the text inspector and renderer on the static registry. The carousel and CTA entries can remain placeholders.

## Goal

A text inspector edits title, description, title color, and description color. The phone preview shows those values immediately from the draft. One text section's fields do not affect another.

## Implement

1. Inspector fields, each with a visible `<label>`:
   - Title, single line
   - Description, textarea
   - Title color
   - Description color
2. Dispatch `updateSection` on change. Keep the raw string in the draft, including incomplete values such as `#` or `#12`.
3. Preview:
   - Shows the title and the description as text
   - Preserves description line breaks with CSS such as `white-space: pre-wrap` and wraps long lines
   - Applies a color only when that field's current string is valid. Otherwise keep the last valid color for that field, or `#112233` for the title and `#334455` for the description when no valid color has been entered
   - Does not interpret `<script>` or HTML in the title. The characters appear as text
4. When the color string is non-empty and invalid, show an inline error that names the field, for example `Title color must be a hex color like #112233.` Do not discard the other fields.
5. Contrast: when both the title color and a white-or-better phone background are valid, compute a contrast ratio against the preview background. The preview background for text is white unless you document another background. If the ratio is below 4.5:1, show a warning `Low contrast`. Do not block later Save and do not reject the color. A simple relative-luminance function is enough. Unit-test it with black on white (no warning) and `#777777` on white (warning).
6. Empty title and empty description are allowed and must not throw. The preview shows an empty text block, not a crash.
7. Tests:
   - typing in the title updates the preview text without a fetch
   - a multiline description keeps its newline in the preview
   - a title containing `<img src=x onerror=alert(1)>` is visible as text and does not create an image element
   - changing title color does not change description color
   - two text sections: editing the first title leaves the second title in the preview
   - the input value `#` remains `#` while the preview keeps the previous valid color
   - Unicode title `Café — 新品` is kept in the draft

Persistence and export of these values are later prompts. The tests here are component tests with the provider hydrated from a fixture, not from the network.

## Out of scope

- CTA and carousel field editors, Save, import.

## Acceptance criteria

No acceptance ID fully passes. F08 and F09 include export and save/reload in the same criterion, and those paths do not exist yet.

Exit gate, which prompt 20 needs in order to pass F08 and F09:

- Each text section displays an independently editable title and description. Normal text, multiline descriptions, and Unicode stay in the draft and the preview. Evidence: the component tests.
- Title and description colors are independent. A valid hex value changes only the matching preview text. Evidence: two text sections and separate color assertions.
- Ordinary text is rendered as text. A title containing markup does not create an element. This is the rendering half of D07. The import half of D07 is prompt 19.

Prompt 20's round-trip fixture must include a multiline Unicode description and two different text colors, then export, save, and reload them.

## Take-home PDF requirements

Page 1, Textarea Section, is implemented: the preview shows a title and a description, and the inspector changes the text and the hex color of each. The requirement is fully covered when prompt 16 shows those edits are immediate and prompt 20 shows they survive reload. Do not treat this prompt alone as the end of that PDF bullet.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manually type `#` then `112233` in the title color of one section and confirm the other section and the description color stay put

## Done when

- The text tests pass, including the HTML-as-text test.
- The note records the contrast threshold, that invalid colors are not rejected for a future save, and that F08, F09, and D07 are not fully passed yet.
- You have not started prompt 14.
