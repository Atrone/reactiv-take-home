# 13 — Text section

13 October 2026. Prompt 14 was not started. Carousel and button inspectors and previews are still placeholders.

## Registry

The React registry is `apps/editor/app/features/sections/section-ui-registry.tsx`. It is static. It does not download a component. The pure factory registry in `@reactiv/contracts` is unchanged and still has no React import.

| Key | Inspector | Preview |
| --- | --- | --- |
| `text` | Title, description, title color, description color | Title and description text |
| `carousel` | Pending sentence | Label and hint placeholder |
| `cta` | Pending sentence | Label and hint placeholder |

The shell reads that registry for the inspector body and for each phone block. Text fields dispatch `updateSection`. The raw string is stored, including `#` and `#12`. The color inputs are `type="text"`, so a keystroke does not replace the field with the previous valid color.

## Preview

The phone screen behind text is `#ffffff` (`.phone-screen`). A valid color is painted as lowercase `#rrggbb`. An invalid or empty color keeps the last valid color for that field. When the field has never held a valid color, the title uses `#112233` and the description uses `#334455`. Title color and description color remember their colors separately, and two text sections do not share them.

The title and the description are React text nodes. A title that contains `<img src=x onerror=alert(1)>` is visible as those characters and does not create an image. The description uses `white-space: pre-wrap` and `overflow-wrap: anywhere`, so newlines stay and long lines wrap. An empty title and an empty description render an empty text block.

## Contrast and invalid colors

The warning threshold is **4.5:1**. A ratio below that shows `Low contrast` on the title color. A ratio of 4.5 or higher does not. Black on white is 21:1 and does not warn. `#777777` on white is about 4.48:1 and warns. The warning uses the current title color only when that string is a valid hex color. `#` and `#12` do not warn.

An invalid color stays in the draft. The inline error names the field, for example `Title color must be a hex color like #112233.`, and the other fields stay. The contrast warning does not reject the color and does not block a later Save. Save is still the disabled control from the shell. This prompt does not strip an invalid color in preparation for that Save.

## Commands and results

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 180 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- In the browser, on the seeded screen, the first text section's title color was cleared to `#`. The input stayed `#`, the title paint stayed `rgb(17, 34, 51)` (`#112233`), and the description color stayed `#334455`. The second text section stayed `From the floor` with title color `rgb(61, 43, 31)` and description color `rgb(92, 107, 115)`. Typing `112233` after the hash restored `#112233` and removed the error. Setting `#777777` showed `Low contrast` and left the description color and the second section in place. Those edits did not send a request to the configuration service. The component tests cover the same fact with a fetch spy.

## Acceptance progress

F08 does not pass. A text section can hold a multiline Unicode description in the draft and the preview. Export, save, and reload are not implemented. Prompt 20's round-trip fixture still has to include that description.

F09 does not pass. Title color and description color are independent, including across two text sections. Export, save, and reload of those colors are not implemented.

D07 does not pass. Ordinary text is rendered as text, which is the rendering half. Import still has to use the same color and URL rules. That is prompt 19.

F02 does not pass. The text fields update the preview from the draft without a fetch, and one section does not change another. The same proof for every field is prompt 16.

F12 does not pass. The text fields have visible labels, and an invalid color names the field without dropping the other values. The rest of the field rules are prompt 23.

Page 1, Textarea Section: the preview shows a title and a description, and the inspector changes the text and the hex color of each. That PDF bullet is not finished here. Prompt 16 shows the edits are immediate for every field, and prompt 20 shows they survive reload.
