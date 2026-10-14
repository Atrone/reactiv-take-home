import { describe, expect, it } from "vitest";
import {
  ASPECT_RATIOS,
  CONTRACTS_PACKAGE_NAME,
  HTTP_API_PREFIX,
  LIMITS,
  SUPPORTED_SCHEMA_VERSION,
  configurationSchema,
  editableDocumentSchema,
  issuesFromZodError,
  normalizeHexColor,
  type EditableDocument,
} from "./index.js";

/**
 * Builds a text section.
 *
 * Purpose: start document tests from a known-good text block.
 * Inputs: id, the section id. title, the title text.
 * Side effects: none.
 */
function textSection(id: string, title = ""): {
  id: string;
  type: "text";
  title: string;
  description: string;
  titleColor: string;
  descriptionColor: string;
} {
  return {
    id,
    type: "text",
    title,
    description: "",
    titleColor: "#112233",
    descriptionColor: "#445566",
  };
}

/**
 * Builds a CTA section.
 *
 * Purpose: start document tests from a known-good call to action.
 * Inputs: id, the section id. label, the button text. url, the destination.
 * Side effects: none.
 */
function ctaSection(id: string, label: string, url = "https://example.com/go"): {
  id: string;
  type: "cta";
  label: string;
  url: string;
  backgroundColor: string;
  labelColor: string;
} {
  return {
    id,
    type: "cta",
    label,
    url,
    backgroundColor: "#112233",
    labelColor: "#445566",
  };
}

/**
 * Builds a carousel section.
 *
 * Purpose: start document tests from a known-good carousel.
 * Inputs: id, the section id. images, the slide list. aspectRatio, the stored name.
 * Side effects: none.
 */
function carouselSection(
  id: string,
  images: { id: string; url: string; alt: string }[],
  aspectRatio: "portrait" | "landscape" | "square" = "portrait",
): {
  id: string;
  type: "carousel";
  images: { id: string; url: string; alt: string }[];
  aspectRatio: "portrait" | "landscape" | "square";
} {
  return {
    id,
    type: "carousel",
    images,
    aspectRatio,
  };
}

/**
 * Builds one image.
 *
 * Purpose: fill carousel fixtures with a valid slide.
 * Inputs: id, the image id.
 * Side effects: none.
 */
function image(id: string): { id: string; url: string; alt: string } {
  return {
    id,
    url: "https://example.com/a.png",
    alt: "",
  };
}

/**
 * Parses a portable document and returns the normalized value.
 *
 * Purpose: fail the test with Zod's message when a fixture should be valid.
 * Inputs: data, the unknown JSON value.
 * Side effects: none. Throws when validation fails.
 */
function parseDocument(data: unknown): EditableDocument {
  const result = editableDocumentSchema.safeParse(data);
  // A failure here means the fixture is not the valid case under test.
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data;
}

/**
 * Collects failure messages for one document.
 *
 * Purpose: assert a rule without depending on Zod's path array shape.
 * Inputs: data, the unknown JSON value.
 * Side effects: none. Throws when the document is unexpectedly valid.
 */
function failureMessages(data: unknown): string[] {
  const result = editableDocumentSchema.safeParse(data);
  // The caller is checking a rejection, so success is a test failure.
  if (result.success) {
    throw new Error("Expected the document to fail validation.");
  }
  const messages: string[] = [];
  for (const issue of result.error.issues) {
    messages.push(issue.message);
  }
  return messages;
}

/**
 * Collects field paths for one rejected document.
 *
 * Purpose: assert which field failed, using the shared path format.
 * Inputs: data, the unknown JSON value.
 * Side effects: none. Throws when the document is unexpectedly valid.
 */
function issuePaths(data: unknown): string[] {
  const result = editableDocumentSchema.safeParse(data);
  // The caller is checking a rejection, so success is a test failure.
  if (result.success) {
    throw new Error("Expected the document to fail validation.");
  }
  const paths: string[] = [];
  for (const issue of issuesFromZodError(result.error)) {
    paths.push(issue.path);
  }
  return paths;
}

/**
 * Proves #123 expands to six lowercase digits.
 *
 * Purpose: cover the short-hex half of the color rule.
 * Inputs: none.
 * Side effects: none.
 */
function normalizesShortHex(): void {
  // The normalizer and the schema both expand the same three digits.
  expect(normalizeHexColor("#123")).toBe("#112233");
  const parsed = parseDocument({
    schemaVersion: 1,
    data: { sections: [{ ...textSection("text-1", "Hello"), titleColor: "#123" }] },
  });
  const section = parsed.data.sections[0];
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected a text section.");
  }
  expect(section.titleColor).toBe("#112233");
}

/**
 * Proves #12ABEF becomes lowercase #12abef.
 *
 * Purpose: cover the six-digit half of the color rule.
 * Inputs: none.
 * Side effects: none.
 */
