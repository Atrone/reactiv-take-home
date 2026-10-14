/**
 * Numeric limits for one home-screen document.
 *
 * Later UI and HTTP checks import this object. The architecture table is the
 * source: 256 KiB, 100 sections, and 100 images, rather than a 1 MiB example.
 */
const limitValues = {
  maxTitleCharacters: 200,
  maxDescriptionCharacters: 5_000,
  minCtaLabelCharacters: 1,
  maxCtaLabelCharacters: 120,
  maxAltCharacters: 300,
  maxUrlCharacters: 2_048,
  maxImagesPerCarousel: 20,
  maxImagesPerDocument: 100,
  maxSections: 100,
  maxPayloadBytes: 256 * 1024,
} as const;

/**
 * Freezes the shared limit table.
 *
 * Purpose: keep every later check on the same numbers.
 * Inputs: limits, the architecture table.
 * Side effects: freezes that object.
 */
function freezeLimits<T extends object>(limits: T): Readonly<T> {
  // Freeze the table so a caller cannot change a limit for one process only.
  return Object.freeze(limits);
}

/** Inclusive limits shared by import, the editor, and the private API. */
export const LIMITS = freezeLimits(limitValues);

/**
 * Sentences for the architecture limits.
 *
 * The numbers come from `LIMITS`. Callers show these strings instead of
 * writing a second copy of 200, 20, or 256 KiB.
 */
export const TITLE_LIMIT_MESSAGE = `Title must be ${LIMITS.maxTitleCharacters} characters or fewer.`;
export const DESCRIPTION_LIMIT_MESSAGE = `Description must be ${LIMITS.maxDescriptionCharacters} characters or fewer.`;
export const CTA_LABEL_LIMIT_MESSAGE = `CTA label must be ${LIMITS.maxCtaLabelCharacters} characters or fewer.`;
export const ALT_LIMIT_MESSAGE = `Alt text must be ${LIMITS.maxAltCharacters} characters or fewer.`;
export const URL_LIMIT_MESSAGE = `URL must be ${LIMITS.maxUrlCharacters} characters or fewer.`;
export const CAROUSEL_IMAGE_LIMIT_MESSAGE = `A carousel can include at most ${LIMITS.maxImagesPerCarousel} images.`;
export const DOCUMENT_IMAGE_LIMIT_MESSAGE = `A document can include at most ${LIMITS.maxImagesPerDocument} images.`;
export const SECTION_LIMIT_MESSAGE = `A document can include at most ${LIMITS.maxSections} sections.`;

/**
 * Counts the UTF-8 bytes in a raw payload.
 *
 * Purpose: enforce the size limit before JSON.parse.
 * Inputs: payload, the unparsed request body or file text.
 * Side effects: none.
 */
export function payloadUtf8ByteLength(payload: string): number {
  // TextEncoder counts UTF-8 bytes. String length would treat é as one character.
  return new TextEncoder().encode(payload).byteLength;
}

/**
 * Reports whether a raw payload is within the shared byte limit.
 *
 * Purpose: the file and HTTP callers run this before JSON.parse.
 * Inputs: payload, the unparsed text. The 256 KiB ceiling is inclusive.
 * Side effects: none.
 */
export function isPayloadWithinLimit(payload: string): boolean {
  // Compare bytes with the shared ceiling. An exact 256 KiB payload is accepted.
  return payloadUtf8ByteLength(payload) <= LIMITS.maxPayloadBytes;
}
