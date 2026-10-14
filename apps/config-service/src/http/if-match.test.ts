import { describe, expect, it } from "vitest";
import { parseStrongRevisionEtag, strongRevisionEtag } from "./if-match.js";

/**
 * Asserts the ETag text this service emits.
 *
 * Purpose: the strong validator is a quoted decimal revision, with no weak prefix.
 * Inputs: none.
 * Side effects: none.
 */
function expectEmittedEtagShape(): void {
  // Revision 1 is the create response. The quotes are part of the header value.
  expect(strongRevisionEtag(1)).toBe('"1"');
  expect(strongRevisionEtag(1).startsWith("W/")).toBe(false);
  expect(strongRevisionEtag(12)).toBe('"12"');
  // The parser accepts the same text the response header uses.
  expect(parseStrongRevisionEtag(strongRevisionEtag(1))).toEqual({ ok: true, revision: 1 });
  expect(parseStrongRevisionEtag(strongRevisionEtag(12))).toEqual({ ok: true, revision: 12 });
  expect(parseStrongRevisionEtag(strongRevisionEtag(2_147_483_647))).toEqual({ ok: true, revision: 2_147_483_647 });
}

/**
 * Asserts headers that are not one strong revision.
 *
 * Purpose: missing, *, weak, lists, and non-canonical numbers stay out of the update.
 * Inputs: none.
 * Side effects: none.
 */
function expectUnusablePreconditions(): void {
  const rejected: Array<string | string[] | undefined> = [
    undefined,
    "",
    "   ",
    "*",
    " * ",
    'W/"1"',
    'w/"1"',
    ' W/"1"',
    "W/1",
    'w/"12"',
    "1",
    '""',
    '"0"',
    '"01"',
    '"-1"',
    '"1.5"',
    '"*"',
    '" 1"',
    '"1 "',
    '"+1"',
    '"1",',
    '"1", "2"',
    ['"1"', '"2"'],
    ['"1"'],
    '"2147483648"',
    `"${"9".repeat(40)}"`,
  ];
  for (const header of rejected) {
    // Each of these is 428 at the route. None of them is a stored revision.
    expect(parseStrongRevisionEtag(header)).toEqual({ ok: false, reason: "precondition-required" });
  }
}

/**
 * Asserts a quoted revision with surrounding whitespace.
 *
 * Purpose: optional whitespace around the header does not change the revision.
 * Inputs: none.
 * Side effects: none.
 */
function expectTrimmedStrongEtag(): void {
  // The quotes remain after trim. The digits are the revision.
  expect(parseStrongRevisionEtag('  "1"  ')).toEqual({ ok: true, revision: 1 });
  expect(parseStrongRevisionEtag('\t"12"\n')).toEqual({ ok: true, revision: 12 });
  expect(parseStrongRevisionEtag('  "2147483647"  ')).toEqual({ ok: true, revision: 2_147_483_647 });
}

describe("strong revision ETag", () => {
  it("emits a quoted revision and parses that same text", expectEmittedEtagShape);
  it("rejects a missing, weak, star, or non-canonical If-Match", expectUnusablePreconditions);
  it("accepts a strong ETag surrounded by whitespace", expectTrimmedStrongEtag);
});
