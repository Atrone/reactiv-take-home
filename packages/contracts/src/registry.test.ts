import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIO_DISPLAY,
  ASPECT_RATIOS,
  assertNever,
  createDemoDocument,
  createSection,
  createStableId,
  editableDocumentSchema,
  getSectionRegistryEntry,
  sectionRegistry,
  sectionSchema,
  type EditableDocument,
  type Section,
} from "./index.js";

/**
 * True when the registry keys and the section union are the same set.
 *
 * A fourth section type or a fourth registry key makes this false.
 */
type SectionTypesMatchRegistry = [keyof typeof sectionRegistry] extends [Section["type"]]
  ? [Section["type"]] extends [keyof typeof sectionRegistry]
    ? true
    : false
  : false;

/**
 * True when the string "quiz" is a registry key.
 *
 * The schema does not include quiz. This stays false unless a quiz key is added.
 */
type QuizIsRegistered = "quiz" extends keyof typeof sectionRegistry ? true : false;

/**
 * Counts calls and returns prefix-1, prefix-2, and so on.
 *
 * Purpose: tests can prove a create path calls the generator once per id.
 * Inputs: prefix, the id prefix.
 * Side effects: none until the returned function is called.
 */
function callCountGenerator(prefix: string): { generateId: () => string; calls: () => number } {
  let count = 0;
  /**
   * Issues the next counted id.
   *
   * Purpose: one call increments the counter by one.
   * Inputs: none.
   * Side effects: increments the closed-over counter.
   */
  const generateId = (): string => {
    // The suffix is the call count. It is not a section array index.
    count += 1;
    return `${prefix}-${count}`;
  };
  /**
   * Reads how many ids have been issued.
   *
   * Purpose: assertions can see the count without issuing another id.
   * Inputs: none.
   * Side effects: none.
   */
  const calls = (): number => count;
  return { generateId, calls };
}

/**
 * Returns the next string from a fixed list.
 *
 * Purpose: drive createDemoDocument with a chosen id sequence.
 * Inputs: values, the ids in call order.
 * Side effects: none until the returned function is called.
 */
function queueGenerator(values: readonly string[]): () => string {
  let index = 0;
  /**
   * Issues the next queued id.
   *
   * Purpose: one call consumes one list entry.
   * Inputs: none.
   * Side effects: advances the closed-over index.
   */
  const generateId = (): string => {
    const next = values.at(index);
    // The list position is the call count. It is not written into the document as an index id.
    index += 1;
    if (next === undefined) {
      throw new Error("The test generator ran out of ids.");
    }
    return next;
  };
  return generateId;
}

/**
 * Returns the section at one index.
 *
 * Purpose: fail the test when the demo document is shorter than expected.
 * Inputs: document, the parsed demo. index, the screen position.
 * Side effects: none. Throws when the index is missing.
 */
function sectionAt(document: EditableDocument, index: number): Section {
  const section = document.data.sections.at(index);
  // A short document is a failed fixture, not an empty optional.
  if (section === undefined) {
    throw new Error(`Expected a section at index ${index}.`);
  }
  return section;
}

/**
 * Checks that the two sections of each type differ, and that each carousel has two slides.
 *
 * Purpose: the fixture is more than one of each type, with its own copy, colors, and image URLs.
 * Inputs: document, the parsed demo.
 * Side effects: none. Throws when a section has the wrong discriminator.
 */