function normalizesSixDigitHex(): void {
  expect(normalizeHexColor("#12ABEF")).toBe("#12abef");
  expect(normalizeHexColor("#12abef")).toBe("#12abef");
  const parsed = parseDocument({
    schemaVersion: 1,
    data: {
      sections: [
        {
          ...textSection("text-1", "Hello"),
          descriptionColor: "#12ABEF",
        },
        {
          ...ctaSection("cta-1", "Shop"),
          backgroundColor: "#AbC",
          labelColor: "#00FF00",
        },
      ],
    },
  });
  const text = parsed.data.sections[0];
  const cta = parsed.data.sections[1];
  if (text === undefined || text.type !== "text" || cta === undefined || cta.type !== "cta") {
    throw new Error("Expected a text section and a CTA section.");
  }
  expect(text.descriptionColor).toBe("#12abef");
  expect(cta.backgroundColor).toBe("#aabbcc");
  expect(cta.labelColor).toBe("#00ff00");
}

/**
 * Rejects short, non-hex, alpha, named, and functional colors.
 *
 * Purpose: schema version 1 stores #RGB and #RRGGBB only.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsInvalidColors(): void {
  const samples = ["#12", "#GGGGGG", "#11223344", "#rrggbbaa", "#1234", "#", "##112233", "red", "rgb(0, 0, 0)", " #123", "#123 "];
  for (const color of samples) {
    expect(normalizeHexColor(color)).toBeNull();
    const result = editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: { sections: [{ ...textSection("text-1"), titleColor: color }] },
    });
    expect(result.success).toBe(false);
  }
  expect(failureMessages({ schemaVersion: 1, data: { sections: [{ ...textSection("text-1"), titleColor: "#12" }] } })).toContain(
    "Use a #RGB or #RRGGBB color.",
  );
}

/**
 * Accepts an absolute https image URL.
 *
 * Purpose: the required passing URL stays unchanged.
 * Inputs: none.
 * Side effects: none.
 */
function acceptsHttpsUrl(): void {
  const parsed = parseDocument({
    schemaVersion: 1,
    data: {
      sections: [carouselSection("carousel-1", [{ id: "img-1", url: "https://example.com/a.png", alt: "A slide" }])],
    },
  });
  const section = parsed.data.sections[0];
  if (section === undefined || section.type !== "carousel") {
    throw new Error("Expected a carousel.");
  }
  expect(section.images[0]?.url).toBe("https://example.com/a.png");
  const httpDocument = parseDocument({
    schemaVersion: 1,
    data: { sections: [ctaSection("cta-1", "Shop", "http://example.com/a")] },
  });
  expect(httpDocument.data.sections[0]).toMatchObject({ url: "http://example.com/a" });
}

/**
 * Rejects executable, relative, and credentialed URLs on images and CTAs.
 *
 * Purpose: both URL fields share one rule.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsUnsafeUrls(): void {
  const samples = [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///tmp/a",
    "/relative.png",
    "https://user:pass@example.com/a",
    "blob:https://example.com/11111111-1111-1111-1111-111111111111",
    "https://user@example.com/a",
  ];
  for (const url of samples) {
    const imageResult = editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: { sections: [carouselSection("carousel-1", [{ id: "img-1", url, alt: "" }])] },
    });
    const ctaResult = editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: { sections: [ctaSection("cta-1", "Shop", url)] },
    });
    expect(imageResult.success).toBe(false);
    expect(ctaResult.success).toBe(false);
    expect(failureMessages({ schemaVersion: 1, data: { sections: [ctaSection("cta-1", "Shop", url)] } })).toContain(
      "Use an absolute HTTP(S) URL.",
    );
  }
}

/**
 * Keeps two sections of each type in the given order.
 *
 * Purpose: array order is the only order, and a position field is absent.
 * Inputs: none.
 * Side effects: none.
 */
function preservesSectionOrder(): void {
  const sections = [
    carouselSection("carousel-1", [image("img-1")], "portrait"),
    textSection("text-1", "First title"),
    ctaSection("cta-1", "Shop"),
    carouselSection("carousel-2", [image("img-2")], "landscape"),
    textSection("text-2", "Second title"),
    ctaSection("cta-2", "Browse"),
  ];
  const parsed = parseDocument({ schemaVersion: 1, data: { sections } });
  const ids: string[] = [];
  const types: string[] = [];
  for (const section of parsed.data.sections) {
    ids.push(section.id);
    types.push(section.type);
  }
  // The parsed ids follow the input array, with no sort and no position key.
  expect(ids).toEqual(["carousel-1", "text-1", "cta-1", "carousel-2", "text-2", "cta-2"]);
  expect(types).toEqual(["carousel", "text", "cta", "carousel", "text", "cta"]);
  expect(parsed.data.sections[0]).toEqual(sections[0]);
  expect(parsed.data.sections[3]).toMatchObject({ aspectRatio: "landscape" });
}

