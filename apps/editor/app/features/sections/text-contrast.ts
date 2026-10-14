import { normalizeHexColor } from "@reactiv/contracts";

/** WCAG AA threshold for body text. A lower ratio warns and does not reject the color. */
export const MINIMUM_TEXT_CONTRAST_RATIO = 4.5;

/** Shown when the title color is valid and its contrast against the phone background is below 4.5:1. */
export const LOW_CONTRAST_WARNING = "Low contrast";

/**
 * Phone screen behind a text block.
 *
 * `.phone-screen` uses this white. Text contrast is measured against it.
 */
export const TEXT_PREVIEW_BACKGROUND = "#ffffff";

/** Preview title color when the field has never held a valid hex color. */
export const DEFAULT_TEXT_TITLE_COLOR = "#112233";

/** Preview description color when the field has never held a valid hex color. */
export const DEFAULT_TEXT_DESCRIPTION_COLOR = "#334455";

/** Inline error for a non-empty title color that is not #RGB or #RRGGBB. */
export const TITLE_COLOR_ERROR = "Title color must be a hex color like #112233.";

/** Inline error for a non-empty description color that is not #RGB or #RRGGBB. */
export const DESCRIPTION_COLOR_ERROR = "Description color must be a hex color like #112233.";

/**
 * Converts one sRGB channel to the linear light WCAG uses.
 *
 * Purpose: relative luminance needs the gamma-expanded channel, not the raw byte.
 * Inputs: channel, an integer from 0 through 255.
 * Side effects: none.
 */
function linearChannel(channel: number): number {
  // The byte becomes the 0–1 sRGB value the WCAG curve expects.
  const srgb = channel / 255;
  if (srgb <= 0.04045) {
    // Dark channels use the linear segment of the sRGB curve.
    return srgb / 12.92;
  }
  // The rest of the range uses the gamma exponent.
  return ((srgb + 0.055) / 1.055) ** 2.4;
}

/**
 * Reads the red, green, and blue bytes of a schema color.
 *
 * Purpose: luminance and contrast share one parse of #RGB and #RRGGBB.
 * Inputs: color, the raw or normalized hex string.
 * Side effects: none. Returns null when the string is not a schema color.
 */
function hexChannels(color: string): { red: number; green: number; blue: number } | null {
  // #RGB expands here. An incomplete string such as "#" or "#12" fails.
  const normalized = normalizeHexColor(color);
  if (normalized === null) {
    return null;
  }
  // Drop the hash. The next six characters are rr, gg, and bb.
  const digits = normalized.slice(1);
  const red = Number.parseInt(digits.slice(0, 2), 16);
  const green = Number.parseInt(digits.slice(2, 4), 16);
  const blue = Number.parseInt(digits.slice(4, 6), 16);
  if (!Number.isInteger(red) || !Number.isInteger(green) || !Number.isInteger(blue)) {
    return null;
  }
  return { red, green, blue };
}

/**
 * Computes the WCAG relative luminance of a hex color.
 *
 * Purpose: contrast compares two luminances. Invalid colors do not invent a luminance.
 * Inputs: color, a #RGB or #RRGGBB string.
 * Side effects: none. Returns null when the color is not valid.
 */
export function relativeLuminance(color: string): number | null {
  const channels = hexChannels(color);
  if (channels === null) {
    return null;
  }
  // The coefficients are the WCAG weights for red, green, and blue.
  const red = linearChannel(channels.red);
  const green = linearChannel(channels.green);
  const blue = linearChannel(channels.blue);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/**
 * Computes the WCAG contrast ratio of two hex colors.
 *
 * Purpose: the title warning compares the title color with the white phone background.
 * Inputs: foreground, the text color. background, the surface color.
 * Side effects: none. Returns null when either color is invalid.
 */
export function contrastRatio(foreground: string, background: string): number | null {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  if (foregroundLuminance === null || backgroundLuminance === null) {
    return null;
  }
  // The lighter surface is the numerator. Order of the arguments does not matter.
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Returns the low-contrast warning when a valid pair is below 4.5:1.
 *
 * Purpose: the inspector can warn without rejecting a color the schema would accept.
 * Inputs: foreground, the title color. background, the phone surface.
 * Side effects: none. Returns null for an invalid color and for a ratio of 4.5 or higher.
 */
export function contrastWarning(foreground: string, background: string): string | null {
  const ratio = contrastRatio(foreground, background);
  if (ratio === null) {
    // An in-progress color such as "#" has no ratio, so it does not warn.
    return null;
  }
  if (ratio < MINIMUM_TEXT_CONTRAST_RATIO) {
    return LOW_CONTRAST_WARNING;
  }
  return null;
}

/**
 * Returns the inline error for a color field, or null when the field may stay as it is.
 *
 * Purpose: a blank color is still being typed. A non-empty invalid color names the field.
 * Inputs: value, the raw draft string. message, the sentence that names the field.
 * Side effects: none.
 */
export function colorFieldError(value: string, message: string): string | null {
  if (value === "") {
    // Empty is in progress. The preview keeps the last valid color, and there is no error.
    return null;
  }
  if (normalizeHexColor(value) !== null) {
    // #RGB and #RRGGBB are accepted. The draft still keeps the characters the author typed.
    return null;
  }
  return message;
}
