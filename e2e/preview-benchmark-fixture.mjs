/** Local 30-section document for the preview benchmark. It is not the demo seed and not a service credential. */

/** Loopback port for the production editor started by this benchmark. */
export const BENCHMARK_EDITOR_PORT = 4191;

/** Loopback port for the fixture configuration server. */
export const BENCHMARK_FIXTURE_PORT = 4192;

/** Configuration id the editor loader requests. */
export const BENCHMARK_CONFIGURATION_ID = "cfg_preview_benchmark";

/** Tenant id the editor process expects. The fixture server does not read it. */
export const BENCHMARK_TENANT_ID = "ten_preview_benchmark";

/**
 * Bearer token the editor sends to this fixture only.
 *
 * It is a test double. It is not the configuration service credential.
 */
export const BENCHMARK_SERVICE_TOKEN = "preview-benchmark-fixture-token";

/** Text section whose title field is edited during the 50 samples. */
export const BENCHMARK_TEXT_SECTION_ID = "bench-text-0";

/** Title on that section before the first edit. */
export const BENCHMARK_INITIAL_TITLE = "Bench title";

/** Sections in the fixture, including the ten carousels. */
export const BENCHMARK_SECTION_COUNT = 30;

/** Carousels in the fixture. */
export const BENCHMARK_CAROUSEL_COUNT = 10;

/** Images on each of those carousels. */
export const BENCHMARK_IMAGES_PER_CAROUSEL = 10;

/** Title edits timed by the benchmark. */
export const BENCHMARK_SAMPLE_COUNT = 50;

/** Prefix for every fixture image URL. The benchmark fulfills this host locally. */
export const BENCHMARK_IMAGE_URL_PREFIX = "https://example.com/preview-benchmark/";

/**
 * Builds one text section.
 *
 * Purpose: the first row is the title field the benchmark edits. The other nine keep the section count.
 * Inputs: index, zero-based position among the text sections.
 * Side effects: none.
 */
function textSection(index) {
  // The edited row uses a stable id and a title that is not one of the Edit N strings.
  const title = index === 0 ? BENCHMARK_INITIAL_TITLE : `Bench text ${index}`;
  return {
    id: `bench-text-${index}`,
    type: "text",
    title,
    description: "Bench copy",
    titleColor: "#112233",
    descriptionColor: "#445566",
  };
}

/**
 * Builds one carousel slide.
 *
 * Purpose: each slide has its own URL under the stubbed prefix so the browser does not open a network image.
 * Inputs: carouselIndex, the carousel. imageIndex, the slide inside that carousel.
 * Side effects: none.
 */
function carouselImage(carouselIndex, imageIndex) {
  // Ids are unique inside this carousel. The URL stays on the stubbed host.
  return {
    id: `bench-c${carouselIndex}-i${imageIndex}`,
    url: `${BENCHMARK_IMAGE_URL_PREFIX}c${carouselIndex}/i${imageIndex}.png`,
    alt: `Bench slide ${carouselIndex} ${imageIndex}`,
  };
}

/**
 * Builds one carousel with ten slides.
 *
 * Purpose: R08 asks for ten carousels of ten images, which is 100 images and inside the document cap.
 * Inputs: index, zero-based carousel position.
 * Side effects: none.
 */
function carouselSection(index) {
  const images = [];
  for (let imageIndex = 0; imageIndex < BENCHMARK_IMAGES_PER_CAROUSEL; imageIndex += 1) {
    // Slide order is the array order. There is no position field.
    images.push(carouselImage(index, imageIndex));
  }
  return {
    id: `bench-carousel-${index}`,
    type: "carousel",
    aspectRatio: "landscape",
    images,
  };
}

/**
 * Builds one button section.
 *
 * Purpose: ten buttons bring the document to 30 sections without adding images.
 * Inputs: index, zero-based button position.
 * Side effects: none.
 */
function ctaSection(index) {
  // The link uses the same host as the images. The benchmark does not navigate to it.
  return {
    id: `bench-cta-${index}`,
    type: "cta",
    label: `Bench button ${index}`,
    url: `${BENCHMARK_IMAGE_URL_PREFIX}button`,
    backgroundColor: "#102030",
    labelColor: "#ffffff",
  };
}

