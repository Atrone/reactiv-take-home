import { z } from "zod";
import { hexColorSchema } from "./color.js";
import {
  ALT_LIMIT_MESSAGE,
  CAROUSEL_IMAGE_LIMIT_MESSAGE,
  CTA_LABEL_LIMIT_MESSAGE,
  DESCRIPTION_LIMIT_MESSAGE,
  DOCUMENT_IMAGE_LIMIT_MESSAGE,
  LIMITS,
  SECTION_LIMIT_MESSAGE,
  TITLE_LIMIT_MESSAGE,
} from "./limits.js";
import { httpUrlSchema } from "./url.js";
import { SUPPORTED_SCHEMA_VERSION } from "./versions.js";

/**
 * Document schemas for the editor and the configuration service.
 *
 * `/v1` is the HTTP contract (`HTTP_API_PREFIX`).
 * `schemaVersion` is this document format. Only 1 is accepted.
 * `revision` is the concurrency counter for one configuration.
 * POST and PUT bodies are `EditableDocument`. GET, POST, and PUT success bodies are `Configuration`.
 */

const DUPLICATE_SECTION_ID_MESSAGE = "Section ids must be unique in the document.";
const DUPLICATE_IMAGE_ID_MESSAGE = "Image ids must be unique within a carousel.";
const UTC_TIMESTAMP_MESSAGE = "updatedAt must be an ISO-8601 UTC timestamp.";

/** Failure text for a CTA label that is empty after the ends are trimmed. */
export const CTA_LABEL_REQUIRED_MESSAGE = "Enter a CTA label.";

/**
 * Aspect-ratio names stored in the document.
 *
 * The JSON keeps these strings. A later renderer maps portrait to 3 / 4,
 * landscape to 16 / 9, and square to 1 / 1. Pixel ratios are not stored.
 */
export const ASPECT_RATIOS = ["portrait", "landscape", "square"] as const;

/**
 * Builds a non-empty string schema.
 *
 * Purpose: ids are stable non-empty strings, and this package does not trim them.
 * Inputs: message, the failure text for an empty string.
 * Side effects: none.
 */
function nonEmptyString(message: string): z.ZodString {
  // Empty strings fail. A string of spaces stays, so an id cannot change by trimming.
  return z.string().min(1, message);
}

/**
 * Finds repeated ids.
 *
 * Purpose: section ids are unique in the document, and image ids are unique in one carousel.
 * Inputs: items, the objects that carry id.
 * Side effects: none. Returns the indexes of later copies.
 */
function duplicateIdIndexes(items: readonly { id: string }[]): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items.at(index);
    // A sparse hole has no id to compare.
    if (item === undefined) {
      continue;
    }
    // The first occurrence stays. A later copy is the failure.
    if (seen.has(item.id)) {
      duplicates.push(index);
      continue;
    }
    seen.add(item.id);
  }
  return duplicates;
}

type IssueCollector = {
  addIssue: (issue: { code: "custom"; message: string; path: PropertyKey[] }) => void;
};

/**
 * Records one issue for each repeated id.
 *
 * Purpose: attach uniqueness failures to the repeated id field.
 * Inputs: items, the objects that carry id. ctx, the Zod issue collector. message, the failure text.
 * Side effects: records issues on ctx.
 */
function recordDuplicateIdIssues(items: readonly { id: string }[], ctx: IssueCollector, message: string): void {
  const indexes = duplicateIdIndexes(items);
  for (const index of indexes) {
    // The path is relative to the array currently being checked.
    ctx.addIssue({
      code: "custom",
      message,
      path: [index, "id"],
    });
  }
}

/**
 * Rejects a repeated image id inside one carousel.
 *
 * Purpose: image ids are unique within a carousel, and the same id may exist in another carousel.
 * Inputs: images, the carousel slides. ctx, the Zod issue collector.
 * Side effects: records issues on ctx.
 */
function refineCarouselImages(images: readonly { id: string }[], ctx: IssueCollector): void {
  recordDuplicateIdIssues(images, ctx, DUPLICATE_IMAGE_ID_MESSAGE);
}

/**
 * Rejects duplicate section ids and too many images in the whole document.
 *
 * Purpose: keep section identity unique and enforce the document image cap.
 * Inputs: sections, the ordered section list. ctx, the Zod issue collector.
 * Side effects: records issues on ctx.
 */
function refineSections(
  sections: readonly { id: string; type: string; images?: readonly unknown[] }[],
  ctx: IssueCollector,
): void {
  recordDuplicateIdIssues(sections, ctx, DUPLICATE_SECTION_ID_MESSAGE);
  const imageCount = countCarouselImages(sections);
  // The per-carousel cap is separate from this document-wide cap.
  if (imageCount > LIMITS.maxImagesPerDocument) {
    ctx.addIssue({
      code: "custom",
      message: DOCUMENT_IMAGE_LIMIT_MESSAGE,
      path: [],
    });
  }
}

/**
 * Counts images in every carousel.
 *
 * Purpose: enforce the document-wide image cap. Text and CTA sections add nothing.
 * Inputs: sections, the ordered section list.
 * Side effects: none.
 */