/**
 * Rejects a repeated section id and a repeated image id in one carousel.
 *
 * Purpose: uniqueness is per document for sections and per carousel for images.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsDuplicateIds(): void {
  const duplicateSections = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    data: { sections: [textSection("same", "One"), ctaSection("same", "Shop")] },
  });
  const duplicateImages = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    data: {
      sections: [
        carouselSection("carousel-1", [
          { id: "img-1", url: "https://example.com/a.png", alt: "" },
          { id: "img-1", url: "https://example.com/b.png", alt: "" },
        ]),
      ],
    },
  });
  expect(duplicateSections.success).toBe(false);
  expect(duplicateImages.success).toBe(false);
  if (!duplicateSections.success) {
    const sectionPaths: string[] = [];
    for (const issue of issuesFromZodError(duplicateSections.error)) {
      sectionPaths.push(issue.path);
      expect(issue.message).toBe("Section ids must be unique in the document.");
    }
    expect(sectionPaths).toContain("data.sections[1].id");
    expect(sectionPaths).not.toContain("data.sections[0].id");
  }
  if (!duplicateImages.success) {
    const imagePaths: string[] = [];
    for (const issue of issuesFromZodError(duplicateImages.error)) {
      imagePaths.push(issue.path);
      expect(issue.message).toBe("Image ids must be unique within a carousel.");
    }
    expect(imagePaths).toContain("data.sections[0].images[1].id");
    expect(imagePaths).not.toContain("data.sections[0].images[0].id");
  }
}

/**
 * Allows the same image id in two different carousels.
 *
 * Purpose: image uniqueness is scoped to one carousel.
 * Inputs: none.
 * Side effects: none.
 */
function allowsImageIdAcrossCarousels(): void {
  const parsed = parseDocument({
    schemaVersion: 1,
    data: {
      sections: [
        carouselSection("carousel-1", [image("shared")], "portrait"),
        carouselSection("carousel-2", [image("shared")], "square"),
      ],
    },
  });
  expect(parsed.data.sections).toHaveLength(2);
}

/**
 * Rejects schema version 2, a string version, and a missing version.
 *
 * Purpose: only numeric schemaVersion 1 is the document format.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsUnsupportedSchemaVersions(): void {
  const rejected = [2, "1", 1.5, 0, true, null];
  for (const schemaVersion of rejected) {
    // A string or another number must not be coerced into schema version 1.
    expect(editableDocumentSchema.safeParse({ schemaVersion, data: { sections: [] } }).success).toBe(false);
  }
  expect(editableDocumentSchema.safeParse({ data: { sections: [] } }).success).toBe(false);
  expect(failureMessages({ schemaVersion: 2, data: { sections: [] } })).toContain("Only document schema version 1 is supported.");
  expect(failureMessages({ schemaVersion: "1", data: { sections: [] } })).toContain("Only document schema version 1 is supported.");
}

/**
 * Rejects an unknown section type.
 *
 * Purpose: quiz is not coerced into carousel, text, or CTA.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsQuizSection(): void {
  // These fields would be a valid text section if `quiz` were coerced.
  const result = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "quiz-1",
          type: "quiz",
          title: "Question",
          description: "",
          titleColor: "#112233",
          descriptionColor: "#445566",
        },
        {
          id: "carousel-1",
          type: "Carousel",
          images: [],
          aspectRatio: "portrait",
        },
      ],
    },
  });
  expect(result.success).toBe(false);
  if (result.success) {
    return;
  }
  const paths: string[] = [];
  for (const issue of issuesFromZodError(result.error)) {
    paths.push(issue.path);
  }
  expect(paths).toContain("data.sections[0].type");
  expect(paths).toContain("data.sections[1].type");
}

/**
 * Accepts an empty section list and an empty carousel.
 *
 * Purpose: both empty states are valid saved documents.
 * Inputs: none.
 * Side effects: none.
 */
function acceptsEmptyDocumentAndCarousel(): void {
  expect(parseDocument({ schemaVersion: 1, data: { sections: [] } })).toEqual({
    schemaVersion: 1,
    data: { sections: [] },
  });
  const parsed = parseDocument({
    schemaVersion: 1,
    data: { sections: [carouselSection("carousel-1", [], "square")] },
  });
  expect(parsed.data.sections[0]).toEqual({
    id: "carousel-1",
    type: "carousel",
    images: [],
    aspectRatio: "square",
  });
}

/**
 * Rejects a blank CTA label and accepts an empty text title.
 *
 * Purpose: a saved CTA needs a label, and a text title may be empty.
 * Inputs: none.
 * Side effects: none.
 */
function checksRequiredText(): void {
  expect(
    editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: { sections: [ctaSection("cta-1", "   ")] },
    }).success,
  ).toBe(false);
  expect(
    editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: { sections: [ctaSection("cta-1", "")] },
    }).success,
  ).toBe(false);
  const emptyTitle = parseDocument({
    schemaVersion: 1,
    data: { sections: [textSection("text-1")] },
  });
  const emptySection = emptyTitle.data.sections[0];
  if (emptySection === undefined || emptySection.type !== "text") {
    throw new Error("Expected a text section.");
  }
  expect(emptySection.title).toBe("");
  const preserved = parseDocument({
    schemaVersion: 1,
    data: {
      sections: [{ ...textSection("text-2", "  Hi  "), description: "\nKeep this\n  line\n" }],
    },
  });
  const section = preserved.data.sections[0];
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected a text section.");
  }
  expect(section.title).toBe("  Hi  ");
  expect(section.description).toBe("\nKeep this\n  line\n");
}