/**
 * Checks the fixture shape the benchmark claims to load.
 *
 * Purpose: a short document cannot satisfy R08, and a 31st section would be a different fixture.
 * Inputs: configuration, the object the fixture server will return.
 * Side effects: none. Throws when the counts, the edited title, or an image URL is wrong.
 */
function assertBenchmarkShape(configuration) {
  const sections = configuration.data.sections;
  // Thirty rows: ten text, ten carousels, ten buttons.
  if (sections.length !== BENCHMARK_SECTION_COUNT) {
    throw new Error(`Expected ${BENCHMARK_SECTION_COUNT} sections, found ${sections.length}.`);
  }
  let carousels = 0;
  let images = 0;
  let texts = 0;
  let buttons = 0;
  for (const section of sections) {
    if (section.type === "carousel") {
      carousels += 1;
      // Each carousel is ten slides, not a shorter list that would lighten the preview.
      if (section.images.length !== BENCHMARK_IMAGES_PER_CAROUSEL) {
        throw new Error(`Carousel ${section.id} has ${section.images.length} images.`);
      }
      images += section.images.length;
      for (const image of section.images) {
        // Every slide URL has to be one the Playwright route can stub.
        if (!image.url.startsWith(BENCHMARK_IMAGE_URL_PREFIX)) {
          throw new Error(`Image ${image.id} is outside the stubbed prefix.`);
        }
      }
    } else if (section.type === "text") {
      texts += 1;
    } else if (section.type === "cta") {
      buttons += 1;
    }
  }
  if (carousels !== BENCHMARK_CAROUSEL_COUNT || images !== 100 || texts !== 10 || buttons !== 10) {
    throw new Error(`Unexpected fixture mix: ${texts} text, ${carousels} carousels, ${images} images, ${buttons} buttons.`);
  }
  const first = sections[0];
  // The loader selects the first section, so the title field is on screen without an extra click.
  if (first.id !== BENCHMARK_TEXT_SECTION_ID || first.type !== "text" || first.title !== BENCHMARK_INITIAL_TITLE) {
    throw new Error("The first section is not the benchmark title field.");
  }
}

/**
 * Builds the configuration the fixture server returns.
 *
 * Purpose: give the production editor a legal 30-section document before the timed edits start.
 * Inputs: none.
 * Side effects: none. Throws when the shape check fails.
 */
export function previewBenchmarkConfiguration() {
  const sections = [];
  for (let index = 0; index < 10; index += 1) {
    // Text first, so bench-text-0 is the selected title field after hydrate.
    sections.push(textSection(index));
  }
  for (let index = 0; index < BENCHMARK_CAROUSEL_COUNT; index += 1) {
    // Ten carousels follow the text blocks. Each one carries ten images.
    sections.push(carouselSection(index));
  }
  for (let index = 0; index < 10; index += 1) {
    // Buttons make the section count 30 without adding another image.
    sections.push(ctaSection(index));
  }
  const configuration = {
    schemaVersion: 1,
    id: BENCHMARK_CONFIGURATION_ID,
    revision: 1,
    updatedAt: "2026-10-13T22:00:00.000Z",
    data: { sections },
  };
  // Reject a fixture that drifted away from the 30-section, 100-image shape.
  assertBenchmarkShape(configuration);
  return configuration;
}

/**
 * Builds the title used for one timed edit.
 *
 * Purpose: each sample replaces the field with a distinct string the phone can show.
 * Inputs: index, a 1-based edit number from 1 through 50.
 * Side effects: none.
 */
export function benchmarkEditTitle(index) {
  // The visible title is Edit 1 through Edit 50. The number is part of the string.
  return `Edit ${index}`;
}

/**
 * Builds the fifty titles in sample order.
 *
 * Purpose: the browser loop and the assertion share one list.
 * Inputs: none.
 * Side effects: none. Throws when a title repeats the initial title or another edit.
 */
export function benchmarkEditTitles() {
  const titles = [];
  const seen = new Set();
  for (let index = 1; index <= BENCHMARK_SAMPLE_COUNT; index += 1) {
    const title = benchmarkEditTitle(index);
    // A repeated string would let the preview match before the edit was painted.
    if (title === BENCHMARK_INITIAL_TITLE || seen.has(title)) {
      throw new Error(`Benchmark title ${title} is not a distinct edit.`);
    }
    seen.add(title);
    titles.push(title);
  }
  return titles;
}
