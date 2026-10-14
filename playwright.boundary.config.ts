import { defineConfig } from "@playwright/test";
import { EDITOR_ORIGIN } from "./e2e/boundary/boundary-env.mjs";

/**
 * Playwright project for the credential boundary.
 *
 * The launcher starts the configuration service, or a stub, and the editor.
 * This file does not start the carousel fixture.
 */
export default defineConfig({
  testDir: "./e2e/boundary",
  testMatch: /credential-boundary\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  use: {
    baseURL: EDITOR_ORIGIN,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "node e2e/boundary/serve-boundary.mjs",
    url: EDITOR_ORIGIN,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
