# Prompt 28 — Preview benchmark

Implement only this prompt. Preconditions: prompt 27 is done. The editor is functionally complete.

## Read first

- Acceptance criteria R08
- Architecture section 12, the preview-response row. That row is a proposed production-extension target of p95 ≤ 50 ms. R08's local target is p95 under 100 ms for 50 text edits. Report both numbers honestly. Do not claim the architecture's 50 ms target unless your measurement meets it, and do not call either number a shopper-traffic result

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Record the number you actually measure. If it misses the target, write the number and the likely cause. Do not edit the result to pass, and do not loop the test until a lucky sample replaces a worse one without saying so.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/28-preview-benchmark.md`.
- This prompt does not authorize a rewrite of the editor unless the measurement shows a clear accidental bottleneck, such as validating the entire document synchronously in a way that throws away input. A small fix is allowed. A state-library migration is not.

## Goal

Measure local preview responsiveness on a large-but-legal document and record the method and the result.

## Implement

1. A fixture with 30 sections, including 10 carousels with 10 images each, inside the prompt 02 limits. Image URLs should be local data or stubbed responses so the measurement is not network-bound. The acceptance text says cached or stubbed images. Use stubbed or tiny local images.
2. A Playwright or browser script in a production build:
   - load the fixture through the editor
   - perform 50 title edits in one text field, for example append a character or replace the title with `Edit 1` through `Edit 50`
   - measure from just before the input event to the next paint that shows the new title. `performance.now()` around the action plus a `requestAnimationFrame` or a Playwright locator wait is acceptable if you describe it
   - compute p95 of those 50 samples
3. Write `docs/preview-benchmark.md` with:
   - date
   - hardware and browser you actually used
   - production or dev build, and which one
   - image strategy
   - sample count
   - p95 in milliseconds
   - whether that met the suggested R08 target of under 100 ms
   - one sentence on the bottleneck if it missed
4. Do not put this number in a public performance claim, a badge, or the README's feature list as a guarantee. Prompt 30 may mention the measured number as a local observation.

If Playwright cannot see paint timing accurately, use the Chrome performance timeline through the browser tools you have and say so. A single manual sample is not enough. You need the 50 edits.

## Out of scope

- Load testing the API, CDN measurements, and changing the document limits to make the fixture smaller than R08 requires.

## Acceptance criteria that fully pass

- **R08.** A local preview benchmark exists for 30 sections, including 10 carousels with 10 images each, in a production build with stubbed or cached images, covering 50 text edits. The write-up includes hardware, browser, method, and the actual p95. The suggested target is under 100 ms. Meeting it is not required for this criterion to pass; inventing a number is a failure. Evidence: `docs/preview-benchmark.md` and the script committed next to the tests.

## Take-home PDF requirements

The PDF does not set a latency number. Page 4, pragmatism, is met by reporting a real measurement and its limit. Do not imply the figure is a Reactiv client workload.

## Verification

- Run the benchmark once and commit the written result into `docs/preview-benchmark.md` by leaving the file in the working tree. Do not commit git unless the user asks.
- `pnpm typecheck` if you added TypeScript

## Done when

- `docs/preview-benchmark.md` contains a real p95, the machine description, and the method.
- The note points at that file and does not round the number down.
- You have not started prompt 29.