function assertDistinctDemoContent(document: EditableDocument): void {
  const sections = document.data.sections;
  // Six blocks, in the screen array. Order is checked by the caller.
  expect(sections).toHaveLength(6);
  const sectionIds = sections.map((section) => section.id);
  expect(new Set(sectionIds).size).toBe(sectionIds.length);
  const firstCarousel = sectionAt(document, 0);
  const secondCarousel = sectionAt(document, 3);
  // Both carousels carry slides. Text and CTA blocks do not.
  if (firstCarousel.type !== "carousel" || secondCarousel.type !== "carousel") {
    throw new Error("Expected carousels in the first and fourth positions.");
  }
  expect(firstCarousel.images).toHaveLength(2);
  expect(secondCarousel.images).toHaveLength(2);
  expect(firstCarousel.images[0]?.alt).not.toBe(firstCarousel.images[1]?.alt);
  expect(secondCarousel.images[0]?.alt).not.toBe(secondCarousel.images[1]?.alt);
  const urls = [...firstCarousel.images, ...secondCarousel.images].map((image) => image.url);
  expect(new Set(urls).size).toBe(urls.length);
  for (const url of urls) {
    // Fixture images stay on https://example.com paths.
    expect(url.startsWith("https://example.com/")).toBe(true);
  }
  const alts = [...firstCarousel.images, ...secondCarousel.images].map((image) => image.alt);
  // Alt text differs inside a carousel and across the two carousels.
  expect(new Set(alts).size).toBe(alts.length);
  expect(new Set(firstCarousel.images.map((image) => image.id)).size).toBe(firstCarousel.images.length);
  expect(new Set(secondCarousel.images.map((image) => image.id)).size).toBe(secondCarousel.images.length);
  expect(firstCarousel.aspectRatio).not.toBe(secondCarousel.aspectRatio);
  const firstText = sectionAt(document, 1);
  const secondText = sectionAt(document, 4);
  if (firstText.type !== "text" || secondText.type !== "text") {
    throw new Error("Expected text sections in the second and fifth positions.");
  }
  expect(firstText.title).not.toBe(secondText.title);
  expect(firstText.description).not.toBe(secondText.description);
  expect(firstText.titleColor).not.toBe(secondText.titleColor);
  expect(firstText.descriptionColor).not.toBe(secondText.descriptionColor);
  const firstCta = sectionAt(document, 2);
  const secondCta = sectionAt(document, 5);
  if (firstCta.type !== "cta" || secondCta.type !== "cta") {
    throw new Error("Expected CTAs in the third and sixth positions.");
  }
  expect(firstCta.label).not.toBe(secondCta.label);
  expect(firstCta.url).not.toBe(secondCta.url);
  expect(firstCta.backgroundColor).not.toBe(secondCta.backgroundColor);
  expect(firstCta.labelColor).not.toBe(secondCta.labelColor);
}

/**
 * The demo document with the ids from callCountGenerator("demo").
 *
 * Purpose: lock the fixture copy the later seed will store.
 * Inputs: none.
 * Side effects: none.
 */
function expectedDemoDocument(): EditableDocument {
  return {
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "demo-1",
          type: "carousel",
          aspectRatio: "landscape",
          images: [
            {
              id: "demo-2",
              url: "https://example.com/demo/arrival-window.jpg",
              alt: "Shop window with a new arrival display",
            },
            {
              id: "demo-3",
              url: "https://example.com/demo/reading-table.jpg",
              alt: "Front table stacked with featured books",
            },
          ],
        },
        {
          id: "demo-4",
          type: "text",
          title: "New this week",
          description: "A short list from the front table.",
          titleColor: "#112233",
          descriptionColor: "#334455",
        },
        {
          id: "demo-5",
          type: "cta",
          label: "Continue",
          url: "https://example.com/continue",
          backgroundColor: "#243044",
          labelColor: "#ffffff",
        },
        {
          id: "demo-6",
          type: "carousel",
          aspectRatio: "portrait",
          images: [
            {
              id: "demo-7",
              url: "https://example.com/demo/staff-stack.jpg",
              alt: "Staff picks stacked on a wooden counter",
            },
            {
              id: "demo-8",
              url: "https://example.com/demo/quiet-corner.jpg",
              alt: "Chair in a quiet corner of the shop",
            },
          ],
        },
        {
          id: "demo-9",
          type: "text",
          title: "From the floor",
          description: "Notes from the people who unpack the boxes.",
          titleColor: "#3d2b1f",
          descriptionColor: "#5c6b73",
        },
        {
          id: "demo-10",
          type: "cta",
          label: "See the list",
          url: "https://example.com/list",
          backgroundColor: "#1f4d3a",
          labelColor: "#f7f3ea",
        },
      ],
    },
  };
}

/**
 * Proves the demo document parses and keeps the screen order.
 *
 * Purpose: two carousels, two text sections, and two CTAs, in that order, with distinct content.
 * Inputs: none.
 * Side effects: none.
 */
