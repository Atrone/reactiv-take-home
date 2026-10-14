import { describe, expect, it } from "vitest";
import { createWriteRateLimit, WRITE_WINDOW_MS } from "./write-rate-limit.js";

/**
 * Asserts that the counter resets after one minute.
 *
 * Purpose: a full window rejects the next attempt, and the next window allows one again.
 * Inputs: none.
 * Side effects: none. The clock is a local number.
 */
function expectWindowResets(): void {
  // Start away from zero so the first window has a real timestamp.
  let current = 1_000;
  const limit = createWriteRateLimit(1, () => current);
  // The first attempt in the window is allowed.
  expect(limit.tryConsume()).toBe(true);
  // The second attempt in the same window is rejected and does not raise the count.
  expect(limit.tryConsume()).toBe(false);
  expect(limit.tryConsume()).toBe(false);
  // One millisecond before the minute ends, the window is still full.
  current += WRITE_WINDOW_MS - 1;
  expect(limit.tryConsume()).toBe(false);
  // The next minute starts a new count.
  current += 1;
  expect(limit.tryConsume()).toBe(true);
}

/**
 * Asserts that the limit is the number of allowed attempts.
 *
 * Purpose: two attempts are allowed when the limit is two, and the third is rejected.
 * Inputs: none.
 * Side effects: none.
 */
function expectLimitOfTwo(): void {
  const limit = createWriteRateLimit(2, () => 5_000);
  // Both attempts inside the limit are allowed.
  expect(limit.tryConsume()).toBe(true);
  expect(limit.tryConsume()).toBe(true);
  // The next attempt is rejected.
  expect(limit.tryConsume()).toBe(false);
}

describe("write rate limit", () => {
  it("resets the count after one minute", expectWindowResets);
  it("allows as many attempts as the limit", expectLimitOfTwo);
});