function countCarouselImages(sections: readonly { type: string; images?: readonly unknown[] }[]): number {
  let total = 0;
  for (const section of sections) {
    // Only carousel blocks carry images. Array order is the screen order.
    if (section.type === "carousel") {
      total += section.images?.length ?? 0;
    }
  }
  return total;
}

/**
 * Reports whether a timestamp is explicitly UTC.
 *
 * Purpose: accept `Z` and zero offsets, and reject local or shifted times.
 * Inputs: value, an ISO-8601 datetime string that already matched the datetime pattern.
 * Side effects: none.
 */
function isUtcTimestamp(value: string): boolean {
  // `Z` is UTC. `+00:00` and `-00:00` are the same instant written as a numeric offset.
  return value.endsWith("Z") || value.endsWith("+00:00") || value.endsWith("-00:00");
}

/** One carousel image. `url` is an absolute http(s) URL, and `alt` may be empty. */
export const imageSchema = z.strictObject({
  id: nonEmptyString("Image id must be a non-empty string."),
  url: httpUrlSchema,
  alt: z.string().max(LIMITS.maxAltCharacters, ALT_LIMIT_MESSAGE),
});

/**
 * Images belonging to one carousel.
 *
 * An empty list is valid. Ids are unique inside this list only, so the same
 * image id may appear in a different carousel. There is no `position` field.
 */
const carouselImagesSchema = z
  .array(imageSchema)
  .max(LIMITS.maxImagesPerCarousel, CAROUSEL_IMAGE_LIMIT_MESSAGE)
  .superRefine(refineCarouselImages);

const aspectRatioSchema = z.enum(ASPECT_RATIOS, "Aspect ratio must be portrait, landscape, or square.");

/** Carousel, text, or CTA. Unknown `type` values fail and are not coerced. */
export const sectionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    id: nonEmptyString("Section id must be a non-empty string."),
    type: z.literal("carousel"),
    images: carouselImagesSchema,
    aspectRatio: aspectRatioSchema,
  }),
  z.strictObject({
    id: nonEmptyString("Section id must be a non-empty string."),
    type: z.literal("text"),
    title: z.string().max(LIMITS.maxTitleCharacters, TITLE_LIMIT_MESSAGE),
    description: z.string().max(LIMITS.maxDescriptionCharacters, DESCRIPTION_LIMIT_MESSAGE),
    titleColor: hexColorSchema,
    descriptionColor: hexColorSchema,
  }),
  z.strictObject({
    id: nonEmptyString("Section id must be a non-empty string."),
    type: z.literal("cta"),
    // Trim only the ends, then require 1–120 characters. Internal spaces stay.
    label: z
      .string()
      .trim()
      .min(LIMITS.minCtaLabelCharacters, CTA_LABEL_REQUIRED_MESSAGE)
      .max(LIMITS.maxCtaLabelCharacters, CTA_LABEL_LIMIT_MESSAGE),
    url: httpUrlSchema,
    backgroundColor: hexColorSchema,
    labelColor: hexColorSchema,
  }),
]);

/**
 * Ordered sections for one document.
 *
 * Array order is the screen order. A `position` field is not accepted.
 * The list may be empty, and it stops at 100 sections.
 */
const sectionsSchema = z
  .array(sectionSchema)
  .max(LIMITS.maxSections, SECTION_LIMIT_MESSAGE)
  .superRefine(refineSections);

/**
 * Portable document accepted by POST, PUT, import, and export.
 *
 * The object is strict, so `id`, `revision`, `updatedAt`, and `tenantId` fail.
 * Those fields are service-owned and are not part of the saved section payload.
 */
export const editableDocumentSchema = z.strictObject({
  // schemaVersion is the document format. Only 1 is accepted. It is not revision.
  schemaVersion: z.literal(SUPPORTED_SCHEMA_VERSION, "Only document schema version 1 is supported."),
  data: z.strictObject({
    sections: sectionsSchema,
  }),
});

const utcTimestampSchema = z
  .iso.datetime({
    offset: true,
    local: false,
    error: UTC_TIMESTAMP_MESSAGE,
  })
  .refine(isUtcTimestamp, UTC_TIMESTAMP_MESSAGE);

/**
 * Configuration returned by GET and by successful POST and PUT.
 *
 * `revision` counts edits of this configuration. It is not `schemaVersion`.
 * The service assigns `id`, `revision`, and `updatedAt`.
 */
export const configurationSchema = editableDocumentSchema.extend({
  id: nonEmptyString("id must be a non-empty string."),
  revision: z
    .number()
    .int("Revision must be an integer greater than or equal to 1.")
    .min(1, "Revision must be an integer greater than or equal to 1."),
  updatedAt: utcTimestampSchema,
});

/** One stored image after a successful parse. */
export type Image = z.output<typeof imageSchema>;

/** One stored section after a successful parse. Colors are lowercase #rrggbb. */
export type Section = z.output<typeof sectionSchema>;

/** Portable document after normalization. `schemaVersion` is the literal 1. */
export type EditableDocument = z.output<typeof editableDocumentSchema>;

/**
 * Service success body.
 *
 * `revision` is the concurrency counter. `schemaVersion` remains the document format.
 */
export type Configuration = z.output<typeof configurationSchema>;