function demoDocumentParsesInScreenOrder(): void {
  const source = callCountGenerator("demo");
  const document = createDemoDocument(source.generateId);
  // The factory already parsed. Parsing again locks the schema output.
  const parsed = editableDocumentSchema.parse(document);
  expect(parsed).toEqual(document);
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed).not.toHaveProperty("id");
  expect(parsed).not.toHaveProperty("revision");
  expect(parsed).not.toHaveProperty("updatedAt");
  expect(parsed).not.toHaveProperty("tenantId");
  expect(parsed.data.sections.map((section) => section.type)).toEqual([
    "carousel",
    "text",
    "cta",
    "carousel",
    "text",
    "cta",
  ]);
  assertDistinctDemoContent(parsed);
  expect(parsed).toEqual(expectedDemoDocument());
  // The same document still parses after a JSON round trip.
  const serialized: unknown = JSON.parse(JSON.stringify(parsed));
  expect(editableDocumentSchema.parse(serialized)).toEqual(parsed);
  // Ten ids: six sections and four slides. Reading the document does not issue an eleventh.
  expect(source.calls()).toBe(10);
  JSON.stringify(parsed);
  for (const section of parsed.data.sections) {
    expect(section.id.length).toBeGreaterThan(0);
  }
  expect(source.calls()).toBe(10);
}

/**
 * Proves two carousels receive different ids from one generator.
 *
 * Purpose: the id is assigned when the section is created.
 * Inputs: none.
 * Side effects: none.
 */
function createdCarouselsDoNotShareAnId(): void {
  const source = callCountGenerator("carousel");
  const first = createSection("carousel", source.generateId);
  const second = createSection("carousel", source.generateId);
  // Different generator results stay on different sections.
  expect(first.id).not.toBe(second.id);
  expect(first.id).toBe("carousel-1");
  expect(second.id).toBe("carousel-2");
  expect(source.calls()).toBe(2);
  if (first.type !== "carousel" || second.type !== "carousel") {
    throw new Error("Expected two carousels.");
  }
  // Each default carousel has its own empty image list.
  expect(first.images).not.toBe(second.images);
  expect(first.images).toEqual([]);
  expect(second.images).toEqual([]);
  expect(first.aspectRatio).toBe("landscape");
  expect(second.aspectRatio).toBe("landscape");
}

/**
 * Proves reading a section does not call the generator again.
 *
 * Purpose: the id is stored on the object at creation. There is no render step in this module.
 * Inputs: none.
 * Side effects: none.
 */
function readingASectionDoesNotCallTheGenerator(): void {
  const source = callCountGenerator("read");
  const section = createSection("carousel", source.generateId);
  // Creation spends one id.
  expect(source.calls()).toBe(1);
  expect(section.id).toBe("read-1");
  if (section.type !== "carousel") {
    throw new Error("Expected a carousel.");
  }
  // Property reads and serialization use the stored object.
  expect(section.images).toEqual([]);
  expect(section.aspectRatio).toBe("landscape");
  JSON.stringify(section);
  expect(section.id).toBe("read-1");
  expect(source.calls()).toBe(1);
}

/**
 * Proves each default section matches the schema and the documented field values.
 *
 * Purpose: carousel, text, and CTA defaults are valid schema version 1 sections.
 * Inputs: none.
 * Side effects: none.
 */
function eachDefaultSectionParses(): void {
  expect(sectionSchema.parse(sectionRegistry.carousel.create("carousel-default"))).toEqual({
    id: "carousel-default",
    type: "carousel",
    images: [],
    aspectRatio: "landscape",
  });
  expect(sectionSchema.parse(sectionRegistry.text.create("text-default"))).toEqual({
    id: "text-default",
    type: "text",
    title: "Title",
    description: "",
    titleColor: "#112233",
    descriptionColor: "#334455",
  });
  expect(sectionSchema.parse(sectionRegistry.cta.create("cta-default"))).toEqual({
    id: "cta-default",
    type: "cta",
    label: "Continue",
    url: "https://example.com",
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  });
  const source = callCountGenerator("generated");
  // createSection assigns the generated id and then uses the same factory.
  expect(createSection("carousel", source.generateId)).toEqual(sectionRegistry.carousel.create("generated-1"));
  expect(createSection("text", source.generateId)).toEqual(sectionRegistry.text.create("generated-2"));
  expect(createSection("cta", source.generateId)).toEqual(sectionRegistry.cta.create("generated-3"));
  expect(source.calls()).toBe(3);
}