/**
 * Trims only the ends of a CTA label.
 *
 * Purpose: the saved label length is measured after trim, and internal spaces stay.
 * Inputs: none.
 * Side effects: none.
 */
function trimsCtaLabelEnds(): void {
  const parsed = parseDocument({
    schemaVersion: 1,
    data: { sections: [ctaSection("cta-1", "  Shop  now  ")] },
  });
  const section = parsed.data.sections[0];
  if (section === undefined || section.type !== "cta") {
    throw new Error("Expected a CTA section.");
  }
  expect(section.label).toBe("Shop  now");
  // 122 raw characters trim to the 120-character ceiling and stay valid.
  const atLimit = ` ${"c".repeat(LIMITS.maxCtaLabelCharacters)} `;
  const atLimitParsed = parseDocument({
    schemaVersion: 1,
    data: { sections: [ctaSection("cta-limit", atLimit)] },
  });
  const atLimitSection = atLimitParsed.data.sections[0];
  if (atLimitSection === undefined || atLimitSection.type !== "cta") {
    throw new Error("Expected a CTA section.");
  }
  expect(atLimitSection.label).toBe("c".repeat(LIMITS.maxCtaLabelCharacters));
  // One more character after trim is over the ceiling. Tabs and newlines trim to nothing.
  expect(
    failureMessages({
      schemaVersion: 1,
      data: { sections: [ctaSection("cta-over", ` ${"c".repeat(LIMITS.maxCtaLabelCharacters + 1)} `)] },
    }),
  ).toContain("CTA label must be 120 characters or fewer.");
  expect(failureMessages({ schemaVersion: 1, data: { sections: [ctaSection("cta-blank", "\n\t\n")] } })).toContain("Enter a CTA label.");
}

/**
 * Rejects service-owned keys and a position field on a write body.
 *
 * Purpose: POST and PUT accept the portable document only.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsServerOwnedKeys(): void {
  const result = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    id: "cfg_demo",
    revision: 1,
    updatedAt: "2026-10-12T17:44:00.000Z",
    tenantId: "demo",
    data: {
      sections: [{ ...textSection("text-1", "Hello"), position: 1 }],
    },
  });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths: string[] = [];
    for (const issue of issuesFromZodError(result.error)) {
      paths.push(issue.path);
    }
    expect(paths).toEqual(expect.arrayContaining(["id", "revision", "updatedAt", "tenantId", "data.sections[0].position"]));
  }
}

/**
 * Rejects a pixel ratio and accepts the three names.
 *
 * Purpose: the document stores portrait, landscape, and square.
 * Inputs: none.
 * Side effects: none.
 */
function checksAspectRatioNames(): void {
  expect(ASPECT_RATIOS).toEqual(["portrait", "landscape", "square"]);
  for (const aspectRatio of ["16 / 9", "4 / 3", "3 / 4"]) {
    expect(
      editableDocumentSchema.safeParse({
        schemaVersion: 1,
        data: { sections: [{ ...carouselSection("carousel-1", []), aspectRatio }] },
      }).success,
    ).toBe(false);
  }
  const parsed = parseDocument({
    schemaVersion: 1,
    data: {
      sections: [
        carouselSection("portrait-1", [], "portrait"),
        carouselSection("landscape-1", [], "landscape"),
        carouselSection("square-1", [], "square"),
      ],
    },
  });
  const stored: string[] = [];
  for (const section of parsed.data.sections) {
    if (section.type !== "carousel") {
      throw new Error("Expected a carousel.");
    }
    stored.push(section.aspectRatio);
  }
  expect(stored).toEqual(["portrait", "landscape", "square"]);
}

/**
 * Enforces the section, image, and string ceilings.
 *
 * Purpose: the schema reads the shared limit object.
 * Inputs: none.
 * Side effects: none.
 */
