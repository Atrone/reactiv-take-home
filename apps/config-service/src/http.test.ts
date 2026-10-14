import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "./server.js";

const tokenKey = "CONFIG_SERVICE_TOKEN";
const secretToken = "secret-token-value";
let savedToken: string | undefined;

/**
 * Remembers CONFIG_SERVICE_TOKEN.
 *
 * Purpose: restore the parent environment after a response test changes it.
 * Inputs: none.
 * Side effects: records the current token variable.
 */
function rememberToken(): void {
  savedToken = process.env[tokenKey];
}

/**
 * Restores CONFIG_SERVICE_TOKEN.
 *
 * Purpose: keep the response tests from leaking a token into later tests.
 * Inputs: none.
 * Side effects: writes the saved token value back to process.env.
 */
function restoreToken(): void {
  if (savedToken === undefined) {
    delete process.env[tokenKey];
  } else {
    process.env[tokenKey] = savedToken;
  }
}

/**
 * Collects service logs from an in-memory stream.
 *
 * Purpose: inspect log text without printing it during the test.
 * Inputs: none.
 * Side effects: creates a stream and retains the chunks written to it.
 */
function collectLogs(): { stream: PassThrough; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  // Retain each chunk so the assertions can search the log text.
  stream.on("data", (chunk: Buffer | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  return {
    stream,
    /**
     * Returns the logs collected so far.
     *
     * Purpose: give assertions one string to search.
     * Inputs: none.
     * Side effects: none.
     */
    text(): string {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

/**
 * Opens a server for one assertion and closes it afterward.
 *
 * Purpose: exercise HTTP routes without binding a port.
 * Inputs: run, the assertions to make against the server.
 * Side effects: creates and closes a Fastify instance and a log stream.
 */
async function withServer(run: (app: FastifyInstance, logs: () => string) => Promise<void>): Promise<void> {
  const logs = collectLogs();
  const app = buildServer("@reactiv/contracts", logs.stream, { writeRateLimitPerMinute: 600 });
  try {
    await run(app, logs.text);
  } finally {
    await app.close();
  }
}

/**
 * Asserts the health response and that a supplied token is not echoed.
 *
 * Purpose: GET /health returns only the ok status.
 * Inputs: none. The token is placed in the environment and on the request.
 * Side effects: sets CONFIG_SERVICE_TOKEN for the request, then the suite hook restores it.
 */
async function expectHealthOmitsTheToken(): Promise<void> {
  process.env[tokenKey] = secretToken;
  await withServer(async (app, logs) => {
    // Send the token in the places a client might accidentally put it.
    const response = await app.inject({
      method: "GET",
      url: `/health?access_token=${secretToken}`,
      headers: {
        authorization: `Bearer ${secretToken}`,
        origin: "https://evil.example",
        "x-config-token": secretToken,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.body).not.toContain(secretToken);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(logs()).not.toContain(secretToken);
  });
}

/**
 * Asserts that other methods and paths are not health.
 *
 * Purpose: GET /health is the public route. The configuration collection is not a list endpoint.
 * Inputs: none.
 * Side effects: injects requests into a temporary server.
 */
async function expectOnlyGetHealth(): Promise<void> {
  // A matching bearer token gets past authentication. There is no list route on the collection path.
  process.env[tokenKey] = secretToken;
  await withServer(async (app) => {
    const postHealth = await app.inject({ method: "POST", url: "/health" });
    const root = await app.inject({ method: "GET", url: "/" });
    const configurations = await app.inject({
      method: "GET",
      url: "/v1/configurations",
      headers: { authorization: `Bearer ${secretToken}` },
    });
    // Unregistered routes stay unavailable and still do not echo a token.
    expect(postHealth.statusCode).toBe(404);
    expect(root.statusCode).toBe(404);
    expect(configurations.statusCode).toBe(404);
    expect(configurations.body).not.toContain(secretToken);
    expect(configurations.headers["access-control-allow-origin"]).toBeUndefined();
  });
}

rememberToken();
afterEach(restoreToken);

describe("GET /health", () => {
  it("returns ok and does not echo the token or enable CORS", expectHealthOmitsTheToken);
  it("does not serve any other route", expectOnlyGetHealth);
});
