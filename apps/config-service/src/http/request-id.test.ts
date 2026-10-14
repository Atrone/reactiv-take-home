import { describe, expect, it } from "vitest";
import { resolveRequestId } from "./request-id.js";

const token = "secret-token-value";
const generatedId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asserts that a safe caller id is kept.
 *
 * Purpose: an id inside the character rule is reflected.
 * Inputs: none.
 * Side effects: none.
 */
function expectSafeIdIsKept(): void {
  // Eighty allowed characters is the longest accepted id.
  const header = "a".repeat(80);
  expect(resolveRequestId(header, token)).toBe(header);
}

/**
 * Asserts that an unsafe id is replaced.
 *
 * Purpose: spaces, newlines, overlong values, duplicates, and the token itself are not reflected.
 * Inputs: header, the rejected value.
 * Side effects: none.
 */
function expectIdIsReplaced(header: string | string[]): void {
  const resolved = resolveRequestId(header, token);
  // The replacement is a UUID, not the caller text.
  expect(resolved).toMatch(generatedId);
  expect(resolved).not.toBe(header);
  expect(resolved).not.toContain(token);
}

/**
 * Asserts that the shortest safe id is kept.
 *
 * Purpose: one allowed character is inside the same rule as an eighty-character id.
 * Inputs: none.
 * Side effects: none.
 */
function expectSingleCharacterIdIsKept(): void {
  // A single letter has no space, newline, or token.
  expect(resolveRequestId("a", token)).toBe("a");
}

describe("request id", () => {
  it("keeps an id of eighty safe characters", expectSafeIdIsKept);

  it("replaces a too-long id", () => {
    expectIdIsReplaced("a".repeat(81));
  });

  it("replaces an id that contains a space", () => {
    expectIdIsReplaced("trace 01");
  });

  it("replaces an id that contains a newline", () => {
    expectIdIsReplaced("trace\n01");
  });

  it("replaces an empty id", () => {
    expectIdIsReplaced("");
  });

  it("replaces duplicate ids", () => {
    expectIdIsReplaced(["trace_01", "trace_02"]);
  });

  it("replaces an id that is the service token", () => {
    expectIdIsReplaced(token);
  });

  it("replaces an id that contains the service token", () => {
    expectIdIsReplaced(`x-${token}`);
  });

  it("keeps an id of one safe character", expectSingleCharacterIdIsKept);
});