/**
 * Proves the display map is only the three architecture ratios.
 *
 * Purpose: portrait is 3 / 4, landscape is 16 / 9, and square is 1 / 1.
 * Inputs: none.
 * Side effects: none.
 */
function aspectRatioMapHasTheThreeRatios(): void {
  // Key order follows ASPECT_RATIOS. The document stores those names, not these CSS strings.
  expect(Object.keys(ASPECT_RATIO_DISPLAY)).toEqual([...ASPECT_RATIOS]);
  expect(ASPECT_RATIO_DISPLAY).toEqual({
    portrait: "3 / 4",
    landscape: "16 / 9",
    square: "1 / 1",
  });
  expect(Object.values(ASPECT_RATIO_DISPLAY)).toEqual(["3 / 4", "16 / 9", "1 / 1"]);
}

/**
 * Checks the registry keys, menu labels, and the compile-time extension seam.
 *
 * Purpose: the registry object names carousel, text, and cta, and the switch returns those entries.
 * Inputs: none.
 * Side effects: none.
 */
function registryListsOnlyTheThreeSectionTypes(): void {
  // A quiz key is not registered. Adding one makes this assignment fail typecheck.
  const quizIsRegistered: QuizIsRegistered = false;
  expect(quizIsRegistered).toBe(false);
  // The registry keys and Section["type"] are the same set. A fourth member makes this fail typecheck.
  const sectionTypesMatch: SectionTypesMatchRegistry = true;
  expect(sectionTypesMatch).toBe(true);
  expect(Object.keys(sectionRegistry)).toEqual(["carousel", "text", "cta"]);
  expect(sectionRegistry.carousel.label).toBe("Carousel");
  expect(sectionRegistry.text.label).toBe("Text");
  expect(sectionRegistry.cta.label).toBe("Button");
  // Every switch arm returns the entry stored on the registry.
  expect(getSectionRegistryEntry("carousel")).toBe(sectionRegistry.carousel);
  expect(getSectionRegistryEntry("text")).toBe(sectionRegistry.text);
  expect(getSectionRegistryEntry("cta")).toBe(sectionRegistry.cta);
  expect(() => assertNever("not-a-section" as never)).toThrow("Unexpected value: not-a-section");
}

/**
 * Proves the default generator returns distinct UUID strings.
 *
 * Purpose: callers can omit the generator and still receive an id at creation time.
 * Inputs: none.
 * Side effects: none. Reads two values from crypto.randomUUID.
 */
function defaultGeneratorReturnsAUuid(): void {
  const first = createStableId();
  const second = createStableId();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // Two default calls do not reuse one id.
  expect(first).not.toBe(second);
  expect(first).toMatch(uuidPattern);
  expect(second).toMatch(uuidPattern);
  const section = createSection("text");
  expect(section.id).toMatch(uuidPattern);
  if (section.type !== "text") {
    throw new Error("Expected a text section.");
  }
  expect(section.title).toBe("Title");
}

/**
 * Proves a repeated generator id does not come back as a document.
 *
 * Purpose: createDemoDocument returns only a value the shared schema accepts.
 * Inputs: none.
 * Side effects: none.
 */
function repeatedIdsDoNotReturnADocument(): void {
  /**
   * Returns the same id on every call.
   *
   * Purpose: force a duplicate image id inside the first carousel.
   * Inputs: none.
   * Side effects: none.
   */
  const generateId = (): string => "same-id";
  // The first carousel's two slides share an id, so the schema rejects the fixture.
  expect(() => createDemoDocument(generateId)).toThrow(/Image ids must be unique within a carousel/);
}

/**
 * Proves createStableId returns the generator string and does not dedupe it.
 *
 * Purpose: the helper is not a schema check. Empty and repeated strings pass through once each.
 * Inputs: none.
 * Side effects: none.
 */
