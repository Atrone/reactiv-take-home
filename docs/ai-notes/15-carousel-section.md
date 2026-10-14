# 15 — Carousel section

13 October 2026. Prompt 16 was not started.

## Registry

The React registry is `apps/editor/app/features/sections/section-ui-registry.tsx`. It is static. It does not download a component. The pure factory registry in `@reactiv/contracts` is unchanged and still has no React import.

| Key | Inspector | Preview |
| --- | --- | --- |
| `carousel` | Aspect ratio, image URL, alt text, add, and remove | Horizontal scroll-snap frames |
| `text` | Title, description, title color, description color | Title and description text |
| `cta` | Label, link, button color, label color | Button, revealed destination, and Open destination |

The shell reads that registry for the inspector body and for each phone block. The pending carousel sentence is gone. There is no carousel plugin and no automatic motion.

## Ratios

The document still stores the names `portrait`, `landscape`, and `square`. The preview reads `ASPECT_RATIO_DISPLAY`.

| Stored name | CSS `aspect-ratio` |
| --- | --- |
| `portrait` | `3 / 4` |
| `landscape` | `16 / 9` |
| `square` | `1 / 1` |

Landscape is `16 / 9`. The acceptance checklist suggested `4 / 3`, and this preview follows the architecture note instead. Each image uses `object-fit: cover`. The frame keeps that ratio before the image loads.

## Scroll and images

Each carousel has its own scroller, with `scroll-snap-type: x mandatory` and one snap item per image. `Previous image` and `Next image` are `type="button"`. They scroll that carousel by one slide and are disabled at the ends. They do not wrap. Scrolling or editing one carousel does not change the other's slides or ratio.

`Add image` appends a slide with a new id, an empty URL, and empty alt. `Remove image` removes that slide only. An empty list shows `No images in this carousel`. Add image stays in the inspector. An empty URL is unfinished and does not throw. A non-empty invalid URL shows `Image URL must be an absolute HTTP(S) URL.` and is not assigned to `src`. An absolute HTTP(S) URL is the `src`. A load that fails still uses the browser's broken icon. Prompt 17 replaces that icon.

The `img` `alt` is the alt text. A blank alt uses `Slide n` as the accessible name only. That fallback is not a visible caption.

## Commands and results

The Playwright test does not use Postgres. `e2e/carousel-fixture-service.mjs` answers the editor loader's `GET /v1/configurations/cfg_playwright` with a two-slide document. Playwright fulfills `https://example.com/carousel/**` with a local PNG, so the slide bytes do not use the network.

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 252 in `@reactiv/editor`.
- `pnpm exec playwright test` exited 0. One test passed: Next image, activated with Enter, brings the second slide into that carousel's scrollport. Previous image then brings the first slide back and stops.
- `pnpm typecheck` exited 0.

## Acceptance progress

F05 passes. A carousel with more than one image scrolls horizontally, and the next control reaches the later image. Previous image scrolls back one slide and stops. Another carousel is a separate scroller. The evidence is `e2e/carousel-scroll.spec.ts` and the two-carousel cases in `apps/editor/app/features/sections/carousel-section.test.tsx`.

F06 passes. The inspector adds, edits, and removes image URLs. The preview order matches the list order. Removing the final image shows `No images in this carousel`. The evidence is `apps/editor/app/features/sections/carousel-section.test.tsx`.

F07 does not pass yet. The geometry gate does: portrait is `3 / 4`, landscape is `16 / 9`, and square is `1 / 1`, with cover cropping. The criterion also requires the mode to survive export, import, and save/reload. That fixture is prompt 20. Do not treat F07 as passed until that fixture exists.

Page 1, Carousel Section: the preview scrolls horizontally; the inspector adds, edits, and removes image URLs; portrait, landscape, and square change the frame.
