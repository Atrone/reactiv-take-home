# Prompt 27 — Brand fixtures

Implement only this prompt. Preconditions: prompt 26 is done.

## Read first

- Acceptance criteria R04
- Architecture section 5: branding comes from the document, and components do not own a merchant palette
- Take-home PDF page 4, foundations and extensibility: the same components should be able to show different configured screens

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Do not add a design-token system, a theme provider, or a font CDN.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/27-brand-fixtures.md`.

## Goal

Two contrasting valid documents render different colors, copy, images, and order from configuration alone. Components do not replace those colors with a built-in brand.

## Implement

1. Add `packages/contracts` fixtures, or a `fixtures/` module next to the demo document:
   - `harbor` — deep blue CTA `#102030` with white label `#ffffff`, a short title, one carousel, landscape
   - `market` — warm CTA `#8c3a12` with light label `#fff4e8`, different title, different order, square carousel, different image URLs on `https://example.com/...`
2. Both fixtures parse with the shared schema. They use different section ids.
3. The preview components take colors from props that come from the draft. Search the section components for hex literals. Allowed literals are the documented in-progress defaults from prompts 13 and 14 (`#112233`, `#334455`, `#ffffff`) used only when a draft color is invalid or empty. They must not be used as the rendered color when the draft color is valid.
4. Tests:
   - render `harbor` and assert the CTA background computed style or the style attribute contains `#102030` and the title text is the harbor title
   - render `market` and assert `#8c3a12`, the market title, and a different section order
   - neither render shows the other fixture's title
   - a component test that the valid draft color wins over the default: if the draft says `#102030`, the button is not `#112233`

The demo seed can stay on `createDemoDocument`. Do not replace the seed unless a test requires one of these fixtures in the database. A unit render from the fixture object is enough.

## Out of scope

- Tenant-specific CSS files, white-label builds, and a theme switcher in the UI.

## Acceptance criteria that fully pass

- **R04.** Two contrasting fixtures keep their colors, copy, imagery, and order when rendered from configuration. Components do not substitute a hardcoded demo brand for a valid configured color. Evidence: the two render tests and the hex-literal check.

## Take-home PDF requirements

Page 4, Foundations and Extensibility: the screen is data, so a different merchant document does not require a forked preview component. This is the evidence. No PDF bullet requires a second visual theme beyond the configurable colors.

## Verification

- `pnpm test`
- `pnpm typecheck`

## Done when

- R04 passes.
- The note lists any hardcoded colors you removed or left as invalid-input defaults.
- You have not started prompt 28.