function createStableIdReturnsTheGeneratorValueOnce(): void {
  let calls = 0;
  /**
   * Returns a space, then the word second.
   *
   * Purpose: the stored id is whatever the generator returned, including whitespace.
   * Inputs: none.
   * Side effects: increments the closed-over counter.
   */
  const generateId = (): string => {
    calls += 1;
    // The first call is the value under test. A later call would mean the helper asked again.
    return calls === 1 ? " " : "second";
  };
  const id = createStableId(generateId);
  expect(id).toBe(" ");
  expect(calls).toBe(1);
  expect(id).toBe(" ");
  expect(calls).toBe(1);
  // An empty string is returned. The section factory, not this helper, rejects it.
  expect(createStableId(() => "")).toBe("");
  expect(createStableId(() => "repeat")).toBe("repeat");
  expect(createStableId(() => "repeat")).toBe("repeat");
}

/**
 * Proves factories store a whitespace id and reject an empty one.
 *
 * Purpose: ids are kept as generated. An empty id fails when the section is created.
 * Inputs: none.
 * Side effects: none.
 */
function factoriesKeepWhitespaceIdsAndRejectEmptyIds(): void {
  const text = createSection("text", () => " text ");
  const cta = sectionRegistry.cta.create(" cta ");
  const carousel = sectionRegistry.carousel.create(" carousel ");
  // Spaces stay on the id. The schema does not trim them.
  expect(text.id).toBe(" text ");
  expect(cta.id).toBe(" cta ");
  expect(carousel.id).toBe(" carousel ");
  expect(sectionSchema.parse(text).id).toBe(" text ");
  expect(() => sectionRegistry.carousel.create("")).toThrow(/Section id must be a non-empty string/);
  expect(() => createSection("cta", () => "")).toThrow(/Section id must be a non-empty string/);
}

/**
 * Proves two created sections do not share mutable state.
 *
 * Purpose: a later edit of one block leaves the other, and the next factory result, on the defaults.
 * Inputs: none.
 * Side effects: writes a title and pushes one slide on the first objects only.
 */
function createdSectionsStayIndependent(): void {
  /**
   * Returns the same id for every section.
   *
   * Purpose: show that a repeated id still yields a new object.
   * Inputs: none.
   * Side effects: none.
   */
  const generateId = (): string => "same-text";
  const first = createSection("text", generateId);
  const second = createSection("text", generateId);
  expect(first).toEqual(second);
  expect(first).not.toBe(second);
  if (first.type !== "text" || second.type !== "text") {
    throw new Error("Expected text sections.");
  }
  // Editing the first title leaves the second section on the default copy.
  first.title = "Edited";
  expect(second.title).toBe("Title");
  const third = sectionRegistry.text.create("same-text");
  if (third.type !== "text") {
    throw new Error("Expected a text section.");
  }
  expect(third.title).toBe("Title");
  const firstCarousel = sectionRegistry.carousel.create("carousel-a");
  const secondCarousel = sectionRegistry.carousel.create("carousel-b");
  if (firstCarousel.type !== "carousel" || secondCarousel.type !== "carousel") {
    throw new Error("Expected carousels.");
  }
  // A slide pushed onto the first carousel stays off the second carousel.
  firstCarousel.images.push({ id: "slide", url: "https://example.com/a.jpg", alt: "A" });
  expect(secondCarousel.images).toEqual([]);
}

/**
 * Proves the default id source works for carousel, text, and CTA.
 *
 * Purpose: omitting the generator still assigns a distinct id. This is the path that calls crypto.randomUUID.
 * Inputs: none.
 * Side effects: none. Reads three UUID values.
 */
function defaultGeneratorWorksForEverySectionType(): void {
  const carousel = createSection("carousel");
  const text = createSection("text");
  const cta = createSection("cta");
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  // Each default call receives its own id. The three sections still parse.
  expect(new Set([carousel.id, text.id, cta.id]).size).toBe(3);
  expect(carousel.id).toMatch(uuidPattern);
  expect(text.id).toMatch(uuidPattern);
  expect(cta.id).toMatch(uuidPattern);
  expect(sectionSchema.parse(carousel)).toMatchObject({ type: "carousel", images: [], aspectRatio: "landscape" });
  expect(sectionSchema.parse(text)).toMatchObject({
    type: "text",
    title: "Title",
    description: "",
    titleColor: "#112233",
    descriptionColor: "#334455",
  });
  expect(sectionSchema.parse(cta)).toMatchObject({
    type: "cta",
    label: "Continue",
    url: "https://example.com",
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  });
}