function enforcesCountAndLengthLimits(): void {
  const title = "a".repeat(LIMITS.maxTitleCharacters);
  expect(parseDocument({ schemaVersion: 1, data: { sections: [textSection("text-1", title)] } }).data.sections[0]).toMatchObject({
    title,
  });
  expect(
    editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: { sections: [textSection("text-1", `${title}a`)] },
    }).success,
  ).toBe(false);
  // Title length counts spaces. Trimming would turn this into an empty title.
  const spacedTitle = " ".repeat(LIMITS.maxTitleCharacters);
  expect(parseDocument({ schemaVersion: 1, data: { sections: [textSection("text-spaced", spacedTitle)] } }).data.sections[0]).toMatchObject({
    title: spacedTitle,
  });

  const description = "b".repeat(LIMITS.maxDescriptionCharacters);
  expect(
    parseDocument({
      schemaVersion: 1,
      data: { sections: [{ ...textSection("text-1"), description }] },
    }).data.sections[0],
  ).toMatchObject({ description });
  expect(
    editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: { sections: [{ ...textSection("text-1"), description: `${description}b` }] },
    }).success,
  ).toBe(false);
  // A leading line break counts toward 5,000 and stays in the stored text.
  const descriptionWithBreak = `\n${"b".repeat(LIMITS.maxDescriptionCharacters - 1)}`;
  expect(descriptionWithBreak).toHaveLength(LIMITS.maxDescriptionCharacters);
  expect(
    parseDocument({
      schemaVersion: 1,
      data: { sections: [{ ...textSection("text-break"), description: descriptionWithBreak }] },
    }).data.sections[0],
  ).toMatchObject({ description: descriptionWithBreak });

  const label = "c".repeat(LIMITS.maxCtaLabelCharacters);
  expect(parseDocument({ schemaVersion: 1, data: { sections: [ctaSection("cta-1", label)] } }).data.sections[0]).toMatchObject({
    label,
  });
  expect(
    editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: { sections: [ctaSection("cta-1", `${label}c`)] },
    }).success,
  ).toBe(false);

  const alt = "d".repeat(LIMITS.maxAltCharacters);
  expect(
    parseDocument({
      schemaVersion: 1,
      data: { sections: [carouselSection("carousel-1", [{ id: "img-1", url: "https://example.com/a.png", alt }])] },
    }).data.sections[0],
  ).toMatchObject({ images: [{ alt }] });
  expect(
    editableDocumentSchema.safeParse({
      schemaVersion: 1,
      data: {
        sections: [carouselSection("carousel-1", [{ id: "img-1", url: "https://example.com/a.png", alt: `${alt}d` }])],
      },
    }).success,
  ).toBe(false);

  const twenty: { id: string; url: string; alt: string }[] = [];
  for (let index = 0; index < LIMITS.maxImagesPerCarousel; index += 1) {
    twenty.push(image(`img-${index}`));
  }
  expect(
    parseDocument({ schemaVersion: 1, data: { sections: [carouselSection("carousel-1", twenty)] } }).data.sections[0],
  ).toMatchObject({ images: twenty });
  const tooManySlides = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    data: { sections: [carouselSection("carousel-1", [...twenty, image("img-extra")])] },
  });
  expect(tooManySlides.success).toBe(false);
  if (!tooManySlides.success) {
    const slideMessages: string[] = [];
    for (const issue of issuesFromZodError(tooManySlides.error)) {
      slideMessages.push(issue.message);
    }
    expect(slideMessages).toContain("A carousel can include at most 20 images.");
    expect(slideMessages).not.toContain("A document can include at most 100 images.");
  }

  const prefix = "https://example.com/";
  const maxUrl = `${prefix}${"a".repeat(LIMITS.maxUrlCharacters - prefix.length)}`;
  expect(maxUrl).toHaveLength(LIMITS.maxUrlCharacters);
  expect(parseDocument({ schemaVersion: 1, data: { sections: [ctaSection("cta-1", "Shop", maxUrl)] } }).data.sections[0]).toMatchObject({
    url: maxUrl,
  });
  expect(
    parseDocument({
      schemaVersion: 1,
      data: { sections: [carouselSection("carousel-url", [{ id: "img-1", url: maxUrl, alt: "" }])] },
    }).data.sections[0],
  ).toMatchObject({ images: [{ url: maxUrl }] });
  const tooLongUrl = `${maxUrl}a`;
  const tooLongResult = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    data: { sections: [ctaSection("cta-1", "Shop", tooLongUrl)] },
  });
  expect(tooLongResult.success).toBe(false);
  if (!tooLongResult.success) {
    const urlMessages: string[] = [];
    for (const issue of issuesFromZodError(tooLongResult.error)) {
      urlMessages.push(issue.message);
    }
    // Length is the only failure. The scheme check does not add a second message.
    expect(urlMessages).toEqual(["URL must be 2048 characters or fewer."]);
  }
}

/**
 * Accepts 100 images and rejects 101, including images spread across carousels.
 *
 * Purpose: the document cap is separate from the 20-image carousel cap.
 * Inputs: none.
 * Side effects: none.
 */
function enforcesDocumentImageCap(): void {
  const withinCap = [];
  for (let carouselIndex = 0; carouselIndex < 5; carouselIndex += 1) {
    const slides: { id: string; url: string; alt: string }[] = [];
    for (let imageIndex = 0; imageIndex < 20; imageIndex += 1) {
      slides.push(image(`c${carouselIndex}-${imageIndex}`));
    }
    withinCap.push(carouselSection(`carousel-${carouselIndex}`, slides, "square"));
  }
  expect(parseDocument({ schemaVersion: 1, data: { sections: [...withinCap, textSection("text-1", "Note")] } }).data.sections).toHaveLength(6);
  const overCap = [
    ...withinCap,
    carouselSection("carousel-extra", [image("extra")], "portrait"),
  ];
  const result = editableDocumentSchema.safeParse({ schemaVersion: 1, data: { sections: overCap } });
  expect(result.success).toBe(false);
  if (!result.success) {
    const paths: string[] = [];
    for (const issue of issuesFromZodError(result.error)) {
      paths.push(issue.path);
      expect(issue.message).toBe("A document can include at most 100 images.");
    }
    expect(paths).toContain("data.sections");
  }
}

/**
 * Accepts 100 sections and rejects 101.
 *
 * Purpose: the section ceiling is inclusive.
 * Inputs: none.
 * Side effects: none.
 */
