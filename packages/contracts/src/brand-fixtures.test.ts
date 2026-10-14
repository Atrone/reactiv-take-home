import { describe, expect, it } from "vitest";
import { createHarborDocument, createMarketDocument, editableDocumentSchema } from "./index.js";
import type { EditableDocument, Section } from "./index.js";

/**
 * Returns the one section of a type.
 *
 * Purpose: harbor and market each have one text block, one carousel, and one button.
 * Inputs: document, a brand fixture. type, the section discriminator.
 * Side effects: none. Throws when that type is missing or repeated.
 */
function onlySection<T extends Section["type"]>(
  document: EditableDocument,
  type: T,
): Extract<Section, { type: T }> {
  // One pass keeps the screen order and counts how many blocks share this type.
  const matches = document.data.sections.filter((section) => section.type === type);
  if (matches.length !== 1) {
    throw new Error(`Expected one ${type} section.`);
  }
  const section = matches[0];
  if (section === undefined || section.type !== type) {
    throw new Error(`Expected one ${type} section.`);
  }
  // The type parameter is the discriminator this filter already required.
  return section as Extract<Section, { type: T }>;
}

/**
 * Collects section ids in screen order.
 *
 * Purpose: the two fixtures must not reuse an id.
 * Inputs: document, a brand fixture.
 * Side effects: none.
 */
function sectionIds(document: EditableDocument): string[] {
  // Array order is the screen order. There is no position field to read.
  return document.data.sections.map((section) => section.id);
}

/**
 * Collects carousel image URLs in slide order.
 *
 * Purpose: imagery is part of the document, and the two fixtures use different addresses.
 * Inputs: document, a brand fixture.
 * Side effects: none. Throws when the carousel is missing.
 */
function imageUrls(document: EditableDocument): string[] {
  const carousel = onlySection(document, "carousel");
  // Slide order follows the images array. A later renderer does not invent a URL.
  return carousel.images.map((image) => image.url);
}

/**
 * Proves both brand documents parse and keep different ids, colors, copy, images, and order.
 *
 * Purpose: the shared schema accepts two merchant screens without a second document type.
 * Inputs: none.
 * Side effects: none.
 */
function harborAndMarketStayDistinctValidDocuments(): void {
  const harbor = createHarborDocument();
  const market = createMarketDocument();
  // Parsing again locks the schema output, including lowercase colors.
  expect(editableDocumentSchema.parse(harbor)).toEqual(harbor);
  expect(editableDocumentSchema.parse(market)).toEqual(market);
  expect(editableDocumentSchema.parse(JSON.parse(JSON.stringify(harbor)))).toEqual(harbor);
  expect(editableDocumentSchema.parse(JSON.parse(JSON.stringify(market)))).toEqual(market);
  expect(harbor.schemaVersion).toBe(1);
  expect(market.schemaVersion).toBe(1);
  expect(harbor).not.toHaveProperty("id");
  expect(market).not.toHaveProperty("revision");
  expect(JSON.stringify(harbor)).not.toContain('"position"');
  expect(JSON.stringify(market)).not.toContain('"position"');

  const harborIds = sectionIds(harbor);
  const marketIds = sectionIds(market);
  // Six ids, and none of them is shared. Image ids are separate from these section ids.
  expect(harborIds).toEqual(["harbor-title", "harbor-slides", "harbor-button"]);
  expect(marketIds).toEqual(["market-button", "market-stalls", "market-sign"]);
  expect(new Set([...harborIds, ...marketIds]).size).toBe(harborIds.length + marketIds.length);
  expect(harbor.data.sections.map((section) => section.type)).toEqual(["text", "carousel", "cta"]);
  expect(market.data.sections.map((section) => section.type)).toEqual(["cta", "carousel", "text"]);
  expect(market.data.sections.map((section) => section.type)).not.toEqual(
    harbor.data.sections.map((section) => section.type),
  );

  const harborText = onlySection(harbor, "text");
  const marketText = onlySection(market, "text");
  // The titles are the configured copy. They are not the demo titles.
  expect(harborText.title).toBe("Harbor");
  expect(marketText.title).toBe("Saturday market");
  expect(harborText.title).not.toBe(marketText.title);
  expect(harborText.titleColor).toBe("#14324c");
  expect(harborText.descriptionColor).toBe("#4d6578");
  expect(marketText.titleColor).toBe("#6e3014");
  expect(marketText.descriptionColor).toBe("#a56a45");

  const harborButton = onlySection(harbor, "cta");
  const marketButton = onlySection(market, "cta");
  // Harbor is the deep-blue button. Market is the warm button. Neither color is rewritten here.
  expect(harborButton.backgroundColor).toBe("#102030");
  expect(harborButton.labelColor).toBe("#ffffff");
  expect(harborButton.label).toBe("See the pier");
  expect(marketButton.backgroundColor).toBe("#8c3a12");
  expect(marketButton.labelColor).toBe("#fff4e8");
  expect(marketButton.label).toBe("Browse the stalls");

  const harborSlides = onlySection(harbor, "carousel");
  const marketSlides = onlySection(market, "carousel");
  // One carousel each. Landscape and square are stored names, not a second component.
  expect(harborSlides.aspectRatio).toBe("landscape");
  expect(marketSlides.aspectRatio).toBe("square");
  const harborUrls = imageUrls(harbor);
  const marketUrls = imageUrls(market);
  expect(harborUrls).toEqual(["https://example.com/harbor/pier.jpg", "https://example.com/harbor/boats.jpg"]);
  expect(marketUrls).toEqual(["https://example.com/market/stall.jpg", "https://example.com/market/crates.jpg"]);
  expect(harborUrls.every((url) => url.startsWith("https://example.com/"))).toBe(true);
  expect(marketUrls.every((url) => url.startsWith("https://example.com/"))).toBe(true);
  expect(marketUrls).not.toEqual(harborUrls);

  // A second call parses a new object with the same content.
  expect(createHarborDocument()).toEqual(harbor);
  expect(createHarborDocument()).not.toBe(harbor);
  expect(createMarketDocument()).toEqual(market);
}

/**
 * Registers the brand-fixture contract tests.
 *
 * Purpose: harbor and market are evidence that two documents share one schema.
 * Inputs: none.
 * Side effects: registers one Vitest case.
 */
function registerBrandFixtureTests(): void {
  it("parses harbor and market as different valid screens", harborAndMarketStayDistinctValidDocuments);
}

describe("brand fixtures", registerBrandFixtureTests);