/**
 * Proves a runtime type outside the union does not resolve to a section.
 *
 * Purpose: the switch default throws instead of returning a carousel, text, or CTA entry.
 * Inputs: none.
 * Side effects: none.
 */
function unknownSectionTypeDoesNotResolve(): void {
  // "quiz" is not a schema member. The cast only supplies a runtime value the switch does not name.
  expect(() => getSectionRegistryEntry("quiz" as Section["type"])).toThrow("Unexpected value: quiz");
}

/**
 * Attempts to replace the landscape CSS ratio.
 *
 * Purpose: show that the display map rejects assignment.
 * Inputs: none.
 * Side effects: throws TypeError. The frozen map keeps 16 / 9.
 */
function assignLandscapeRatio(): void {
  // 4 / 3 is not the architecture landscape ratio. The assignment must not stick.
  (ASPECT_RATIO_DISPLAY as { landscape: string }).landscape = "4 / 3";
}

/**
 * Attempts to replace the carousel factory.
 *
 * Purpose: show that a registry entry rejects assignment.
 * Inputs: none.
 * Side effects: throws TypeError. The original factory stays in place.
 */
function assignCarouselFactory(): void {
  /**
   * Builds nothing.
   *
   * Purpose: a stand-in that must never become the carousel factory.
   * Inputs: id, the section id. It is unused because assignment fails first.
   * Side effects: throws if it is called.
   */
  const replacement = (id: string): Section => {
    // Reached only if the frozen entry accepted the assignment.
    throw new Error(`replaced ${id}`);
  };
  // The frozen entry keeps createCarouselSection.
  (sectionRegistry.carousel as { create: (id: string) => Section }).create = replacement;
}

/**
 * Attempts to add a quiz entry at runtime.
 *
 * Purpose: show that the registry object does not gain a fourth key.
 * Inputs: none.
 * Side effects: throws TypeError.
 */
function assignQuizEntry(): void {
  // Quiz stays out of the registry. The cast is the assignment target, not a schema change.
  (sectionRegistry as { quiz?: unknown }).quiz = { label: "Quiz" };
}

/**
 * Proves the registry and the aspect-ratio map keep their published values.
 *
 * Purpose: a caller cannot swap landscape to 4 / 3 or attach another section type.
 * Inputs: none.
 * Side effects: none. The assignment attempts throw.
 */
function registryAndRatioMapRejectAssignment(): void {
  expect(Object.isFrozen(ASPECT_RATIO_DISPLAY)).toBe(true);
  expect(Object.isFrozen(sectionRegistry)).toBe(true);
  expect(Object.isFrozen(sectionRegistry.carousel)).toBe(true);
  expect(assignLandscapeRatio).toThrow(TypeError);
  expect(ASPECT_RATIO_DISPLAY.landscape).toBe("16 / 9");
  expect(assignCarouselFactory).toThrow(TypeError);
  const section = sectionRegistry.carousel.create("after-assign");
  if (section.type !== "carousel") {
    throw new Error("Expected a carousel.");
  }
  // The factory that remains is still the empty landscape default.
  expect(section.aspectRatio).toBe("landscape");
  expect(section.images).toEqual([]);
  expect(assignQuizEntry).toThrow(TypeError);
  expect(Object.keys(sectionRegistry)).toEqual(["carousel", "text", "cta"]);
}

/**
 * Proves a stored aspect-ratio name selects its CSS value.
 *
 * Purpose: the document keeps landscape, and the display map supplies 16 / 9.
 * Inputs: none.
 * Side effects: none.
 */
function carouselNameLooksUpItsCssRatio(): void {
  const section = sectionRegistry.carousel.create("ratio");
  if (section.type !== "carousel") {
    throw new Error("Expected a carousel.");
  }
  // The field is the name. The CSS string is the lookup result.
  expect(section.aspectRatio).toBe("landscape");
  expect(ASPECT_RATIO_DISPLAY[section.aspectRatio]).toBe("16 / 9");
  expect(Object.values(ASPECT_RATIO_DISPLAY)).not.toContain(section.aspectRatio);
}

/**
 * Proves reading a text section and a CTA does not call the generator again.
 *
 * Purpose: every default field is stored on the object at creation.
 * Inputs: none.
 * Side effects: none.
 */
