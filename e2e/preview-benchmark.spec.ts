import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page, type Route } from "@playwright/test";
import {
  BENCHMARK_CAROUSEL_COUNT,
  BENCHMARK_IMAGE_URL_PREFIX,
  BENCHMARK_IMAGES_PER_CAROUSEL,
  BENCHMARK_INITIAL_TITLE,
  BENCHMARK_SAMPLE_COUNT,
  BENCHMARK_SECTION_COUNT,
  BENCHMARK_TEXT_SECTION_ID,
  benchmarkEditTitles,
  previewBenchmarkConfiguration,
} from "./preview-benchmark-fixture.mjs";

/** Directory of this spec. The repository root is its parent. */
const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Repository root. The result file is written under test-results from here. */
const REPO_ROOT = path.resolve(SPEC_DIR, "..");

/** A 1 by 1 PNG. Image requests for the fixture host are fulfilled with these bytes. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * How the paint sample is taken.
 *
 * The number in the write-up is the paint duration, not the commit duration.
 */
const PAINT_METHOD =
  "Each sample starts at performance.now() immediately before dispatching one bubbling input event, after the title input's value was set to Edit N. It ends at a setTimeout(0) queued from the requestAnimationFrame on which the phone preview's .preview-text-title text already equalled Edit N. That timeout runs after the browser paints the frame that showed the title. The same run also records when the preview text first matched, as a commit time. The reported p95 uses the paint times.";

/**
 * Fulfills one benchmark image with a local PNG.
 *
 * Purpose: slide requests stay off the network for the whole page load and the 50 edits.
 * Inputs: route, the browser request. counter, the number of image responses fulfilled so far.
 * Side effects: completes an image request with a 1 by 1 PNG, or aborts a non-image request on this host.
 */
async function fulfillBenchmarkImage(route: Route, counter: { count: number }): Promise<void> {
  if (route.request().resourceType() !== "image") {
    // The button URL shares the image host. This benchmark does not fetch it.
    await route.abort();
    return;
  }
  // Count the stub. The timed edits start only after the eager slides have decoded.
  counter.count += 1;
  await route.fulfill({
    status: 200,
    contentType: "image/png",
    body: TINY_PNG,
  });
}

/**
 * Reads whether the eager carousel slides have decoded.
 *
 * Purpose: image decode for the ten first slides finishes before the first timed edit.
 * Inputs: page, the editor page.
 * Side effects: none.
 */
async function eagerSlidesDecoded(page: Page): Promise<boolean> {
  // The count and the pixel check run in the browser, after the stubbed responses.
  return page.evaluate((expectedEager) => {
    const images = [...document.querySelectorAll("[data-carousel-slide] img")];
    const eager = images.filter((image) => image.getAttribute("loading") === "eager");
    if (eager.length !== expectedEager) {
      return false;
    }
    return eager.every((image) => image.complete && image.naturalWidth > 0);
  }, BENCHMARK_CAROUSEL_COUNT);
}

/**
 * Waits for one animation frame in the page.
 *
 * Purpose: scrolling the preview title into view settles before the first timed edit.
 * Inputs: none. This function runs in the browser.
 * Side effects: none.
 */
