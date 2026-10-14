import { defineConfig } from "@playwright/test";
import { CONFIGURATION_ID, EDITOR_PORT, FIXTURE_PORT, SERVICE_TOKEN, TENANT_ID } from "./e2e/carousel-fixture.mjs";

const editorOrigin = `http://127.0.0.1:${EDITOR_PORT}`;

/**
 * Playwright settings for the carousel scroll check.
 *
 * The fixture server answers the editor's loader. Image bytes are fulfilled in the test.
 * Postgres is not started.
 */
export default defineConfig({
  testDir: "./e2e",
  // The credential-boundary project, the preview benchmark, and the reviewer journeys start their own servers.
  // Running any of them here would point it at the carousel fixture and the Vite dev server.
  testIgnore: ["**/boundary/**", "**/preview-benchmark.spec.ts", "**/journeys/**"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  use: {
    baseURL: editorOrigin,
    viewport: { width: 1280, height: 800 },
  },
  webServer: [
    {
      command: "node e2e/carousel-fixture-service.mjs",
      port: FIXTURE_PORT,
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        FIXTURE_PORT: String(FIXTURE_PORT),
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
