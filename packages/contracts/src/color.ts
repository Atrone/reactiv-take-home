import { z } from "zod";

/** Three-digit or six-digit hex. The capture is the digits the normalizer expands. */
const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const HEX_COLOR_MESSAGE = "Use a #RGB or #RRGGBB color.";

/**
 * Normalizes a hex color to lowercase #rrggbb.
 *
 * Purpose: accept #RGB and #RRGGBB and return one stored form.
 * Inputs: input, the raw color string. Leading whitespace is not removed.
 * Side effects: none. Returns null when the color is outside schema version 1.
 */
export function normalizeHexColor(input: string): string | null {
  // Match three or six hex digits after one hash. Alpha and named colors fail.
  const match = HEX_COLOR_PATTERN.exec(input);
  if (match === null) {
    return null;
  }
  // Group 1 is the hex digits. A non-capturing group would leave this empty.
  const digits = match[1];
  if (digits === undefined) {
    return null;
  }
  const normalized = digits.toLowerCase();
  // Expand #RGB by repeating each digit so stored colors are six digits.
  if (normalized.length === 3) {
    const red = normalized[0];
    const green = normalized[1];
    const blue = normalized[2];
    if (red === undefined || green === undefined || blue === undefined) {
      return null;
    }
    return `#${red}${red}${green}${green}${blue}${blue}`;
  }
  return `#${normalized}`;
}

/**
 * Expands a color that already matched the hex pattern.
 *
 * Purpose: the schema stores lowercase #rrggbb after a successful parse.
 * Inputs: value, the raw color string.
 * Side effects: none.
 */
function expandHexColor(value: string): string {
  const normalized = normalizeHexColor(value);
  // A rejected color keeps its original text on the failed parse.
  if (normalized === null) {
    return value;
  }
  return normalized;
}

/**
 * Hex color schema used by text and CTA sections.
 *
 * Successful parses return lowercase #rrggbb. `.overwrite` keeps the value a
 * string so the generated JSON Schema can describe it; a Zod transform cannot.
 */
export const hexColorSchema = z.string().regex(HEX_COLOR_PATTERN, HEX_COLOR_MESSAGE).overwrite(expandHexColor);