function enforcesSectionCap(): void {
  const sections = [];
  for (let index = 0; index < LIMITS.maxSections; index += 1) {
    sections.push(textSection(`text-${index}`, "Title"));
  }
  expect(parseDocument({ schemaVersion: 1, data: { sections } }).data.sections).toHaveLength(100);
  const extra = [...sections, textSection("text-extra", "Title")];
  expect(editableDocumentSchema.safeParse({ schemaVersion: 1, data: { sections: extra } }).success).toBe(false);
}

/**
 * Keeps revision distinct from schemaVersion on a success body.
 *
 * Purpose: GET and successful writes return Configuration, and writes do not.
 * Inputs: none.
 * Side effects: none.
 */
function separatesRevisionFromSchemaVersion(): void {
  const editable = { schemaVersion: 1 as const, data: { sections: [] } };
  expect(editableDocumentSchema.safeParse(editable).success).toBe(true);
  expect(configurationSchema.safeParse(editable).success).toBe(false);

  const configuration = {
    id: "cfg_demo",
    revision: 4,
    updatedAt: "2026-10-12T17:44:00.000Z",
    schemaVersion: 1 as const,
    data: { sections: [textSection("text-1", "Hello")] },
  };
  const parsed = configurationSchema.safeParse(configuration);
  expect(parsed.success).toBe(true);
  if (!parsed.success) {
    return;
  }
  expect(parsed.data.schemaVersion).toBe(1);
  expect(parsed.data.revision).toBe(4);
  expect(parsed.data.id).toBe("cfg_demo");
  expect(parsed.data.updatedAt).toBe("2026-10-12T17:44:00.000Z");
  expect(editableDocumentSchema.safeParse(configuration).success).toBe(false);
  expect(configurationSchema.safeParse({ ...configuration, updatedAt: "2026-10-12T17:44:00+00:00" }).success).toBe(true);
  expect(configurationSchema.safeParse({ ...configuration, updatedAt: "2026-10-12T17:44:00Z" }).success).toBe(true);
  expect(configurationSchema.safeParse({ ...configuration, updatedAt: "2026-10-12T13:44:00-04:00" }).success).toBe(false);
  expect(configurationSchema.safeParse({ ...configuration, revision: 0 }).success).toBe(false);
  expect(configurationSchema.safeParse({ ...configuration, revision: 1.5 }).success).toBe(false);
  expect(configurationSchema.safeParse({ ...configuration, revision: "1" }).success).toBe(false);
  expect(configurationSchema.safeParse({ ...configuration, tenantId: "demo" }).success).toBe(false);
  expect(configurationSchema.safeParse({ ...configuration, id: "" }).success).toBe(false);
}

/**
 * Rejects URLs that omit a host or a protocol, and keeps accepted URLs unchanged.
 *
 * Purpose: a missing host fails, and a valid URL is stored as written, including spaces and query text.
 * Inputs: none.
 * Side effects: none.
 */
function checksUrlEdges(): void {
  const rejected = ["", "example.com/a.png", "//example.com/a.png", "http://", "https://", "https://:pass@example.com/a"];
  for (const url of rejected) {
    // Image and CTA stay on the same check, including a missing host and a password-only credential.
    expect(
      editableDocumentSchema.safeParse({
        schemaVersion: 1,
        data: { sections: [carouselSection("carousel-1", [{ id: "img-1", url, alt: "" }])] },
      }).success,
    ).toBe(false);
    expect(failureMessages({ schemaVersion: 1, data: { sections: [ctaSection("cta-1", "Shop", url)] } })).toContain(
      "Use an absolute HTTP(S) URL.",
    );
  }
  // The parser accepts surrounding spaces. The stored string stays the original text.
  const stored = [
    "HTTPS://example.com/a.png",
    "https://example.com/a.png?x=1#y",
    "https://example.com/user:pass",
    "http://localhost/a.png",
    "https://example.com:443/a.png",
    " https://example.com/a.png",
    "https://example.com/a.png ",
  ];
  for (const url of stored) {
    const parsed = parseDocument({ schemaVersion: 1, data: { sections: [ctaSection("cta-1", "Shop", url)] } });
    expect(parsed.data.sections[0]).toMatchObject({ url });
  }
  const imageUrl = "https://example.com/a.png?slide=1";
  const imageDocument = parseDocument({
    schemaVersion: 1,
    data: { sections: [carouselSection("carousel-1", [{ id: "img-1", url: imageUrl, alt: "" }])] },
  });
  expect(imageDocument.data.sections[0]).toMatchObject({ images: [{ url: imageUrl }] });
}

/**
 * Rejects a document that is missing a required field or carries an extra nested key.
 *
 * Purpose: strict objects fail closed, and a root failure still has a path.
 * Inputs: none.
 * Side effects: none.
 */
