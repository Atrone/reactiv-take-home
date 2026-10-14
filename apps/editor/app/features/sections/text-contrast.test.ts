import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_COLOR_ERROR,
  LOW_CONTRAST_WARNING,
  MINIMUM_TEXT_CONTRAST_RATIO,
  TEXT_PREVIEW_BACKGROUND,
  TITLE_COLOR_ERROR,
  colorFieldError,
  contrastRatio,
  contrastWarning,
  relativeLuminance,
} from "./text-contrast.js";

/**
 * Asserts black on white has no contrast warning.
 *
 * Purpose: a ratio of 21:1 is above the 4.5:1 threshold.
 * Inputs: none.
 * Side effects: none.
 */
function expectBlackOnWhiteToPass(): void {
  // Black has no light. White is the full sRGB white the phone uses.
  expect(relativeLuminance("#000000")).toBe(0);
  expect(relativeLuminance("#ffffff")).toBe(1);
  expect(contrastRatio("#000000", TEXT_PREVIEW_BACKGROUND)).toBe(21);
  expect(contrastWarning("#000000", "#ffffff")).toBeNull();
  expect(contrastWarning("#000", TEXT_PREVIEW_BACKGROUND)).toBeNull();
}

/**
 * Asserts #777777 on white warns.
 *
 * Purpose: that gray is below 4.5:1 and must not be treated as passing.
 * Inputs: none.
 * Side effects: none.
 */
function expectGrayOnWhiteToWarn(): void {
  const ratio = contrastRatio("#777777", TEXT_PREVIEW_BACKGROUND);
  if (ratio === null) {
    // A valid gray has a ratio. A null result would hide the warning.
    throw new Error("Expected a contrast ratio for #777777 on white.");
  }
  // The ratio sits just under the threshold. 4.5 itself would not warn.
  expect(ratio).toBeGreaterThan(4);
  expect(ratio).toBeLessThan(MINIMUM_TEXT_CONTRAST_RATIO);
  expect(contrastWarning("#777777", "#ffffff")).toBe(LOW_CONTRAST_WARNING);
  expect(contrastWarning("#777", TEXT_PREVIEW_BACKGROUND)).toBe(LOW_CONTRAST_WARNING);
}

/**
 * Asserts an incomplete color does not warn and does not replace the message for a real error.
 *
 * Purpose: "#" and "#12" stay in the draft. Contrast waits until the string is a hex color.
 * Inputs: none.
 * Side effects: none.
 */
function expectIncompleteColorsToSkipTheWarning(): void {
  // Neither string is a schema color, so there is no ratio to compare with 4.5.
  expect(contrastWarning("#", TEXT_PREVIEW_BACKGROUND)).toBeNull();
  expect(contrastWarning("#12", TEXT_PREVIEW_BACKGROUND)).toBeNull();
  expect(contrastWarning("", TEXT_PREVIEW_BACKGROUND)).toBeNull();
  expect(colorFieldError("#", TITLE_COLOR_ERROR)).toBe(TITLE_COLOR_ERROR);
  expect(colorFieldError("#12", DESCRIPTION_COLOR_ERROR)).toBe(DESCRIPTION_COLOR_ERROR);
  expect(colorFieldError("", TITLE_COLOR_ERROR)).toBeNull();
  expect(colorFieldError("#123", TITLE_COLOR_ERROR)).toBeNull();
  expect(colorFieldError("#112233", DESCRIPTION_COLOR_ERROR)).toBeNull();
}

/**
 * Asserts the warning follows the computed ratio, including the 4.5 boundary.
 *
 * Purpose: a gray just above 4.5 passes, white on white warns, and the background argument is used.
 * Inputs: none.
 * Side effects: none.
 */
function expectTheContrastThresholdToUseBothColors(): void {
  const passingGray = contrastRatio("#767676", TEXT_PREVIEW_BACKGROUND);
  const sameEitherWay = contrastRatio("#000000", "#ffffff");
  // #767676 is the neighbor above the threshold. #777777 is the neighbor below it.
  expect(passingGray).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST_RATIO);
  expect(passingGray).toBeCloseTo(4.542, 2);
  expect(contrastWarning("#767676", "#ffffff")).toBeNull();
  // The same pair in either argument order is one ratio. Black on black is 1:1 and warns.
  expect(sameEitherWay).toBe(contrastRatio("#ffffff", "#000000"));
  expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
  expect(contrastWarning("#ffffff", TEXT_PREVIEW_BACKGROUND)).toBe(LOW_CONTRAST_WARNING);
  expect(contrastRatio("#000000", "#000000")).toBe(1);
  expect(contrastWarning("#000000", "#000000")).toBe(LOW_CONTRAST_WARNING);
}