function readingTextAndCtaDoesNotCallTheGenerator(): void {
  const source = callCountGenerator("field");
  const text = createSection("text", source.generateId);
  const cta = createSection("cta", source.generateId);
  // Two sections, two ids.
  expect(source.calls()).toBe(2);
  if (text.type !== "text" || cta.type !== "cta") {
    throw new Error("Expected a text section and a CTA.");
  }
  expect(text.title).toBe("Title");
  expect(text.description).toBe("");
  expect(text.titleColor).toBe("#112233");
  expect(text.descriptionColor).toBe("#334455");
  expect(cta.label).toBe("Continue");
  expect(cta.url).toBe("https://example.com");
  expect(cta.backgroundColor).toBe("#112233");
  expect(cta.labelColor).toBe("#ffffff");
  JSON.stringify(text);
  JSON.stringify(cta);
  expect(text.id).toBe("field-1");
  expect(cta.id).toBe("field-2");
  expect(source.calls()).toBe(2);
}

/**
 * Proves two demo builds with the same generator sequence match and do not share objects.
 *
 * Purpose: the fixture has no module-level id counter, and editing one result leaves the next build unchanged.
 * Inputs: none.
 * Side effects: writes one image URL on the first document.
 */
function demoDocumentsStayIndependent(): void {
  const first = createDemoDocument(callCountGenerator("run").generateId);
  const second = createDemoDocument(callCountGenerator("run").generateId);
  // The same id sequence produces the same document value and a different object.
  expect(second).toEqual(first);
  expect(second).not.toBe(first);
  expect(second.data.sections).not.toBe(first.data.sections);
  const firstCarousel = first.data.sections[0];
  if (firstCarousel === undefined || firstCarousel.type !== "carousel") {
    throw new Error("Expected a carousel.");
  }
  const firstImage = firstCarousel.images[0];
  if (firstImage === undefined) {
    throw new Error("Expected a slide.");
  }
  const originalUrl = firstImage.url;
  firstImage.url = "https://example.com/demo/mutated.jpg";
  const third = createDemoDocument(callCountGenerator("run").generateId);
  const thirdCarousel = third.data.sections[0];
  if (thirdCarousel === undefined || thirdCarousel.type !== "carousel") {
    throw new Error("Expected a carousel.");
  }
  // The next build still has the fixture URL. The second build was already copied.
  expect(thirdCarousel.images[0]?.url).toBe(originalUrl);
  const secondCarousel = second.data.sections[0];
  if (secondCarousel === undefined || secondCarousel.type !== "carousel") {
    throw new Error("Expected a carousel.");
  }
  expect(secondCarousel.images[0]?.url).toBe(originalUrl);
}

/**
 * Proves a repeated section id does not come back as a document.
 *
 * Purpose: image ids in this sequence are unique. The failure is the section-id rule.
 * Inputs: none.
 * Side effects: none.
 */
function duplicateSectionIdsDoNotReturnADocument(): void {
  const generateId = queueGenerator([
    "section-1",
    "image-1",
    "image-2",
    "section-1",
    "cta-1",
    "carousel-2",
    "image-3",
    "image-4",
    "text-2",
    "cta-2",
  ]);
  // The text block reuses the first carousel's id. Image ids inside each carousel differ.
  expect(() => createDemoDocument(generateId)).toThrow(/Section ids must be unique in the document/);
}

/**
 * Proves the same image id may appear in the second carousel.
 *
 * Purpose: image uniqueness is per carousel. The demo builder uses that schema rule.
 * Inputs: none.
 * Side effects: none.
 */
function sameImageIdInAnotherCarouselParses(): void {
  const generateId = queueGenerator([
    "carousel-1",
    "shared-image",
    "image-1b",
    "text-1",
    "cta-1",
    "carousel-2",
    "shared-image",
    "image-2b",
    "text-2",
    "cta-2",
  ]);
  const document = createDemoDocument(generateId);
  const first = document.data.sections[0];
  const second = document.data.sections[3];
  if (first === undefined || first.type !== "carousel" || second === undefined || second.type !== "carousel") {
    throw new Error("Expected two carousels.");
  }
  // Both carousels keep the shared image id, and the document still parses.
  expect(first.images[0]?.id).toBe("shared-image");
  expect(second.images[0]?.id).toBe("shared-image");
  expect(first.images[1]?.id).not.toBe(second.images[1]?.id);
  expect(editableDocumentSchema.parse(document)).toEqual(document);
}