function rejectsIncompleteShapes(): void {
  // A value that is not an object still gets a non-empty issue path.
  expect(issuePaths(null)).toEqual(["$"]);
  expect(
    issuePaths({
      schemaVersion: 1,
      data: {
        sections: [
          {
            id: "text-1",
            type: "text",
            description: "",
            titleColor: "#112233",
            descriptionColor: "#445566",
          },
        ],
      },
    }),
  ).toContain("data.sections[0].title");
  expect(
    issuePaths({
      schemaVersion: 1,
      data: { sections: [{ id: "carousel-1", type: "carousel", images: [] }] },
    }),
  ).toContain("data.sections[0].aspectRatio");
  expect(
    issuePaths({
      schemaVersion: 1,
      data: {
        sections: [
          {
            id: "cta-1",
            type: "cta",
            label: "Shop",
            backgroundColor: "#112233",
            labelColor: "#445566",
          },
        ],
      },
    }),
  ).toContain("data.sections[0].url");
  expect(
    issuePaths({
      schemaVersion: 1,
      data: {
        sections: [
          {
            id: "text-1",
            title: "",
            description: "",
            titleColor: "#112233",
            descriptionColor: "#445566",
          },
        ],
      },
    }),
  ).toContain("data.sections[0].type");
  expect(issuePaths({ schemaVersion: 1, data: { sections: [], meta: { nested: true } } })).toContain("data.meta");
  expect(issuePaths({ schemaVersion: 1, data: { sections: [], schemaVersion: 1 } })).toContain("data.schemaVersion");
  expect(issuePaths({ schemaVersion: 1, data: { sections: {} } })).toContain("data.sections");
  expect(
    issuePaths({
      schemaVersion: 1,
      data: {
        sections: [
          {
            id: "carousel-1",
            type: "carousel",
            aspectRatio: "portrait",
            images: [{ id: "img-1", url: "https://example.com/a.png", alt: "", position: 1 }],
          },
        ],
      },
    }),
  ).toContain("data.sections[0].images[0].position");
}

/**
 * Keeps ids and alt text exactly as written, and rejects an empty id.
 *
 * Purpose: trimming an id would change a stable identity.
 * Inputs: none.
 * Side effects: none.
 */
function preservesUntrimmedIdsAndAlt(): void {
  // A single space is a non-empty id, so it stays. An empty string fails.
  const parsed = parseDocument({
    schemaVersion: 1,
    data: {
      sections: [
        textSection(" ", "Hello"),
        carouselSection("carousel-1", [{ id: " ", url: "https://example.com/a.png", alt: "  slide  " }]),
      ],
    },
  });
  expect(parsed.data.sections[0]).toMatchObject({ id: " " });
  expect(parsed.data.sections[1]).toMatchObject({ images: [{ id: " ", alt: "  slide  " }] });
  expect(failureMessages({ schemaVersion: 1, data: { sections: [textSection("")] } })).toContain("Section id must be a non-empty string.");
  expect(failureMessages({ schemaVersion: 1, data: { sections: [carouselSection("carousel-1", [image("")])] } })).toContain(
    "Image id must be a non-empty string.",
  );
}

/**
 * Reports every later copy of a section id and an image id.
 *
 * Purpose: the first occurrence stays, and each later copy is its own field issue.
 * Inputs: none.
 * Side effects: none.
 */
function reportsEveryLaterDuplicateId(): void {
  // Three copies produce issues at the second and third indexes only.
  const sections = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    data: { sections: [textSection("same", "One"), textSection("same", "Two"), ctaSection("same", "Shop")] },
  });
  expect(sections.success).toBe(false);
  if (!sections.success) {
    const sectionPaths: string[] = [];
    for (const issue of issuesFromZodError(sections.error)) {
      if (issue.message === "Section ids must be unique in the document.") {
        sectionPaths.push(issue.path);
      }
    }
    expect(sectionPaths).toEqual(["data.sections[1].id", "data.sections[2].id"]);
  }
  const images = editableDocumentSchema.safeParse({
    schemaVersion: 1,
    data: { sections: [carouselSection("carousel-1", [image("same"), image("same"), image("same")])] },
  });
  expect(images.success).toBe(false);
  if (!images.success) {
    const imagePaths: string[] = [];
    for (const issue of issuesFromZodError(images.error)) {
      if (issue.message === "Image ids must be unique within a carousel.") {
        imagePaths.push(issue.path);
      }
    }
    expect(imagePaths).toEqual(["data.sections[0].images[1].id", "data.sections[0].images[2].id"]);
  }
}

/**
 * Checks the configuration bounds that are separate from the document format.
 *
 * Purpose: revision starts at 1, and updatedAt stays an explicit UTC timestamp.
 * Inputs: none.
 * Side effects: none.
 */
