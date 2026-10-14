# 27 — Brand fixtures

13 October 2026. Prompt 28 was not started.

## Fixtures

`createHarborDocument` and `createMarketDocument` live in `packages/contracts/src/brand-fixtures.ts`. Both parse with `editableDocumentSchema`. They are not the demo seed. `createDemoDocument` is still what the seed inserts.

Harbor is text, one landscape carousel, then a button. The title is `Harbor`. The button background is `#102030` and the label color is `#ffffff`. The slides are `https://example.com/harbor/pier.jpg` and `https://example.com/harbor/boats.jpg`. Section ids are `harbor-title`, `harbor-slides`, and `harbor-button`.

Market is a button, one square carousel, then text. The title is `Saturday market`. The button background is `#8c3a12` and the label color is `#fff4e8`. The slides are `https://example.com/market/stall.jpg` and `https://example.com/market/crates.jpg`. Section ids are `market-button`, `market-stalls`, and `market-sign`.

Those six section ids do not overlap. The type order is `text, carousel, cta` for harbor and `cta, carousel, text` for market.

## Hardcoded colors

No merchant hex was removed from the preview components. Title, description, button background, and label color already come from the draft. A valid draft color is the painted color.

Left as invalid-input defaults, used only when that field is empty or has never held a valid hex color:

- `#112233` — text title and CTA background (`DEFAULT_TEXT_TITLE_COLOR`, `DEFAULT_CTA_BACKGROUND_COLOR`)
- `#334455` — text description (`DEFAULT_TEXT_DESCRIPTION_COLOR`)
- `#ffffff` — CTA label (`DEFAULT_CTA_LABEL_COLOR`)

`#ffffff` is also `TEXT_PREVIEW_BACKGROUND`, the phone surface used for the contrast warning. That white is not painted in place of a valid title color.

Left, and not an invalid-input default:

- `#f3efe6` — the carousel frame and the image placeholder (`FRAME_BACKGROUND` and `.carousel-frame`). It is not a configured section color.
- Inspector and phone chrome in the stylesheets: borders, focus, the phone bezel, and error text. `.preview-cta-button`, `.preview-text-title`, and `.preview-text-description` set no hex color. The revealed destination line and the Open destination link keep their own chrome colors.

A CTA whose draft background is `#102030` paints `#102030`, not `#112233`. An empty background still paints `#112233`, and an empty label color still paints `#ffffff`.

## Commands and results

- `pnpm test` exited 0. Vitest passed 66 tests in `@reactiv/contracts`, 222 in `@reactiv/config-service`, and 344 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.

The first `pnpm test` failed in `does not create a row when GET misses`: the public table count was 2 after the request and 3 before it. That case does not load these fixtures. The rerun above passed.

## Acceptance progress

R04 passes. Harbor and market keep their colors, copy, imagery, and order when the same `SectionPreview` renders each fixture. A valid configured button color is not replaced by `#112233`. The evidence is `packages/contracts/src/brand-fixtures.test.ts` and `apps/editor/app/features/sections/brand-fixtures.test.tsx`.

Page 4, Foundations and Extensibility: a different merchant document does not need a forked preview component. The seeded editor was left on `createDemoDocument`.
