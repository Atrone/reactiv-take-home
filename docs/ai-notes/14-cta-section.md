# 14 — CTA section

13 October 2026. Prompt 15 was not started. The carousel inspector and preview are still placeholders.

## Registry

The React registry is `apps/editor/app/features/sections/section-ui-registry.tsx`. It is static. It does not download a component. The pure factory registry in `@reactiv/contracts` is unchanged and still has no React import.

| Key | Inspector | Preview |
| --- | --- | --- |
| `cta` | Label, link, button color, label color | Button, revealed destination, and Open destination |
| `text` | Title, description, title color, description color | Title and description text |
| `carousel` | Pending sentence | Label and hint placeholder |

The shell reads that registry for the inspector body and for each phone block. CTA fields dispatch `updateSection`. The raw string is stored, including `notaurl`, `#`, and `#12`. The link and color inputs are `type="text"`, so a keystroke does not replace the field with the previous valid value.

## Preview

Preview activation reveals the URL; Open destination is the explicit navigation.

The phone control is a `<button type="button">`. Activating it shows the draft URL as text, for example `Destination: https://example.com/sale`. That click does not call `location.assign`, does not open a window, and does not submit a form. `Open destination` is an anchor with `target="_blank"` and `rel="noreferrer"`. It is the only control that leaves the editor, and only as a new tab. An invalid URL omits that anchor and keeps the button.

A valid color is painted as lowercase `#rrggbb`. An invalid or empty color keeps the last valid color for that field. When the field has never held a valid color, the button background uses `#112233` and the label uses `#ffffff`. Button color and label color remember their colors separately, and two CTAs do not share them. The button label is a React text node. A label that contains `<img src=x onerror=alert(1)>` is visible as those characters and does not create an image.

## Contrast and invalid values

The warning threshold is **4.5:1**, comparing the label color with the button color. A ratio below that shows `Low contrast`. A ratio of 4.5 or higher does not. The warning uses the current strings only when both are valid hex colors. `#` and `#12` do not warn. The warning does not reject the color and does not block a later Save. Save is still the disabled control from the shell.

An invalid link or color stays in the draft. The inline error names the field: `Link must be an absolute HTTP(S) URL.`, `Button color must be a hex color like #112233.`, or `Label color must be a hex color like #112233.` A blank label, including spaces only, shows `Enter a label.` and does not throw. An empty link or an empty color is unfinished: the raw string stays, and there is no error. The other fields stay.

## Commands and results

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 212 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- In the browser, on `http://127.0.0.1:5173/`, the first CTA was `Continue` with link `https://example.com/continue`, button color `rgb(36, 48, 68)`, and label color `rgb(255, 255, 255)`. Changing the label to `Shop the sale` and the link to `https://example.com/sale` updated that preview and left `See the list` on `https://example.com/list`. Clicking the preview button showed `Destination: https://example.com/sale` and left the address at `http://127.0.0.1:5173/`. The control was a `button` with `type="button"`. `Open destination` pointed at `https://example.com/sale` with `target="_blank"` and `rel="noreferrer"`. Setting the colors to `#010101` and `#abcdef` painted `rgb(1, 1, 1)` and `rgb(171, 205, 239)` on that button only. `notaurl` stayed in the link field, named the Link field, removed the anchor, and updated the revealed line to `Destination: notaurl`. HTML in the label stayed text. A blank label showed `Enter a label.` White on white showed `Low contrast` and kept both colors. The page was still `/`.

## Acceptance progress

F10 passes. Each CTA has an editable label, destination URL, button color, and label color. The preview uses those colors and reveals the configured URL. The preview button does not leave the editor. `Open destination` is the new-tab control. The evidence is `apps/editor/app/features/sections/cta-section.test.tsx` and the block comment on `CtaPreviewView` in `cta-preview.tsx`.

F12 does not pass. The CTA fields have visible labels, and a blank label, an invalid link, or an invalid color names the field without dropping the other values. The rest of the field rules are prompt 23.

Page 1–2, Call to Action Section: the preview shows a button with a label, and the inspector changes the label, the link, and the hex color of the button and the label text.
