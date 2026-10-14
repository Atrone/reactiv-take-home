import { describe, expect, it, vi } from "vitest";
import { openServicePool } from "./service-pool.js";

/**
 * Asserts the pool is created without opening a client.
 *
 * Purpose: construction must not query, even when the URL cannot connect.
 * Inputs: none.
 * Side effects: opens and ends a pool. No query is sent.
 */
async function expectConstructionDoesNotConnect(): Promise<void> {
  const pool = openServicePool("postgres://reactiv:reactiv@127.0.0.1:1/reactiv");
  try {
    // A client is opened on the first query. Construction leaves both counts at zero.
    expect(pool.totalCount).toBe(0);
    expect(pool.idleCount).toBe(0);
  } finally {
    await pool.end();
  }
}

/**
 * Asserts an idle client error does not log the connection string.
 *
 * Purpose: the pool listener writes one fixed sentence and drops the driver error.
 * Inputs: none.
 * Side effects: opens and ends a pool, and stubs console.error for the assertion.
 */
async function expectIdleErrorHidesTheConnectionString(): Promise<void> {
  const secret = "postgres://user:super-secret@127.0.0.1:1/reactiv";
  const pool = openServicePool(secret);
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {
    // The stub records the call. It does not print the driver error.
  });
  try {
    // The listener ignores the error argument, which repeats the URL.
    pool.emit("error", new Error(secret), secret);
    const logged = errorSpy.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(logged).toBe("The configuration database pool reported an idle client error.");
    expect(logged).not.toContain("super-secret");
    expect(logged).not.toContain("postgres://");
  } finally {
    errorSpy.mockRestore();
    await pool.end();
  }
}

describe("service pool", () => {
  it("does not connect while the pool is constructed", expectConstructionDoesNotConnect);
  it("logs an idle client error without the connection string", expectIdleErrorHidesTheConnectionString);
});