function checksConfigurationBounds(): void {
  const configuration = {
    id: " ",
    revision: 1,
    updatedAt: "2026-10-12T17:44:00.123+00:00",
    schemaVersion: 1 as const,
    data: { sections: [] },
  };
  const parsed = configurationSchema.safeParse(configuration);
  expect(parsed.success).toBe(true);
  if (!parsed.success) {
    return;
  }
  // A space is a non-empty id. The timestamp is stored as written, including the zero offset.
  expect(parsed.data.id).toBe(" ");
  expect(parsed.data.revision).toBe(1);
  expect(parsed.data.updatedAt).toBe("2026-10-12T17:44:00.123+00:00");
  const negativeOffset = configurationSchema.safeParse({
    ...configuration,
    id: "cfg_demo",
    updatedAt: "2026-10-12T17:44:00.000-00:00",
  });
  expect(negativeOffset.success).toBe(true);
  if (negativeOffset.success) {
    expect(negativeOffset.data.updatedAt).toBe("2026-10-12T17:44:00.000-00:00");
  }
  const base = { ...configuration, id: "cfg_demo" };
  const rejectedTimes = ["2026-10-12T17:44:00", "2026-10-12", "2026-10-12T17:44:00.000z", "2026-10-12T17:44:00+0000"];
  for (const updatedAt of rejectedTimes) {
    const result = configurationSchema.safeParse({ ...base, updatedAt });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages: string[] = [];
      for (const issue of issuesFromZodError(result.error)) {
        messages.push(issue.message);
      }
      expect(messages).toContain("updatedAt must be an ISO-8601 UTC timestamp.");
    }
  }
  const negativeRevision = configurationSchema.safeParse({ ...base, revision: -1 });
  expect(negativeRevision.success).toBe(false);
  if (!negativeRevision.success) {
    const messages: string[] = [];
    for (const issue of issuesFromZodError(negativeRevision.error)) {
      messages.push(issue.message);
    }
    expect(messages).toContain("Revision must be an integer greater than or equal to 1.");
  }
  expect(configurationSchema.safeParse({ ...base, schemaVersion: 2 }).success).toBe(false);
  expect(configurationSchema.safeParse({ id: "cfg_demo", updatedAt: base.updatedAt, schemaVersion: 1, data: { sections: [] } }).success).toBe(false);
  expect(configurationSchema.safeParse({ id: "cfg_demo", revision: 1, schemaVersion: 1, data: { sections: [] } }).success).toBe(false);
  expect(configurationSchema.safeParse({ revision: 1, updatedAt: base.updatedAt, schemaVersion: 1, data: { sections: [] } }).success).toBe(false);
}

/**
 * Publishes the HTTP prefix, the document format, and the package name.
 *
 * Purpose: callers import `/v1`, schema version 1, and `@reactiv/contracts` from these constants.
 * Inputs: none.
 * Side effects: none.
 */
function keepsVersionConstantsDistinct(): void {
  // `/v1` is the HTTP prefix. The document format is the number 1.
  expect(HTTP_API_PREFIX).toBe("/v1");
  expect(SUPPORTED_SCHEMA_VERSION).toBe(1);
  expect(CONTRACTS_PACKAGE_NAME).toBe("@reactiv/contracts");
}

/**
 * Registers the document contract tests.
 *
 * Purpose: prove the shared validation rules before any HTTP layer exists.
 * Inputs: none.
 * Side effects: registers Vitest cases.
 */
function registerDocumentTests(): void {
  // Colors normalize to six-digit hex, and the rejected samples fail.
  it("normalizes #123 to #112233", normalizesShortHex);
  it("normalizes #12ABEF to #12abef", normalizesSixDigitHex);
  it("rejects #12, #GGGGGG, #11223344, named colors, and rgb()", rejectsInvalidColors);
  // Image and CTA URLs share the absolute http(s) rule.
  it("accepts https://example.com/a.png", acceptsHttpsUrl);
  it("rejects script, data, file, blob, relative, and credentialed URLs", rejectsUnsafeUrls);
  // Shape, order, uniqueness, and version rules.
  it("parses two sections of each type without reordering them", preservesSectionOrder);
  it("rejects duplicate section ids and duplicate image ids in one carousel", rejectsDuplicateIds);
  it("allows the same image id in another carousel", allowsImageIdAcrossCarousels);
  it("rejects schema versions other than 1", rejectsUnsupportedSchemaVersions);
  it("rejects section type quiz and a capitalized carousel type", rejectsQuizSection);
  it("accepts an empty document and an empty carousel", acceptsEmptyDocumentAndCarousel);
  it("rejects a blank CTA label and accepts an empty title", checksRequiredText);
  it("trims CTA label ends and keeps internal spaces", trimsCtaLabelEnds);
  it("rejects id, revision, updatedAt, tenantId, and position on a write", rejectsServerOwnedKeys);
  it("stores aspect ratio names", checksAspectRatioNames);
  it("enforces field, URL, and per-carousel limits", enforcesCountAndLengthLimits);
  it("enforces the document image cap", enforcesDocumentImageCap);
  it("enforces the section cap", enforcesSectionCap);
  it("keeps revision distinct from schemaVersion", separatesRevisionFromSchemaVersion);
  it("rejects protocol-less and empty-host URLs and stores valid URLs unchanged", checksUrlEdges);
  it("rejects missing fields and extra nesting", rejectsIncompleteShapes);
  it("keeps untrimmed ids and alt text", preservesUntrimmedIdsAndAlt);
  it("reports every later duplicate id", reportsEveryLaterDuplicateId);
  it("checks revision 1 and UTC timestamps", checksConfigurationBounds);
  it("publishes the version constants", keepsVersionConstantsDistinct);
}

describe("shared document contract", registerDocumentTests);
