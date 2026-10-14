import { describe, expect, it } from "vitest";
import {
  ALT_LIMIT_MESSAGE,
  CAROUSEL_IMAGE_LIMIT_MESSAGE,
  CTA_LABEL_LIMIT_MESSAGE,
  DESCRIPTION_LIMIT_MESSAGE,
  DOCUMENT_IMAGE_LIMIT_MESSAGE,
  LIMITS,
  SECTION_LIMIT_MESSAGE,
  TITLE_LIMIT_MESSAGE,
  URL_LIMIT_MESSAGE,
  isPayloadWithinLimit,
  payloadUtf8ByteLength,
} from "./index.js";

/**
 * Checks the architecture numbers stored in the shared limit object.
 *
 * Purpose: later prompts import these values instead of copying them.
 * Inputs: none.
 * Side effects: none.
 */
function matchesArchitectureLimits(): void {
  // 256 KiB is the inclusive UTF-8 ceiling.
  expect(LIMITS.maxPayloadBytes).toBe(262144);
  expect(LIMITS.maxSections).toBe(100);
  expect(LIMITS.maxImagesPerCarousel).toBe(20);
  expect(LIMITS.maxImagesPerDocument).toBe(100);
  expect(LIMITS.maxTitleCharacters).toBe(200);
  expect(LIMITS.maxDescriptionCharacters).toBe(5000);
  expect(LIMITS.minCtaLabelCharacters).toBe(1);
  expect(LIMITS.maxCtaLabelCharacters).toBe(120);
  expect(LIMITS.maxAltCharacters).toBe(300);
  expect(LIMITS.maxUrlCharacters).toBe(2048);
  // Each sentence includes the number from this table.
  expect(TITLE_LIMIT_MESSAGE).toContain(String(LIMITS.maxTitleCharacters));
  expect(DESCRIPTION_LIMIT_MESSAGE).toContain(String(LIMITS.maxDescriptionCharacters));
  expect(CTA_LABEL_LIMIT_MESSAGE).toContain(String(LIMITS.maxCtaLabelCharacters));
  expect(ALT_LIMIT_MESSAGE).toContain(String(LIMITS.maxAltCharacters));
  expect(URL_LIMIT_MESSAGE).toContain(String(LIMITS.maxUrlCharacters));
  expect(CAROUSEL_IMAGE_LIMIT_MESSAGE).toContain(String(LIMITS.maxImagesPerCarousel));
  expect(DOCUMENT_IMAGE_LIMIT_MESSAGE).toContain(String(LIMITS.maxImagesPerDocument));
  expect(SECTION_LIMIT_MESSAGE).toContain(String(LIMITS.maxSections));
}

/**
 * Accepts a payload of exactly 256 KiB and rejects one extra byte.
 *
 * Purpose: the size helper runs on raw text, before JSON.parse.
 * Inputs: none.
 * Side effects: none.
 */
function checksInclusivePayloadCeiling(): void {
  const withinLimit = "a".repeat(LIMITS.maxPayloadBytes);
  expect(payloadUtf8ByteLength(withinLimit)).toBe(262144);
  expect(isPayloadWithinLimit(withinLimit)).toBe(true);
  const oneByteOver = `${withinLimit}b`;
  expect(payloadUtf8ByteLength(oneByteOver)).toBe(262145);
  expect(isPayloadWithinLimit(oneByteOver)).toBe(false);
  // A short broken JSON value is a parse problem, not a size problem.
  expect(isPayloadWithinLimit("{")).toBe(true);
  expect(payloadUtf8ByteLength("")).toBe(0);
}

/**
 * Counts UTF-8 bytes for a character that uses more than one byte.
 *
 * Purpose: the helper must not use JavaScript string length.
 * Inputs: none.
 * Side effects: none.
 */
function countsUtf8Bytes(): void {
  // U+00E9 is two UTF-8 bytes. 131073 of them are 262146 bytes, still under 256 KiB characters.
  const multibyte = "\u00e9".repeat(131073);
  expect(multibyte.length).toBeLessThan(LIMITS.maxPayloadBytes);
  expect(payloadUtf8ByteLength(multibyte)).toBe(262146);
  expect(isPayloadWithinLimit(multibyte)).toBe(false);
}

/**
 * Attempts to replace the section ceiling.
 *
 * Purpose: show that the shared limit table rejects assignment.
 * Inputs: none.
 * Side effects: throws TypeError. The frozen table keeps its original value.
 */
function assignSectionLimit(): void {
  // Strict mode throws on assignment to a frozen property.
  (LIMITS as { maxSections: number }).maxSections = 50;
}

/**
 * Proves the shared limit table cannot be reassigned.
 *
 * Purpose: one process cannot change a limit for later checks.
 * Inputs: none.
 * Side effects: none. The assignment attempt throws.
 */
function keepsLimitsFrozen(): void {
  // Assignment throws, and the architecture value is still 100 afterward.
  expect(Object.isFrozen(LIMITS)).toBe(true);
  expect(assignSectionLimit).toThrow(TypeError);
  expect(LIMITS.maxSections).toBe(100);
}

/**
 * Accepts an exact 256 KiB payload made of multi-byte characters.
 *
 * Purpose: the inclusive ceiling is UTF-8 bytes, including 4-byte characters.
 * Inputs: none.
 * Side effects: none.
 */
function countsExactMultibyteBoundary(): void {
  // U+00E9 is two bytes, so 131072 of them are exactly 256 KiB.
  const exact = "\u00e9".repeat(131072);
  expect(exact.length).toBe(131072);
  expect(payloadUtf8ByteLength(exact)).toBe(262144);
  expect(isPayloadWithinLimit(exact)).toBe(true);
  // One emoji is a surrogate pair: two JavaScript characters and four UTF-8 bytes.
  const emoji = "\u{1F44D}";
  expect(emoji.length).toBe(2);
  expect(payloadUtf8ByteLength(emoji)).toBe(4);
  const exactEmojis = emoji.repeat(65536);
  expect(exactEmojis.length).toBeLessThan(LIMITS.maxPayloadBytes);
  expect(payloadUtf8ByteLength(exactEmojis)).toBe(262144);
  expect(isPayloadWithinLimit(exactEmojis)).toBe(true);
  expect(isPayloadWithinLimit(emoji.repeat(65537))).toBe(false);
}

/**
 * Registers payload-limit tests.
 *
 * Purpose: prove the byte helper before file or HTTP enforcement exists.
 * Inputs: none.
 * Side effects: registers Vitest cases.
 */
function registerLimitTests(): void {
  it("stores the architecture limits", matchesArchitectureLimits);
  it("accepts 256 KiB and rejects one byte over", checksInclusivePayloadCeiling);
  it("counts UTF-8 bytes rather than UTF-16 code units", countsUtf8Bytes);
  it("accepts an exact multi-byte 256 KiB payload", countsExactMultibyteBoundary);
  it("keeps the limit table frozen", keepsLimitsFrozen);
}

describe("payload limits", registerLimitTests);
