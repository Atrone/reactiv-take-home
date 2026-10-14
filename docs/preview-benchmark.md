# Preview benchmark

Local editor measurement from one run on 13 October 2026 (machine timezone offset 240 minutes, UTC−4). Shopper configuration traffic, CDN delivery, and a Reactiv client workload were outside this run. This page is the observation. It is not a performance guarantee.

## Result

The paint p95 is **17.699999809265137 ms**.

That is the 48th of the 50 paint samples after sorting them ascending (nearest rank: `ceil(0.95 × 50)`). It is one of the observed edits. It is not an interpolated percentile. The same value appears in the edit-order list below.

The fastest paint sample was 7.400000095367432 ms. The slowest was 19.699999809265137 ms.

R08 suggests a local target under 100 ms for these 50 edits. This run met that target.

Architecture section 12 proposes a production-extension preview-response target of p95 ≤ 50 ms at the supported document limit, with browser profiling as the proof. This run's p95 is below 50 ms. The fixture used here has 30 sections and a 14041-byte JSON body, inside the shared limits, and smaller than the 100-section and 256 KiB ceilings. The timer is the `requestAnimationFrame` plus `setTimeout(0)` method below. Meeting the numeric 50 ms line on this fixture does not establish that production-extension target.

## Machine and browser

- Hardware: Windows_NT 10.0.26200 x64, AMD Ryzen 9 6900HX with Radeon Graphics, 16 logical processors, 3294 MHz, 21243367424 bytes of RAM.
- Browser: Playwright 1.64.0, headless Chromium 156.0.8078.4. User agent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/156.0.8078.4 Safari/537.36`.
- Viewport: 1440 × 900 CSS pixels. The preview title was inside that viewport before the timed edits.

## Build

Production build. The launcher runs `pnpm --filter @reactiv/contracts build`, checks the fixture with `configurationSchema` and `isPayloadWithinLimit`, then runs `pnpm --filter @reactiv/editor build` (`react-router build`) and `react-router-serve ./build/server/index.js` with `NODE_ENV=production` on `http://127.0.0.1:4191`. The fixture server listens on `http://127.0.0.1:4192`. Postgres is not started.

The page had no `@vite/client` script. This was not the Vite dev server.

## Fixture and images

`e2e/preview-benchmark-fixture.mjs` builds 30 sections: 10 text, 10 landscape carousels, and 10 buttons. Each carousel has 10 images (100 images). The edited field is the title of `bench-text-0`, which starts as `Bench title`. The loader selects that first section.

The configuration JSON is 14041 bytes, under the shared 256 KiB cap. The test parses it with `configurationSchema` before the timed edits.

Image URLs use the prefix `https://example.com/preview-benchmark/`. Playwright fulfilled image requests with a 1×1 PNG before any of those requests could use the network. Before the timed edits, 20 image responses had been fulfilled (the eager first slide of each carousel, plus lazy slides the viewport requested). The route stayed installed during the 50 edits. Later slides remain `loading="lazy"` in the document.

## Method

Command, one run, retries off:

`pnpm exec playwright test --config playwright.preview-benchmark.config.ts`

The script is `e2e/preview-benchmark.spec.ts`. The launcher is `e2e/preview-benchmark-serve.mjs`. The ordinary Playwright config ignores this spec so the carousel dev-server suite does not pick it up.

The editor loaded the fixture through its configuration loader. The benchmark then replaced the title with `Edit 1` through `Edit 50`, one input event per edit, on `#text-title-bench-text-0`.

Each paint sample starts at `performance.now()` immediately before that `input` event, after the input's value was already set to `Edit N`. It ends at a `setTimeout(0)` queued from the `requestAnimationFrame` on which `[data-section-id="bench-text-0"] .preview-text-title` already equalled `Edit N`. That timeout runs after the browser paints the frame that showed the title. This is not a Chrome performance-timeline paint timestamp.

The same run also stored a commit time: when the preview text first matched. The commit p95, by the same nearest-rank rule, is 3.6999998092651367 ms. The reported result is the paint p95. The paint samples are larger because they wait until after the frame that shows the title. On this machine they cluster near one frame.

The 50 samples were kept, including the first. Playwright `retries` is 0. The run was not repeated to replace a sample.

## Paint samples, in edit order (ms)

1. 7.400000095367432
2. 14.200000286102295
3. 17.199999809265137
4. 16.300000190734863
5. 16.5
6. 16.40000009536743
7. 17.199999809265137
8. 16.40000009536743
9. 16.40000009536743
10. 14.800000190734863
11. 16.40000009536743
12. 17.40000009536743
13. 17.40000009536743
14. 16.59999990463257
15. 17.399999618530273
16. 15.899999618530273
17. 16.5
18. 16.300000190734863
19. 17
20. 17
21. 16.5
22. 16
23. 17.300000190734863
24. 15.900000095367432
25. 16.700000286102295
26. 17.199999809265137
27. 16.300000190734863
28. 16.5
29. 16.5
30. 17.699999809265137
31. 15.400000095367432
32. 17.200000286102295
33. 16.300000190734863
34. 17.399999618530273
35. 16.300000190734863
36. 16.90000009536743
37. 16.199999809265137
38. 17.800000190734863
39. 15.799999713897705
40. 16.59999990463257
41. 15.699999809265137
42. 17.5
43. 15.900000095367432
44. 17.300000190734863
45. 15.900000095367432
46. 19.699999809265137
47. 13.5
48. 16.40000009536743
49. 16.5
50. 17.199999809265137

Sorted ascending, the 48th value is 17.699999809265137. That is the p95 above.

## Limit of the figure

One laptop, headless Chromium, a production process on loopback, the 30-section fixture, stubbed image bytes, and 50 edits in one title field. The paint marker includes the wait until after the frame that shows the new title. The suggested R08 target was met, so there is no miss cause to assign.