/**
 * Asserts invalid colors have no luminance and no warning.
 *
 * Purpose: an incomplete or rejected string does not invent a ratio against the phone background.
 * Inputs: none.
 * Side effects: none.
 */
function expectInvalidColorsToHaveNoRatio(): void {
  // These strings are outside #RGB and #RRGGBB, so neither channel nor ratio exists.
  expect(relativeLuminance("#")).toBeNull();
  expect(relativeLuminance("#12")).toBeNull();
  expect(relativeLuminance("#GGGGGG")).toBeNull();
  expect(relativeLuminance("#11223344")).toBeNull();
  expect(contrastRatio("#000000", "#gggggg")).toBeNull();
  expect(contrastRatio("#", TEXT_PREVIEW_BACKGROUND)).toBeNull();
  expect(contrastWarning("#777777", "red")).toBeNull();
  expect(contrastWarning("#000000", "")).toBeNull();
}

/**
 * Asserts shorthand and letter case share one luminance.
 *
 * Purpose: the preview paints #RGB and #RRGGBB through the same normalized color.
 * Inputs: none.
 * Side effects: none.
 */
function expectShorthandAndLetterCaseToShareALuminance(): void {
  // #abc and #ABC are the same six-digit color. A light color on white warns.
  expect(relativeLuminance("#abc")).toBe(relativeLuminance("#AABBCC"));
  expect(relativeLuminance("#ABC")).toBe(relativeLuminance("#aabbcc"));
  expect(contrastWarning("#abc", TEXT_PREVIEW_BACKGROUND)).toBe(LOW_CONTRAST_WARNING);
  // Channel 10 is on the linear side of the sRGB curve. This ratio checks that branch.
  expect(contrastRatio("#0a0a0a", TEXT_PREVIEW_BACKGROUND)).toBeCloseTo(19.798, 2);
  expect(contrastWarning("#0a0a0a", TEXT_PREVIEW_BACKGROUND)).toBeNull();
}

/**
 * Asserts the field error matches the schema color rules.
 *
 * Purpose: a non-empty rejected color names the field, and a valid hex color does not.
 * Inputs: none.
 * Side effects: none.
 */
function expectColorFieldErrorToFollowTheSchemaColors(): void {
  const rejected = ["#GGGGGG", "#11223344", "#rrggbbaa", "#1234", "##112233", "red", "rgb(0, 0, 0)", " #123", "#123 ", "112233"];
  for (const color of rejected) {
    // The title message and the description message stay the ones the caller passed.
    expect(colorFieldError(color, TITLE_COLOR_ERROR)).toBe(TITLE_COLOR_ERROR);
    expect(colorFieldError(color, DESCRIPTION_COLOR_ERROR)).toBe(DESCRIPTION_COLOR_ERROR);
    expect(contrastWarning(color, TEXT_PREVIEW_BACKGROUND)).toBeNull();
  }
  // Uppercase and three-digit colors are valid. The draft can keep the typed characters.
  expect(colorFieldError("#AbC", TITLE_COLOR_ERROR)).toBeNull();
  expect(colorFieldError("#AABBCC", DESCRIPTION_COLOR_ERROR)).toBeNull();
  expect(colorFieldError("#abc", DESCRIPTION_COLOR_ERROR)).toBeNull();
}

/**
 * Registers the contrast cases.
 *
 * Purpose: the threshold and the two required pairs stay covered without rendering the editor.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerContrastCases(): void {
  // Black passes, gray warns, and an incomplete color is an error rather than a warning.
  it("does not warn for black text on the white phone background", expectBlackOnWhiteToPass);
  it("warns for #777777 text on the white phone background", expectGrayOnWhiteToWarn);
  it("skips the warning for an incomplete color and names a non-empty invalid color", expectIncompleteColorsToSkipTheWarning);
  it("passes a ratio of 4.5 or higher and warns for a color against itself", expectTheContrastThresholdToUseBothColors);
  it("returns no ratio for a color the schema rejects", expectInvalidColorsToHaveNoRatio);
  it("treats shorthand and uppercase hex as the same luminance", expectShorthandAndLetterCaseToShareALuminance);
  it("names rejected colors and accepts #RGB and uppercase #RRGGBB", expectColorFieldErrorToFollowTheSchemaColors);
}

describe("text contrast", registerContrastCases);
