import { createServer } from "node:http";
import { CONFIGURATION_ID, FIXTURE_PORT, SERVICE_TOKEN, carouselFixtureConfiguration } from "./carousel-fixture.mjs";

/**
 * Reads one required environment variable.
 *
 * Purpose: the fixture refuses to listen when the editor would call it with a blank token or the wrong port.
 * Inputs: name, the variable to read.
 * Side effects: none. Throws when the value is missing or blank.
 */
function requiredEnv(name) {
  // The Playwright config sets these before the process starts.
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(`Missing ${name}`);
  }
  // Keep the original text so the bearer token matches the editor's header.
  return value;
}

/**
 * Sends one JSON response.
 *
 * Purpose: the editor's configuration client accepts a configuration body and an ETag header.
 * Inputs: response, the server response. status, the HTTP status. body, the JSON value. extraHeaders, optional headers.
 * Side effects: writes the response.
 */
function sendJson(response, status, body, extraHeaders = {}) {
  // The client parses JSON. A token is not added to the body.
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  response.end(payload);
}

/**
 * Serves GET /v1/configurations/:id for the Playwright editor.
 *
 * Purpose: the loader can hydrate a two-slide carousel without Postgres.
 * Inputs: none. The port, token, and configuration id come from the environment and the fixture module.
 * Side effects: listens on loopback until the process exits.
 */
function startFixtureService() {
  // The editor sends this token. A different token is not a configuration.
  const token = requiredEnv("CONFIG_SERVICE_TOKEN");
  const configurationId = requiredEnv("DEMO_CONFIGURATION_ID");
  const port = Number(requiredEnv("FIXTURE_PORT"));
  if (token !== SERVICE_TOKEN || configurationId !== CONFIGURATION_ID || port !== FIXTURE_PORT) {
    // The process and the fixture module must name the same stub.
    throw new Error("Fixture environment does not match carousel-fixture.mjs");
  }
  const configuration = carouselFixtureConfiguration();
  const expectedPath = `/v1/configurations/${encodeURIComponent(configurationId)}`;

  /**
   * Answers one configuration request.
   *
   * Purpose: return the fixture document for the one id this stub owns.
   * Inputs: request, the incoming call. response, the server response.
   * Side effects: writes a status and a body.
   */
  function handleRequest(request, response) {
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${token}`) {
      // The editor treats 401 as a setup failure. This stub does not describe the token.
      sendJson(response, 401, {
        error: { code: "UNAUTHORIZED", message: "Unauthorized.", requestId: "req_fixture" },
      });
      return;
    }
    // Node gives the path and query, not an absolute URL.
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === expectedPath) {
      // The strong tag is what a later save would send. This test does not save.
      sendJson(response, 200, configuration, { etag: '"1"' });
      return;
    }
    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Configuration not found.", requestId: "req_fixture" },
    });
  }

  const server = createServer(handleRequest);
  // Loopback only. Playwright reaches the editor, and the editor reaches this port.
  server.listen(port, "127.0.0.1");
}

startFixtureService();