/**
 * Proves the demo screen is not six add-menu defaults.
 *
 * Purpose: the fixture has slides, its own copy, and a second aspect ratio.
 * Inputs: none.
 * Side effects: none.
 */
function demoDocumentIsNotTheAddMenuDefaults(): void {
  const document = createDemoDocument(callCountGenerator("demo").generateId);
  const carousel = document.data.sections[0];
  const text = document.data.sections[1];
  const cta = document.data.sections[2];
  const secondCarousel = document.data.sections[3];
  if (
    carousel === undefined ||
    carousel.type !== "carousel" ||
    text === undefined ||
    text.type !== "text" ||
    cta === undefined ||
    cta.type !== "cta" ||
    secondCarousel === undefined ||
    secondCarousel.type !== "carousel"
  ) {
    throw new Error("Expected the demo section types.");
  }
  // Defaults would be an empty landscape carousel, the title Title, and https://example.com.
  expect(carousel.images.length).toBeGreaterThan(0);
  expect(secondCarousel.images.length).toBeGreaterThan(0);
  expect(carousel.aspectRatio).toBe("landscape");
  expect(secondCarousel.aspectRatio).toBe("portrait");
  expect(text.title).not.toBe("Title");
  expect(text.description).not.toBe("");
  expect(cta.url).not.toBe("https://example.com");
  const textDefault = sectionRegistry.text.create("unused");
  if (textDefault.type !== "text") {
    throw new Error("Expected a text section.");
  }
  // The first text block keeps the default colors and replaces the default copy.
  expect(text.titleColor).toBe(textDefault.titleColor);
  expect(text.descriptionColor).toBe(textDefault.descriptionColor);
}

/**
 * Registers the section registry tests.
 *
 * Purpose: cover the demo fixture, stable ids, defaults, the aspect-ratio map, and the extension seam.
 * Inputs: none.
 * Side effects: registers Vitest cases.
 */
function registerRegistryTests(): void {
  it("parses the demo document as carousel, text, CTA, carousel, text, CTA", demoDocumentParsesInScreenOrder);
  it("gives two carousels different ids when the generator returns different values", createdCarouselsDoNotShareAnId);
  it("does not call the generator again when the section is read", readingASectionDoesNotCallTheGenerator);
  /**
   * A quiz section would add a union member, a factory, a renderer, an inspector,
   * and a fixture, and would not require a new database table. This comment is the
   * seed of R03. The quiz type is not implemented.
   */
  it("registers exactly carousel, text, and cta", registryListsOnlyTheThreeSectionTypes);
  it("parses each default section", eachDefaultSectionParses);
  it("maps only portrait, landscape, and square", aspectRatioMapHasTheThreeRatios);
  it("returns a uuid from the default generator", defaultGeneratorReturnsAUuid);
  it("returns the generator string once and does not dedupe it", createStableIdReturnsTheGeneratorValueOnce);
  it("keeps a whitespace id and rejects an empty id", factoriesKeepWhitespaceIdsAndRejectEmptyIds);
  it("keeps created sections independent", createdSectionsStayIndependent);
  it("assigns a default id for every section type", defaultGeneratorWorksForEverySectionType);
  it("does not call the generator again when text or a CTA is read", readingTextAndCtaDoesNotCallTheGenerator);
  it("throws for a section type outside the union", unknownSectionTypeDoesNotResolve);
  it("keeps the registry and aspect-ratio map unchanged when assigned", registryAndRatioMapRejectAssignment);
  it("looks up 16 / 9 from the stored landscape name", carouselNameLooksUpItsCssRatio);
  it("builds equal demo documents that do not share objects", demoDocumentsStayIndependent);
  it("rejects a demo document when a section id is repeated", duplicateSectionIdsDoNotReturnADocument);
  it("accepts the same image id in the other carousel", sameImageIdInAnotherCarouselParses);
  it("uses fixture copy instead of six add-menu defaults", demoDocumentIsNotTheAddMenuDefaults);
  it("rejects a demo document when the generator repeats an image id", repeatedIdsDoNotReturnADocument);
}

describe("section registry", registerRegistryTests);
