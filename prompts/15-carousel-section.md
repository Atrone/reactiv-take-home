# Prompt 15 — Carousel section

Implement only this prompt. Preconditions: prompt 14 is done. Text and CTA sections preview correctly.

## Read first

- Architecture section 6, preview and usability: ratios `3 / 4`, `16 / 9`, `1 / 1`, `object-fit: cover`, horizontal scroll snap, previous/next controls, empty state, alt text
- Take-home PDF page 1, Carousel Section
- Acceptance criteria F05, F06, F07. F05 and F06 pass here. F07's geometry is the exit gate; F07 fully passes in prompt 20 when a ratio survives export and reload

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Do not add automatic carousel motion.
- Do not install a carousel plugin unless the scroll behavior cannot be done with CSS. Prefer CSS overflow and scroll snap.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/15-carousel-section.md`.
- This prompt does not have to finish broken-image placeholders. Prompt 17 does that. Images that load should still be visible.

## Goal

Each carousel scrolls horizontally through its own images, in order, and can switch among portrait, landscape, and square frames. The inspector can add, edit, and remove image URLs. A second carousel is unaffected.

## Implement

1. Inspector:
   - A radio group or select labelled `Aspect ratio` with `Portrait`, `Landscape`, and `Square`
   - A list of images with labelled `Image URL` and `Alt text` fields
   - `Add image` appends an image with a new id, empty URL, and empty alt
   - `Remove image` removes that image only
   - Inline error on a non-empty invalid URL. An empty URL is an in-progress value and must not throw
2. Preview:
   - A horizontally scrolling region with `scroll-snap-type: x mandatory` and one snap item per image
   - Each frame uses aspect-ratio `3 / 4`, `16 / 9`, or `1 / 1` for the selected mode, and `object-fit: cover`
   - The `<img>` `alt` is the alt text. If alt is blank, use a fallback `Slide <n>` and include that fallback only as the accessible name, not as a second visible caption, unless the visible empty state needs it
   - `Previous image` and `Next image` buttons with accessible names. They scroll the region by one item. They are keyboard operable. They do not wrap past the ends; disable them instead
   - Empty image list: a visible message `No images in this carousel` and the `Add image` control remains in the inspector. The preview must not collapse the page or throw
3. Independence: each carousel has its own scroll container and its own aspect ratio. Scrolling or editing one does not change the other's images or ratio.
4. Tests:
   - a carousel fixture with three images renders three images in order
   - editing the second image URL changes that image only
   - removing the last remaining image shows the empty message
   - adding an image appends it after the existing ones
   - switching to portrait changes the frame's aspect-ratio style to `3 / 4`; landscape `16 / 9`; square `1 / 1`
   - two carousels render different URLs. Updating one leaves the other intact
   - previous/next controls exist and are buttons

F05 requires that a person can actually reach every image by scrolling. Testing Library does not prove that. Add one Playwright test in this prompt that opens the editor, finds a carousel with at least two images, uses the next control or a real scroll, and asserts the second image is visible. Stub image responses so the test does not depend on the network. This is the F05 evidence.

## Out of scope

- Lazy loading and broken-image placeholders beyond a browser's default broken icon. Prompt 17 replaces the default broken icon with a bounded placeholder.
- Save and export.

## Acceptance criteria that fully pass

- **F05.** A carousel with multiple images scrolls horizontally and the user can reach every image. Scrolling or changing one carousel does not affect another. Evidence: the Playwright test plus the two-carousel component test.
- **F06.** The user can add, edit, and remove an image URL. The preview order matches the list order. Removing the final image shows a usable empty state. Evidence: component tests.

F07 does not fully pass. The geometry exit gate is required here: portrait, landscape, and square map to `3 / 4`, `16 / 9`, and `1 / 1`, with cover cropping. The criterion also says the mode survives export, import, and save/reload. Prompt 20's fixture must change a ratio and read it back. Document the ratios in the note. Do not mark F07 passed until that fixture exists.

## Take-home PDF requirements that fully pass

- Page 1, Carousel Section: horizontal scroll; add, edit, and remove image URLs; portrait, landscape, and square views.

## Verification

- `pnpm test`
- `pnpm exec playwright test` for the new scroll test, with the app and seeded service running if the test is not fully stubbed. Prefer stubbing the loader data so the test does not need Postgres, and say which you did.
- `pnpm typecheck`

## Done when

- F05 and F06 pass, and the F07 geometry tests pass.
- The note records the three CSS ratios, that landscape is `16 / 9` rather than the checklist's suggested `4 / 3`, and that F07 is not fully passed yet.
- You have not started prompt 16.
