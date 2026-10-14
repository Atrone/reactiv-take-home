# 28 — Preview benchmark

13 October 2026. Prompt 29 was not started.

## Measurement

The write-up is `docs/preview-benchmark.md`. The paint p95 from the single run is 17.699999809265137 ms.

That is the 48th of 50 paint samples sorted ascending. The fastest sample in that run was 7.400000095367432 ms and the slowest was 19.699999809265137 ms. The suggested R08 target is under 100 ms. This run met it. The same edits' commit p95 was 3.6999998092651367 ms; the reported number is the paint p95, which waits until after the frame that shows the title.

Architecture section 12 proposes p95 ≤ 50 ms at the supported document limit. This run's p95 is below 50 ms. The fixture is the R08 document: 30 sections, including 10 carousels with 10 images each, 14041 bytes. That is inside the shared limits and smaller than the 100-section and 256 KiB ceilings. The timer is `requestAnimationFrame` plus `setTimeout(0)` in headless Chromium, which the write-up describes. Shopper configuration traffic, CDN delivery, and a Reactiv client workload were outside this run. The number is not in the README.

Machine: Windows_NT 10.0.26200 x64, AMD Ryzen 9 6900HX with Radeon Graphics, 16 logical processors, 3294 MHz, 21243367424 bytes of RAM. Browser: headless Chromium 156.0.8078.4 (Playwright 1.64.0), viewport 1440 × 900. Production build via `react-router build` and `react-router-serve`. Image requests to `https://example.com/preview-benchmark/` were fulfilled with a 1×1 PNG. Twenty image responses had completed before the timed edits. The route stayed installed for the 50 title replacements (`Edit 1` through `Edit 50` on `bench-text-0`).

## Files

- `e2e/preview-benchmark-fixture.mjs` — the 30-section document.
- `e2e/preview-benchmark-serve.mjs` — builds and serves the production editor, and serves the fixture.
- `e2e/preview-benchmark.spec.ts` — the 50-edit measurement, next to the other Playwright tests.
- `playwright.preview-benchmark.config.ts` — retries 0, production web server.
- `playwright.config.ts` — ignores the benchmark spec so the carousel dev-server suite does not run it.

The editor was not rewritten. The run met the suggested target, and the samples show the preview text updating in a few milliseconds with the rest of each paint sample waiting for the frame.

After that run, the spec named the route callback, the eager-slide poll, and the user-agent read. `measureTitleEdits` was left as it ran. The 50 samples were not collected again.

## Commands and results

- `pnpm exec playwright test --config playwright.preview-benchmark.config.ts` exited 0. One test passed: `measures 50 preview title updates on the production 30-section fixture`.
- `pnpm typecheck` exited 0.

## Acceptance progress

R08 passes. The local preview benchmark covers 30 sections, including 10 carousels with 10 images each, in a production build with stubbed images, for 50 text edits. The write-up has the hardware, the browser, the method, and the measured p95 of 17.699999809265137 ms. The evidence is `docs/preview-benchmark.md` and `e2e/preview-benchmark.spec.ts`.

Page 4, pragmatism: the figure is one local observation, with the fixture size, the headless browser, the stubbed images, and the frame-bounded paint marker stated beside it.
