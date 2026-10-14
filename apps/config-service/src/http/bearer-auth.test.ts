import { describe, expect, it } from "vitest";
import { bearerIsValid } from "./bearer-auth.js";

const token = "secret-token-value";

/**
 * Asserts that a repeated Authorization header is not one credential.
 *
 * Purpose: an array of bearer values must not match, even when every entry is the token.
 * Inputs: none.
 * Side effects: none.
 */
function expectDuplicateAuthorizationIsRejected(): void {
  // A single header with the token is the credential the HTTP checks accept.
  expect(bearerIsValid(`Bearer ${token}`, token)).toBe(true);
  // Node can surface repeated headers as an array. That array is not a match.
  const header = [`Bearer ${token}`, `Bearer ${token}`];
  expect(bearerIsValid(header, token)).toBe(false);
}

describe("bearer comparison", () => {
  it("rejects a repeated Authorization header", expectDuplicateAuthorizationIsRejected);
});
