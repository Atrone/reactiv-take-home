import { defineConfig } from "@playwright/test";
import { BENCHMARK_EDITOR_PORT } from "./e2e/preview-benchmark-fixture.mjs";

const editorOrigin = `http://127.0.0.1:${BENCHMARK_EDITOR_PORT}`;

/**
 * Playwright settings for the local preview benchmark.
 *
 * The web server builds the editor and serves that production build.
 * Retries stay off so a second run cannot replace the recorded samples.
 * Postgres is not started.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/preview-benchmark.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  use: {
    baseURL: editorOrigin,
    viewport: { width: 1440, height: 900 },
    headless: true,
  },
  webServer: {
    command: "node e2e/preview-benchmark-serve.mjs",
    url: editorOrigin,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
