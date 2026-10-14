import { timingSafeEqual } from "node:crypto";

/**
 * Reads the token from an Authorization header.
 *
 * Purpose: accept only a Bearer credential and treat every other shape as absent.
 * Inputs: header, the raw Authorization value.
 * Side effects: none. The token is not logged.
 */
function bearerValue(header: string | string[] | undefined): string {
  // Duplicate headers are not one credential.
  if (typeof header !== "string") {
    return "";
  }
  // The scheme and the token are split on the first space.
  const space = header.indexOf(" ");
  if (space <= 0) {
    return "";
  }
  const scheme = header.slice(0, space);
  // HTTP schemes are case-insensitive. The token after the space is not.
  if (scheme.toLowerCase() !== "bearer") {
    return "";
  }
  return header.slice(space + 1);
}

/**
 * Compares two credentials without an early return on the first differing byte.
 *
 * Purpose: avoid a comparison that stops at the first mismatch.
 * Inputs: supplied, the caller token. expected, the server token.
 * Side effects: none.
 */
function tokensMatch(supplied: string, expected: string): boolean {
  // Compare bytes so a multibyte character is not treated as one UTF-16 unit.
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  // Different lengths cannot match. Still run a compare so this branch does not return first.
  if (suppliedBytes.length !== expectedBytes.length) {
    timingSafeEqual(expectedBytes, expectedBytes);
    return false;
  }
  return timingSafeEqual(suppliedBytes, expectedBytes);
}

/**
 * Checks the Authorization header against the server token.
 *
 * Purpose: reject a missing, empty, non-bearer, or mismatched credential with one result.
 * Inputs: header, the raw Authorization value. expected, the server token, or undefined when it is not a credential.
 * Side effects: none. Neither value is logged.
 */
export function bearerIsValid(header: string | string[] | undefined, expected: string | undefined): boolean {
  // Missing and non-bearer headers become an empty supplied token.
  const supplied = bearerValue(header);
  // A server without a real token matches nothing. The compare still runs.
  if (expected === undefined) {
    const suppliedBytes = Buffer.from(supplied);
    timingSafeEqual(suppliedBytes, Buffer.alloc(suppliedBytes.length));
    return false;
  }
  return tokensMatch(supplied, expected);
}
