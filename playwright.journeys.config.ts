import { defineConfig } from "@playwright/test";
import { CONFIGURATION_ID, CONTROL_PORT, EDITOR_PORT, FIXTURE_PORT, SERVICE_TOKEN, TENANT_ID } from "./e2e/journeys/journey-env.mjs";

const editorOrigin = `http://127.0.0.1:${EDITOR_PORT}`;

/**
 * Playwright project for the reviewer journeys.
 *
 * The fixture serves the six-section demo document and can close its port.
 * Image hosts are stubbed in the tests. Postgres is not started.
 */
export default defineConfig({
  testDir: "./e2e/journeys",
  testMatch: "**/journeys.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: editorOrigin,
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: "node e2e/journeys/journey-fixture.mjs",
      port: FIXTURE_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        FIXTURE_PORT: String(FIXTURE_PORT),
        CONTROL_PORT: String(CONTROL_PORT),
        CONFIG_SERVICE_TOKEN: SERVICE_TOKEN,
        DEMO_CONFIGURATION_ID: CONFIGURATION_ID,
      },
    },
    {
      command: "pnpm dev",
      cwd: "apps/editor",
      url: editorOrigin,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        EDITOR_PORT: String(EDITOR_PORT),
        CONFIG_SERVICE_URL: `http://127.0.0.1:${FIXTURE_PORT}`,
        CONFIG_SERVICE_TOKEN: SERVICE_TOKEN,
        DEMO_TENANT_ID: TENANT_ID,
        DEMO_CONFIGURATION_ID: CONFIGURATION_ID,
      },
    },
  ],
});