function waitForOneFrame(): Promise<void> {
  return new Promise((resolve) => {
    // The callback runs before the next paint, after the scroll layout.
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * Times fifty title replacements inside the loaded editor.
 *
 * Purpose: measure from just before each input event to the paint that shows that title.
 * Inputs: args.sectionId, the text section. args.initialTitle, the title before the loop.
 * args.titles, Edit 1 through Edit 50.
 * Side effects: changes the title field and the phone preview in this page.
 */
async function measureTitleEdits(args: {
  sectionId: string;
  initialTitle: string;
  titles: readonly string[];
}): Promise<{ paintMs: number[]; commitMs: number[]; previewTitle: string | null; inputValue: string }> {
  /**
   * Waits until the preview shows a title, then until that frame has been painted.
   *
   * Purpose: the paint sample includes the frame that displays the new title.
   * Inputs: preview, the phone title element. title, the expected text. started, the clock before the event.
   * commitAt, the time the text already matched, or null when it has not matched yet.
   * Side effects: none.
   */
  function waitForPaintedTitle(
    preview: HTMLElement,
    title: string,
    started: number,
    commitAt: number | null,
  ): Promise<{ commitMs: number; paintMs: number }> {
    return new Promise((resolve, reject) => {
      const deadline = started + 5_000;

      /**
       * Reads the preview on the next animation frame.
       *
       * Purpose: accept the title after React commits it, including a commit that lands after the event returns.
       * Inputs: none.
       * Side effects: may resolve on a later task or schedule another frame.
       */
      function onFrame(): void {
        const matched = preview.textContent === title;
        const commitStamp = commitAt ?? (matched ? performance.now() : null);
        if (matched && commitStamp !== null) {
          // This callback runs before paint. The zero-delay task runs after that paint.
          setTimeout(() => {
            resolve({
              commitMs: commitStamp - started,
              paintMs: performance.now() - started,
            });
          }, 0);
          return;
        }
        if (performance.now() > deadline) {
          reject(
            new Error(
              `Preview title stayed ${JSON.stringify(preview.textContent)} while waiting for ${JSON.stringify(title)}.`,
            ),
          );
          return;
        }
        requestAnimationFrame(onFrame);
      }

      // The first frame is the earliest the browser can paint this input event's update.
      requestAnimationFrame(onFrame);
    });
  }

  const input = document.getElementById(`text-title-${args.sectionId}`);
  const preview = document.querySelector(`[data-section-id="${args.sectionId}"] .preview-text-title`);
  if (!(input instanceof HTMLInputElement) || !(preview instanceof HTMLElement)) {
    throw new Error("The title field or the phone title is not in the document.");
  }
  if (preview.textContent !== args.initialTitle) {
    throw new Error(`The phone title started as ${JSON.stringify(preview.textContent)}.`);
  }
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor === undefined || descriptor.set === undefined) {
    throw new Error("HTMLInputElement value setter is missing.");
  }
  const setValue = descriptor.set;
  const paintMs: number[] = [];
  const commitMs: number[] = [];
  for (const title of args.titles) {
    const withTracker = input as HTMLInputElement & { _valueTracker?: { setValue?: (value: string) => void } };
    // React skips an input event when its tracker already equals the DOM value.
    if (typeof withTracker._valueTracker?.setValue === "function") {
      withTracker._valueTracker.setValue(input.value);
    }
    // The value is assigned before the clock. The sample starts at the input event.
    setValue.call(input, title);
    const started = performance.now();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    if (input.value !== title) {
      throw new Error(`The title field reverted to ${JSON.stringify(input.value)}.`);
    }
    const commitAt = preview.textContent === title ? performance.now() : null;
    const timing = await waitForPaintedTitle(preview, title, started, commitAt);
    paintMs.push(timing.paintMs);
    commitMs.push(timing.commitMs);
  }
  return {
    paintMs,
    commitMs,
    previewTitle: preview.textContent,
    inputValue: input.value,
  };
}

/**
 * Returns the nearest-rank 95th percentile.
 *
 * Purpose: the reported p95 is one of the observed samples, at rank ceil(0.95 * n).
 * Inputs: samples, the paint durations in milliseconds, in edit order.
 * Side effects: none.
 */
function nearestRankP95(samples: readonly number[]): { p95: number; rank: number; sorted: number[] } {
  // A copy keeps the recorded edit order. The rank is taken from the sorted copy.
  const sorted = [...samples].sort((left, right) => left - right);
  // For 50 samples, ceil(0.95 * 50) is 48. The index is one less because arrays are zero-based.
  const rank = Math.ceil(0.95 * sorted.length);
  const p95 = sorted[rank - 1];
  if (p95 === undefined) {
    throw new Error("p95 needs at least one sample.");
  }
  return { p95, rank, sorted };
}

/**
 * Describes the machine running this process.
 *
 * Purpose: the write-up names the hardware that produced the samples.
 * Inputs: none. The values come from the Node os module.
 * Side effects: none.
 */
function machineDescription(): {
  summary: string;
  cpuModel: string;
  logicalProcessors: number;
  cpuSpeedMHz: number;
  memoryBytes: number;
  platform: string;
  release: string;
  arch: string;
} {
  const cpus = os.cpus();
  const first = cpus[0];
  // An empty cpu list is still reported. The benchmark does not invent a model name.
  const cpuModel = first === undefined ? "unknown CPU" : first.model.trim();
  const cpuSpeedMHz = first === undefined ? 0 : first.speed;
  const memoryBytes = os.totalmem();
  const platform = os.type();
  const release = os.release();
  const arch = os.arch();
  return {
    summary: `${platform} ${release} ${arch}, ${cpuModel}, ${cpus.length} logical processors, ${cpuSpeedMHz} MHz, ${memoryBytes} bytes RAM`,
    cpuModel,
    logicalProcessors: cpus.length,
    cpuSpeedMHz,
    memoryBytes,
    platform,
    release,
    arch,
  };
}

/**
 * Returns the local calendar date of this run.
 *
 * Purpose: the write-up dates the measurement in the machine's local timezone.
 * Inputs: none.
 * Side effects: none.
 */
function localMeasurementDate(): string {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  // The date is local. The offset is stored separately on the result.
  return `${year}-${month}-${day}`;
}

/**
 * Reads the browser's user agent.
 *
 * Purpose: the write-up names the browser that painted the preview, including HeadlessChrome when that is the runtime.
 * Inputs: none. This function runs in the browser.
 * Side effects: none.
 */
function readUserAgent(): string {
  // The page agent is the browser Playwright launched, not a label chosen in the test.
  return navigator.userAgent;
}

/**
 * Reads the built contracts module.
 *
 * Purpose: the fixture is checked with the same schema and byte cap the editor uses.
 * Inputs: none.
 * Side effects: imports packages/contracts/dist.
 */
async function loadContracts(): Promise<{
  configurationSchema: { safeParse: (value: unknown) => { success: boolean; error?: { message: string } } };
  isPayloadWithinLimit: (payload: string) => boolean;
  LIMITS: { maxPayloadBytes: number };
}> {
  // The launcher builds this file before Playwright opens the page.
  const imported = await import("../packages/contracts/dist/index.js");
  return imported;
}

/**
 * Checks the fixture document and returns its JSON byte length.
 *
 * Purpose: the timed page is the 30-section document, and that document is inside the shared limits.
 * Inputs: none. The fixture module supplies the configuration.
 * Side effects: imports the contracts build. Throws when the schema or the byte cap fails.
 */
async function assertFixtureIsLegal(): Promise<number> {
  const contracts = await loadContracts();
  const configuration = previewBenchmarkConfiguration();
  const payload = JSON.stringify(configuration);
  const bytes = Buffer.byteLength(payload);
  if (!contracts.isPayloadWithinLimit(payload)) {
    throw new Error(`Benchmark fixture is ${bytes} bytes, over the payload cap.`);
  }
  const parsed = contracts.configurationSchema.safeParse(configuration);
  if (!parsed.success) {
    throw new Error(parsed.error?.message ?? "Benchmark fixture failed configurationSchema.");
  }
  return bytes;
}

/**
 * Writes the measurement JSON.
 *
 * Purpose: the numbers in the Playwright log and the result file are the same object.
 * Inputs: result, the measurement record.
 * Side effects: writes test-results/preview-benchmark.json and logs one JSON line.
 */
function writeBenchmarkResult(result: unknown): void {
  const directory = path.join(REPO_ROOT, "test-results");
  // The directory is gitignored. The committed write-up is composed from this object.
  mkdirSync(directory, { recursive: true });
  const json = JSON.stringify(result);
  writeFileSync(path.join(directory, "preview-benchmark.json"), JSON.stringify(result, null, 2));
  console.log(`PREVIEW_BENCHMARK_JSON ${json}`);
}

/**
 * Measures fifty preview updates on the production editor.
 *
 * Purpose: record the p95 for the R08 fixture without retrying the sample set.
 * Inputs: page, the Playwright page. The server is the production build.
 * Side effects: drives the browser and writes test-results/preview-benchmark.json.
 */
async function measureProductionPreview({ page }: { page: Page }): Promise<void> {
  const payloadBytes = await assertFixtureIsLegal();
  const titles = benchmarkEditTitles();
  const imageCounter = { count: 0 };

  /**
   * Stubs one request on the fixture image host.
   *
   * Purpose: page.route needs a function closed over this test's counter.
   * Inputs: route, the browser request under the benchmark image prefix.
   * Side effects: fulfills an image with the local PNG or aborts a non-image request.
   */
  function stubRoutedImage(route: Route): Promise<void> {
    // The counter and the PNG live in this test. The route stays installed through the 50 edits.
    return fulfillBenchmarkImage(route, imageCounter);
  }

  // Install the image stub before navigation so the first paint does not wait on a remote host.
  await page.route(`${BENCHMARK_IMAGE_URL_PREFIX}**`, stubRoutedImage);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
  const titleInput = page.locator(`#text-title-${BENCHMARK_TEXT_SECTION_ID}`);
  const previewTitle = page.locator(`[data-section-id="${BENCHMARK_TEXT_SECTION_ID}"] .preview-text-title`);
  await expect(titleInput).toHaveValue(BENCHMARK_INITIAL_TITLE);
  await expect(previewTitle).toHaveText(BENCHMARK_INITIAL_TITLE);
  await expect(page.locator("[data-section-id]")).toHaveCount(BENCHMARK_SECTION_COUNT);
  await expect(page.locator("[data-carousel-scroller]")).toHaveCount(BENCHMARK_CAROUSEL_COUNT);
  await expect(page.locator("[data-carousel-slide]")).toHaveCount(BENCHMARK_CAROUSEL_COUNT * BENCHMARK_IMAGES_PER_CAROUSEL);
  await expect(page.locator("[data-carousel-ready='true']")).toHaveCount(BENCHMARK_CAROUSEL_COUNT);

  /**
   * Polls the eager-slide check for this page.
   *
   * Purpose: expect.poll needs a function closed over the editor page.
   * Inputs: none.
   * Side effects: none.
   */
  async function eagerSlidesAreDecoded(): Promise<boolean> {
    // The ten first slides are ready when each one has decoded the stubbed PNG.
    return eagerSlidesDecoded(page);
  }

  await expect.poll(eagerSlidesAreDecoded, { timeout: 15_000 }).toBe(true);
  // The ten eager slides were served from the local PNG. A zero count would mean those images were not stubbed.
  expect(imageCounter.count).toBeGreaterThanOrEqual(BENCHMARK_CAROUSEL_COUNT);
  const viteClient = await page.locator('script[src*="@vite/client"]').count();
  // The production document has no Vite client. A dev server would include that script.
  expect(viteClient).toBe(0);
  await previewTitle.scrollIntoViewIfNeeded();
  await page.evaluate(waitForOneFrame);
  const box = await previewTitle.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) {
    throw new Error("The preview title has no box in the viewport.");
  }
  // The timed title has to sit in the viewport so the paint is a visible one.
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  const measured = await page.evaluate(measureTitleEdits, {
    sectionId: BENCHMARK_TEXT_SECTION_ID,
    initialTitle: BENCHMARK_INITIAL_TITLE,
    titles,
  });
  expect(measured.paintMs).toHaveLength(BENCHMARK_SAMPLE_COUNT);
  expect(measured.commitMs).toHaveLength(BENCHMARK_SAMPLE_COUNT);
  expect(measured.previewTitle).toBe("Edit 50");
  expect(measured.inputValue).toBe("Edit 50");
  for (let index = 0; index < measured.paintMs.length; index += 1) {
    const paint = measured.paintMs[index];
    const commit = measured.commitMs[index];
    if (paint === undefined || commit === undefined) {
      throw new Error(`Missing sample ${index}.`);
    }
    // Every edit produced a finite paint time at least as large as its commit time.
    expect(Number.isFinite(paint)).toBe(true);
    expect(Number.isFinite(commit)).toBe(true);
    expect(paint).toBeGreaterThan(0);
    expect(paint).toBeGreaterThanOrEqual(commit);
  }
  const ranked = nearestRankP95(measured.paintMs);
  const commitRanked = nearestRankP95(measured.commitMs);
  const machine = machineDescription();
  const browserVersion = page.context().browser()?.version() ?? "unknown";
  const userAgent = await page.evaluate(readUserAgent);
  const result = {
    date: localMeasurementDate(),
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    machine,
    browserVersion,
    userAgent,
    headless: userAgent.includes("Headless"),
    build: "production",
    command: "react-router build, then react-router-serve apps/editor/build/server/index.js",
    viteClientScripts: viteClient,
    payloadBytes,
    imageFulfills: imageCounter.count,
    imageStrategy: `Playwright fulfilled ${BENCHMARK_IMAGE_URL_PREFIX} image requests with a 1x1 PNG`,
    sectionCount: BENCHMARK_SECTION_COUNT,
    carouselCount: BENCHMARK_CAROUSEL_COUNT,
    imagesPerCarousel: BENCHMARK_IMAGES_PER_CAROUSEL,
    sampleCount: measured.paintMs.length,
    paintMs: measured.paintMs,
    commitMs: measured.commitMs,
    sortedPaintMs: ranked.sorted,
    p95Rank: ranked.rank,
    p95: ranked.p95,
    commitP95: commitRanked.p95,
    minPaintMs: ranked.sorted[0],
    maxPaintMs: ranked.sorted[ranked.sorted.length - 1],
    method: PAINT_METHOD,
    percentile:
      "Nearest rank. Sort the 50 paint samples ascending and take the sample at rank ceil(0.95 * 50), which is the 48th. That sample is an observed edit, not an interpolation.",
    metR08Under100: ranked.p95 < 100,
    metArchitecture50: ranked.p95 <= 50,
    viewport,
  };
  // One object is the log line and the result file. This test does not run the loop again.
  writeBenchmarkResult(result);
  console.log(`PREVIEW_BENCHMARK_P95 ${ranked.p95}`);
}

test("measures 50 preview title updates on the production 30-section fixture", measureProductionPreview);
