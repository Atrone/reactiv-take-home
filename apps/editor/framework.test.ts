import { describe, expect, it } from "vitest";
import config from "./react-router.config.js";

/**
 * Asserts the editor keeps the server runtime enabled.
 *
 * Purpose: framework mode must not be switched to a static shell.
 * Inputs: none.
 * Side effects: none.
 */
function expectServerRuntime(): void {
  expect(config.ssr).toBe(true);
}

describe("React Router framework config", () => {
  it("enables the server runtime", expectServerRuntime);
});
