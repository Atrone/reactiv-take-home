/** One fixed minute. This is a local guard, not a distributed quota. */
export const WRITE_WINDOW_MS = 60_000;

/** Counts authenticated write attempts inside one process. */
export type WriteRateLimit = {
  tryConsume(): boolean;
};

/**
 * Builds an in-memory write counter.
 *
 * Purpose: allow a fixed number of authenticated POST and PUT attempts per minute.
 * Inputs: limit, the number of attempts in the window. now, the clock. Tests can pass a fake clock.
 * Side effects: none until tryConsume is called. The counter stays in this process.
 */
export function createWriteRateLimit(limit: number, now: () => number = Date.now): WriteRateLimit {
  // The window starts when the server is built.
  let windowStartedAt = now();
  let count = 0;

  /**
   * Records one authenticated write attempt.
   *
   * Purpose: return false when this window is already full, without touching the database.
   * Inputs: none. The clock and the limit were fixed when the counter was built.
   * Side effects: increments the in-memory count when the attempt is allowed.
   */
  function tryConsume(): boolean {
    const current = now();
    // A new minute starts a new count. This is a fixed window, not a production quota.
    if (current - windowStartedAt >= WRITE_WINDOW_MS) {
      windowStartedAt = current;
      count = 0;
    }
    // The attempt that would exceed the limit is rejected and not counted past it.
    if (count >= limit) {
      return false;
    }
    count += 1;
    return true;
  }

  return { tryConsume };
}
