import { z } from "zod";
import { LIMITS, URL_LIMIT_MESSAGE } from "./limits.js";

/** Failure text for a URL that is not absolute http(s) without credentials. */
export const ABSOLUTE_HTTP_URL_MESSAGE = "Use an absolute HTTP(S) URL.";

/**
 * Checks an image or CTA URL.
 *
 * Purpose: accept only absolute http(s) URLs without embedded credentials.
 * Inputs: input, the raw URL string. The maximum length is 2,048 characters.
 * Side effects: none.
 */
export function isAbsoluteHttpUrl(input: string): boolean {
  // Stop before the parser when the string is empty or over the character cap.
  if (input.length === 0 || input.length > LIMITS.maxUrlCharacters) {
    return false;
  }
  let parsed: URL;
  try {
    // A relative path throws. There is no base URL to resolve it against.
    parsed = new URL(input);
  } catch {
    return false;
  }
  // javascript:, data:, file:, and blob: are rejected here.
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  // An absolute HTTP URL names a host. `http://` alone does not.
  if (parsed.hostname.length === 0) {
    return false;
  }
  // user:password@host is embedded credentials, including a username alone.
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return false;
  }
  return true;
}

/**
 * Records a URL issue when the string is short enough to be a real URL.
 *
 * Purpose: keep the length message separate from the scheme message.
 * Inputs: payload, the Zod check state for one string.
 * Side effects: appends an issue when the URL policy fails.
 */
function checkAbsoluteHttpUrl(payload: z.core.ParsePayload<string>): void {
  // The max-length check already reported an over-long string.
  if (payload.value.length > LIMITS.maxUrlCharacters) {
    return;
  }
  if (isAbsoluteHttpUrl(payload.value)) {
    return;
  }
  payload.issues.push({
    code: "custom",
    message: ABSOLUTE_HTTP_URL_MESSAGE,
    input: payload.value,
  });
}

/** Absolute http(s) URL schema shared by carousel images and CTA links. */
export const httpUrlSchema = z.string().max(LIMITS.maxUrlCharacters, URL_LIMIT_MESSAGE).check(checkAbsoluteHttpUrl);
