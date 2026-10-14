import { describe, expect, it } from "vitest";
import { isPgErrorCode } from "./pg-error.js";

/**
 * Asserts SQLSTATE matching uses the driver code and ignores message text.
 *
 * Purpose: a unique violation is code 23505. A check failure and a plain Error are not.
 * Inputs: none.
 * Side effects: none.
 */
function expectSqlStateMatching(): void {
  // The driver reports SQLSTATE as text.
  expect(isPgErrorCode({ code: "23505" }, "23505")).toBe(true);
  expect(isPgErrorCode({ code: "23505" }, "23514")).toBe(false);
  expect(isPgErrorCode({ code: 23505 }, "23505")).toBe(false);
  // A message that mentions a duplicate key is not a SQLSTATE.
  expect(isPgErrorCode(new Error("duplicate key value violates unique constraint"), "23505")).toBe(false);
  expect(isPgErrorCode(null, "23505")).toBe(false);
  expect(isPgErrorCode(undefined, "23505")).toBe(false);
  expect(isPgErrorCode("23505", "23505")).toBe(false);
}

/**
 * Registers the SQLSTATE suite.
 *
 * Purpose: keep the unique-violation check on the driver code.
 * Inputs: none.
 * Side effects: registers the test.
 */
function registerPgErrorTests(): void {
  it("matches a string SQLSTATE and ignores other failures", expectSqlStateMatching);
}

describe("postgres error codes", registerPgErrorTests);
