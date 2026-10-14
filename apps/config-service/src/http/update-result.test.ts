import { VALIDATION_FAILED_MESSAGE, type ErrorIssue } from "@reactiv/contracts";
import { describe, expect, it } from "vitest";
import {
  CONFIGURATION_NOT_FOUND_MESSAGE,
  PRECONDITION_FAILED_MESSAGE,
  PRECONDITION_REQUIRED_MESSAGE,
} from "./service-error.js";
import { mapUpdateFailure, type UpdateRouteFailure } from "./update-result.js";

/**
 * Asserts each update failure maps to its status.
 *
 * Purpose: 428, 412, 404, and 422 stay on the contract codes, and only validation carries issues.
 * Inputs: none.
 * Side effects: none.
 */
function expectMappedStatuses(): void {
  // A missing or weak If-Match never becomes a write.
  expect(mapUpdateFailure({ reason: "precondition-required" })).toEqual({
    statusCode: 428,
    code: "PRECONDITION_REQUIRED",
    message: PRECONDITION_REQUIRED_MESSAGE,
  });
  // The row is still there. The caller's revision is a different one.
  expect(mapUpdateFailure({ ok: false, reason: "revision-conflict" })).toEqual({
    statusCode: 412,
    code: "PRECONDITION_FAILED",
    message: PRECONDITION_FAILED_MESSAGE,
  });
  // This tenant has no such id. The update did not insert one.
  expect(mapUpdateFailure({ ok: false, reason: "not-found" })).toEqual({
    statusCode: 404,
    code: "NOT_FOUND",
    message: CONFIGURATION_NOT_FOUND_MESSAGE,
  });
  const validated = mapUpdateFailure({ ok: false, reason: "validation-failed", issues: [] });
  // An empty issue list stays present so the validation body still has issues.
  expect(validated).toEqual({
    statusCode: 422,
    code: "VALIDATION_FAILED",
    message: VALIDATION_FAILED_MESSAGE,
    issues: [],
  });
  expect(mapUpdateFailure({ reason: "precondition-required" }).issues).toBeUndefined();
  expect(mapUpdateFailure({ ok: false, reason: "revision-conflict" }).issues).toBeUndefined();
  expect(mapUpdateFailure({ ok: false, reason: "not-found" }).issues).toBeUndefined();
}

/**
 * Asserts field issues are copied without extra keys.
 *
 * Purpose: the mapped error keeps path and message, and a later edit of the source list does not change it.
 * Inputs: none.
 * Side effects: none.
 */
function expectValidationIssuesAreCopied(): void {
  const source: ErrorIssue[] = [
    { path: "data.sections[1].titleColor", message: "Use a #RGB or #RRGGBB color." },
    { path: "data.sections[2].url", message: "Use an absolute HTTP(S) URL." },
  ];
  const dirty = {
    path: "schemaVersion",
    message: "Only document schema version 1 is supported.",
    detail: "caller-supplied-detail",
  };
  const mapped = mapUpdateFailure({
    ok: false,
    reason: "validation-failed",
    issues: [...source, dirty as ErrorIssue],
  });
  // The extra key stays off the contract issue. The two field errors keep their text.
  expect(mapped.issues).toEqual([
    { path: "data.sections[1].titleColor", message: "Use a #RGB or #RRGGBB color." },
    { path: "data.sections[2].url", message: "Use an absolute HTTP(S) URL." },
    { path: "schemaVersion", message: "Only document schema version 1 is supported." },
  ]);
  source[0] = { path: "id", message: "changed after mapping" };
  // The mapped list is a copy. Changing the source does not change the response issues.
  expect(mapped.issues?.[0]).toEqual({
    path: "data.sections[1].titleColor",
    message: "Use a #RGB or #RRGGBB color.",
  });
  expect(mapped.issues?.[2]).not.toHaveProperty("detail");
}

/**
 * Asserts an unmapped reason does not leak into the error text.
 *
 * Purpose: a new repository reason has to be mapped on purpose. The thrown message is the fixed sentence.
 * Inputs: none.
 * Side effects: none.
 */
function expectUnknownReasonStaysGeneric(): void {
  const failure = { reason: "caller-supplied-reason" } as unknown as UpdateRouteFailure;
  let message = "";
  try {
    // The switch has no branch for this reason, so it throws before a response is built.
    mapUpdateFailure(failure);
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  // The caller-supplied reason is not part of the sentence.
  expect(message).toBe("Unexpected update failure.");
  expect(message).not.toContain("caller-supplied-reason");
}

describe("update failure mapping", () => {
  it("maps each update failure to its status", expectMappedStatuses);
  it("copies validation issues without extra keys", expectValidationIssuesAreCopied);
  it("hides an unexpected failure reason", expectUnknownReasonStaysGeneric);
});
