import { describe, expect, it } from "vitest";
import { healthStatus } from "./health.js";

/**
 * Checks the health helper payload.
 *
 * Purpose: prove the test runner executes an assertion for the health route.
 * Inputs: none.
 * Side effects: throws when the payload is not the ok status.
 */
function expectHealthStatusOk(): void {
  // Call the pure helper. It does not read configuration or the token.
  const body = healthStatus();
  // GET /health returns this object and nothing else.
  expect(body).toEqual({ status: "ok" });
}

/**
 * Registers the health sample with Vitest.
 *
 * Purpose: attach the runner proof to the health helper.
 * Inputs: none.
 * Side effects: registers one test.
 */
function registerHealthTests(): void {
  // The helper stays covered alongside the HTTP tests.
  it("returns the ok status", expectHealthStatusOk);
}

describe("healthStatus", registerHealthTests);
