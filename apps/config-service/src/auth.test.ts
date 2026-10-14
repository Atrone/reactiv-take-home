import { PassThrough } from "node:stream";
import { errorBodySchema, LIMITS, type EditableDocument, type ErrorCode } from "@reactiv/contracts";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConfigurationRepository,
  GetConfigurationResult,
  InsertConfigurationResult,
  UpdateConfigurationResult,
} from "./configurations/repository.js";
import { buildServer, type BuildServerOptions } from "./server.js";

const tokenKey = "CONFIG_SERVICE_TOKEN";
const tenantKey = "DEMO_TENANT_ID";
const rateKey = "RATE_LIMIT_WRITES_PER_MINUTE";
const serviceToken = "secret-token-value";
const demoTenantId = "tenant_demo";
const wrongToken = "wrong-token-value";
const attackerTenant = "tenant_attacker";
const leakedTitle = "Section Title Must Not Leak";
const demoDocument: EditableDocument = { schemaVersion: 1, data: { sections: [] } };
const generatedRequestId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Environment values from before this file mutates them. */
const originalEnv = new Map<string, string | undefined>();

/**
 * Remembers the auth-related environment.
 *
 * Purpose: restore variables after every test that mutates them.
 * Inputs: none.
 * Side effects: records the current values.
 */
function rememberEnv(): void {
  // Snapshot only the keys this file writes.
  for (const key of [tokenKey, tenantKey, rateKey]) {
    originalEnv.set(key, process.env[key]);
  }
}

/**
 * Puts the auth-related environment back.
 *
 * Purpose: keep one test from changing the next test's inputs.
 * Inputs: none.
 * Side effects: writes the original values back to process.env.
 */
function restoreEnv(): void {
  // Replace each key, including an unset value.
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Applies the local token and demo tenant for one test.
 *
 * Purpose: start from a known credential instead of the parent shell.
 * Inputs: none.
 * Side effects: mutates process.env until restoreEnv runs.
 */
function applyAuthEnv(): void {
  // The service token is a local dummy, not the example placeholder.
  process.env[tokenKey] = serviceToken;
  process.env[tenantKey] = demoTenantId;
  // The write limit comes from the server option in the tests that need a low number.
  delete process.env[rateKey];
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
 * Builds a repository spy.
 *
 * Purpose: prove whether authentication reached storage.
 * Inputs: none.
 * Side effects: none until a method is called.
 */
function createSpyRepository(): ConfigurationRepository {
  return {
    // A write that runs records itself and does not open Postgres.
    insertConfiguration: vi.fn(async (): Promise<InsertConfigurationResult> => {
      // The spy resolves without opening a database connection.
      return { ok: false, reason: "unique-violation" };
    }),
    // A read that runs is a failed test for the unauthenticated cases.
    getConfiguration: vi.fn(async (): Promise<GetConfigurationResult> => {
      // The default spy fails closed if a test reaches storage by mistake.
      throw new Error("repository should not be called");
    }),
    // An update that runs records itself and does not open Postgres.
    updateConfiguration: vi.fn(async (): Promise<UpdateConfigurationResult> => {
      // The spy resolves without opening a database connection.
      return { ok: false, reason: "not-found" };
    }),
  };
}

/**
 * Opens a server for one assertion and closes it afterward.
 *
 * Purpose: exercise HTTP routes without binding a port.
 * Inputs: options, the repository and write limit. run, the assertions.
 * Side effects: creates and closes a Fastify instance and a log stream.
 */
async function withApp(
  options: BuildServerOptions,
  run: (app: FastifyInstance, logs: () => string) => Promise<void>,
): Promise<void> {
  const logs = collectLogs();
  // Configuration routes stay off so these probes can occupy POST, GET, and PUT.
  const app = buildServer("@reactiv/contracts", logs.stream, {
    configurationRoutes: false,
    ...options,
  });
  try {
    await run(app, logs.text);
  } finally {
    await app.close();
  }
}

/**
 * Registers a read that calls the injected repository.
 *
 * Purpose: give authentication a handler that would touch storage if it ran.
 * Inputs: app, the server. The repository is the one injected into that server.
 * Side effects: registers one route.
 */
function registerReadProbe(app: FastifyInstance): void {
  // The handler is the stand-in for a later get route. This prompt does not register it in production.
  app.get<{ Params: { id: string } }>("/v1/configurations/:id", async (request) => {
    // The tenant argument is the server value, which the spy can observe.
    await request.server.configurationRepository.getConfiguration({
      tenantId: request.tenantId ?? "unset",
      id: request.params.id,
    });
    return { schemaVersion: 1, data: { sections: [{ title: leakedTitle }] } };
  });
}

/**
 * Registers write routes that call the injected repository.
 *
 * Purpose: prove a rate-limited attempt does not reach storage.
 * Inputs: app, the server.
 * Side effects: registers POST and PUT routes.
 */
function registerWriteProbes(app: FastifyInstance): void {
  // POST stands in for a later create route.
  app.post("/v1/configurations", async (request) => {
    await request.server.configurationRepository.insertConfiguration({
      tenantId: request.tenantId ?? "unset",
      id: "cfg_demo",
      document: demoDocument,
    });
    return { accepted: true };
  });
  // PUT stands in for a later update route.
  app.put<{ Params: { id: string } }>("/v1/configurations/:id", async (request) => {
    await request.server.configurationRepository.updateConfiguration({
      tenantId: request.tenantId ?? "unset",
      id: request.params.id,
      expectedRevision: 1,
      document: demoDocument,
    });
    return { accepted: true };
  });
}

/**
 * Asserts one contract error body.
 *
 * Purpose: require the status, code, message, and request id, and nothing else.
 * Inputs: response, the injected response. statusCode, code, and message, the expected error.
 * Side effects: none.
 */
function expectContractError(
  response: { statusCode: number; json: () => unknown; headers: Record<string, unknown> },
  statusCode: number,
  code: ErrorCode,
  message: string,
): void {
  // The header and the body use the same id.
  const requestId = response.headers["x-request-id"];
  expect(typeof requestId).toBe("string");
  const body = response.json();
  expect(response.statusCode).toBe(statusCode);
  expect(body).toEqual({
    error: {
      code,
      message,
      requestId,
    },
  });
  // The shared schema rejects a stack, token, or extra key.
  expect(errorBodySchema.safeParse(body).success).toBe(true);
  // Errors do not opt a browser into calling this service.
  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
}

/**
 * Asserts that health stays public.
 *
 * Purpose: GET /health without a token returns ok and does not echo the credential.
 * Inputs: none.
 * Side effects: injects one request.
 */
async function expectHealthWithoutAToken(): Promise<void> {
  await withApp({ repository: createSpyRepository() }, async (app, logs) => {
    // No Authorization header. Health must still answer.
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(response.body).not.toContain(serviceToken);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    // A bad credential and a query token stay out of health.
    const rejected = await app.inject({
      method: "GET",
      url: `/health?access_token=${serviceToken}`,
      headers: { authorization: `Bearer ${wrongToken}` },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toEqual({ status: "ok" });
    expect(rejected.body).not.toContain(serviceToken);
    expect(rejected.body).not.toContain(wrongToken);
    expect(logs()).not.toContain(serviceToken);
    expect(logs()).not.toContain(wrongToken);
  });
}

/**
 * Asserts that a missing token does not reach the repository.
 *
 * Purpose: authentication fails before the read probe runs.
 * Inputs: none.
 * Side effects: injects one request.
 */
async function expectMissingTokenSkipsTheRepository(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository }, async (app, logs) => {
    registerReadProbe(app);
    // The caller supplies a tenant and no credential.
    const response = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: {
        "x-tenant-id": attackerTenant,
        cookie: `session=${serviceToken}`,
      },
    });
    expectContractError(response, 401, "UNAUTHORIZED", "Authentication failed.");
    expect(response.body).not.toContain(serviceToken);
    expect(response.body).not.toContain(attackerTenant);
    expect(response.body).not.toContain("missing");
    expect(response.body).not.toContain(leakedTitle);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(repository.getConfiguration).not.toHaveBeenCalled();
    expect(logs()).toContain("UNAUTHORIZED");
    expect(logs()).toContain(String(response.headers["x-request-id"]));
    expect(logs()).not.toContain("guardV1");
    expect(logs()).not.toContain("ServiceHttpError");
    expect(logs()).not.toContain(serviceToken);
    expect(logs()).not.toContain("session=");
    expect(logs()).not.toContain(attackerTenant);
  });
}

/**
 * Asserts that a wrong token does not reach the repository.
 *
 * Purpose: a mismatched bearer token fails the same way as a missing one.
 * Inputs: authorization, the rejected header value.
 * Side effects: injects one request.
 */
async function expectRejectedCredentialSkipsTheRepository(authorization: string): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository }, async (app, logs) => {
    registerReadProbe(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: { authorization, "x-tenant-id": attackerTenant },
    });
    expectContractError(response, 401, "UNAUTHORIZED", "Authentication failed.");
    const suppliedToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : authorization;
    // An empty bearer token has nothing to echo. Any other supplied credential must stay out.
    if (suppliedToken.trim().length > 0) {
      expect(response.body).not.toContain(suppliedToken);
      expect(logs()).not.toContain(suppliedToken);
    }
    expect(response.body).not.toContain("replace-me");
    expect(response.body).not.toContain(leakedTitle);
    expect(repository.getConfiguration).not.toHaveBeenCalled();
    expect(logs()).not.toContain(serviceToken);
  });
}

/**
 * Asserts that the example placeholder is not a credential.
 *
 * Purpose: a server constructed with replace-me still rejects that bearer token.
 * Inputs: none.
 * Side effects: sets the token for one request, then the suite hook restores it.
 */
async function expectPlaceholderIsNotACredential(): Promise<void> {
  process.env[tokenKey] = "replace-me";
  const repository = createSpyRepository();
  await withApp({ repository }, async (app) => {
    registerReadProbe(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: { authorization: "Bearer replace-me" },
    });
    expectContractError(response, 401, "UNAUTHORIZED", "Authentication failed.");
    expect(response.body).not.toContain("replace-me");
    expect(repository.getConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts that a valid token does not invent configuration data.
 *
 * Purpose: an authenticated request to an unregistered path is a framework 404.
 * Inputs: none.
 * Side effects: injects one request.
 */
async function expectAuthenticatedUnknownPathIsNotConfiguration(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository }, async (app) => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "x-tenant-id": attackerTenant,
      },
    });
    // The route is not registered. The body is not a configuration document.
    expect(response.statusCode).toBe(404);
    expect(response.headers["x-request-id"]).toMatch(generatedRequestId);
    expect(response.body).not.toContain(serviceToken);
    expect(response.body).not.toContain("schemaVersion");
    expect(response.body).not.toContain("sections");
    expect(response.body).not.toContain(leakedTitle);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(repository.getConfiguration).not.toHaveBeenCalled();
    expect(repository.insertConfiguration).not.toHaveBeenCalled();
    expect(repository.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts that a repository exception becomes a safe 500.
 *
 * Purpose: the JSON has no stack, SQL, token, or document, and the log keeps the id and code.
 * Inputs: none.
 * Side effects: injects one request.
 */
async function expectRepositoryFailureIsSafe(): Promise<void> {
  const repository = createSpyRepository();
  const failure = new Error(`SELECT ${serviceToken} ${leakedTitle} FROM configurations`);
  // The message line holds the document. The frame is the part a log may keep.
  failure.stack = `${failure.stack ?? failure.message}\n    at getConfiguration (repository.ts:12:3)`;
  vi.mocked(repository.getConfiguration).mockRejectedValue(failure);
  await withApp({ repository }, async (app, logs) => {
    registerReadProbe(app);
    const response = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: {
        authorization: `Bearer ${serviceToken}`,
        cookie: `session=${serviceToken}`,
        "x-tenant-id": attackerTenant,
      },
    });
    expectContractError(response, 500, "INTERNAL", "The configuration service could not complete the request.");
    expect(response.body).not.toContain("stack");
    expect(response.body).not.toContain("SELECT");
    expect(response.body).not.toContain(serviceToken);
    expect(response.body).not.toContain(leakedTitle);
    expect(response.body).not.toContain("repository.ts");
    expect(repository.getConfiguration).toHaveBeenCalledTimes(1);
    expect(repository.getConfiguration).toHaveBeenCalledWith({
      tenantId: demoTenantId,
      id: "cfg_demo",
    });
    const logText = logs();
    expect(logText).toContain("INTERNAL");
    expect(logText).toContain("getConfiguration");
    expect(logText).toContain(String(response.headers["x-request-id"]));
    expect(logText).not.toContain(serviceToken);
    expect(logText).not.toContain(leakedTitle);
    expect(logText).not.toContain("SELECT");
    expect(logText).not.toContain(`session=${serviceToken}`);
  });
}

/**
 * Asserts the JSON write guards.
 *
 * Purpose: an oversized body, a wrong media type, and broken JSON fail before storage.
 * Inputs: none.
 * Side effects: injects several requests.
 */
async function expectWriteGuards(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository }, async (app) => {
    registerWriteProbes(app);
    const headers = {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "application/json",
    };
    // The declared length is over the ceiling, and the payload would be malformed if it were parsed.
    const declaredTooLarge = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        ...headers,
        "content-length": String(LIMITS.maxPayloadBytes + 1),
      },
      payload: "{",
    });
    expectContractError(declaredTooLarge, 413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    // The actual bytes are over the ceiling too.
    const oversized = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      headers,
      payload: Buffer.alloc(LIMITS.maxPayloadBytes + 1, 0x7b),
    });
    expectContractError(oversized, 413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    // A body at the ceiling is parsed, so this invalid JSON is 400 rather than 413.
    const atTheCeiling = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers,
      payload: Buffer.alloc(LIMITS.maxPayloadBytes, 0x7b),
    });
    expectContractError(atTheCeiling, 400, "MALFORMED_JSON", "The request body is not valid JSON.");
    const plain = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "content-type": "text/plain",
      },
      payload: "hello",
    });
    expectContractError(plain, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
    const plainPut = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "content-type": "text/plain",
      },
      payload: "hello",
    });
    expectContractError(plainPut, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
    const broken = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        ...headers,
        "content-type": "application/json; charset=utf-8",
      },
      payload: "{",
    });
    expectContractError(broken, 400, "MALFORMED_JSON", "The request body is not valid JSON.");
    expect(repository.insertConfiguration).not.toHaveBeenCalled();
    expect(repository.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts the local write limit.
 *
 * Purpose: the attempt after the limit does not call the repository, and a read is not counted.
 * Inputs: none.
 * Side effects: injects three requests.
 */
async function expectWriteLimitSkipsTheRepository(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository, writeRateLimitPerMinute: 1 }, async (app) => {
    registerWriteProbes(app);
    const headers = {
      authorization: `Bearer ${serviceToken}`,
      "content-type": "application/json",
    };
    // The first authenticated write is allowed through to the probe.
    const created = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers,
      payload: "{}",
    });
    expect(created.statusCode).toBe(200);
    expect(created.headers["access-control-allow-origin"]).toBeUndefined();
    expect(repository.insertConfiguration).toHaveBeenCalledTimes(1);
    // A read is not a write attempt.
    const read = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: { authorization: `Bearer ${serviceToken}` },
    });
    expect(read.statusCode).toBe(404);
    // The next write is rejected before the update probe.
    const limited = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      headers,
      payload: "{}",
    });
    expectContractError(limited, 429, "RATE_LIMITED", "Too many write requests.");
    expect(limited.body).not.toContain(leakedTitle);
    expect(repository.insertConfiguration).toHaveBeenCalledTimes(1);
    expect(repository.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts request ids on two responses, including a replaced header.
 *
 * Purpose: a safe id is echoed, and a too-long id is not reflected.
 * Inputs: none.
 * Side effects: injects several requests.
 */
async function expectRequestIds(): Promise<void> {
  await withApp({}, async (app) => {
    const health = await app.inject({ method: "GET", url: "/health" });
    const missing = await app.inject({ method: "GET", url: "/v1/configurations/cfg_demo" });
    const healthId = health.headers["x-request-id"];
    const missingId = missing.headers["x-request-id"];
    // Two responses each carry their own generated id.
    expect(healthId).toMatch(generatedRequestId);
    expect(missingId).toMatch(generatedRequestId);
    expect(healthId).not.toBe(missingId);
    expect(missing.json()).toMatchObject({ error: { requestId: missingId } });
    const tooLong = "a".repeat(81);
    const replaced = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: { "x-request-id": tooLong },
    });
    const replacedId = replaced.headers["x-request-id"];
    expect(replacedId).toMatch(generatedRequestId);
    expect(replacedId).not.toBe(tooLong);
    expect(replaced.body).not.toContain(tooLong);
    const spaced = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "trace 01" },
    });
    expect(spaced.headers["x-request-id"]).not.toBe("trace 01");
    const echoed = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "trace_01" },
    });
    expect(echoed.headers["x-request-id"]).toBe("trace_01");
  });
}

/**
 * Builds the headers for one authenticated JSON write.
 *
 * Purpose: repeat the bearer token and media type in the write cases.
 * Inputs: contentType, the Content-Type value. The default is application/json.
 * Side effects: none.
 */
function jsonWriteHeaders(contentType = "application/json"): Record<string, string> {
  // Case and spacing tests pass their own Authorization header.
  return {
    authorization: `Bearer ${serviceToken}`,
    "content-type": contentType,
  };
}

/**
 * Asserts that the bearer scheme is case-insensitive.
 *
 * Purpose: bearer and BEARER with the exact token both reach the repository.
 * Inputs: none.
 * Side effects: injects two requests.
 */
async function expectBearerSchemeIsCaseInsensitive(): Promise<void> {
  const repository = createSpyRepository();
  // The probe calls the spy, so the spy must resolve instead of throwing.
  vi.mocked(repository.getConfiguration).mockResolvedValue({ ok: false, reason: "not-found" });
  await withApp({ repository }, async (app) => {
    app.get<{ Params: { id: string } }>("/v1/configurations/:id", async (request) => {
      // A successful read records the server tenant.
      await request.server.configurationRepository.getConfiguration({
        tenantId: request.tenantId ?? "unset",
        id: request.params.id,
      });
      return { ok: true };
    });
    // Both spellings of the scheme are the same credential.
    for (const scheme of ["bearer", "BEARER"]) {
      const response = await app.inject({
        method: "GET",
        url: "/v1/configurations/cfg_demo",
        headers: { authorization: `${scheme} ${serviceToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    }
    expect(repository.getConfiguration).toHaveBeenCalledTimes(2);
    expect(repository.getConfiguration).toHaveBeenCalledWith({
      tenantId: demoTenantId,
      id: "cfg_demo",
    });
  });
}

/**
 * Asserts that surrounding spaces are part of the credential.
 *
 * Purpose: a padded server token matches only the same padded bearer value.
 * Inputs: none.
 * Side effects: changes CONFIG_SERVICE_TOKEN until the suite hook restores it.
 */
async function expectPaddedTokenIsTheCredential(): Promise<void> {
  const padded = `  ${serviceToken}  `;
  process.env[tokenKey] = padded;
  const repository = createSpyRepository();
  vi.mocked(repository.getConfiguration).mockResolvedValue({ ok: false, reason: "not-found" });
  await withApp({ repository }, async (app, logs) => {
    app.get<{ Params: { id: string } }>("/v1/configurations/:id", async (request) => {
      // A successful read records the server tenant.
      await request.server.configurationRepository.getConfiguration({
        tenantId: request.tenantId ?? "unset",
        id: request.params.id,
      });
      return { ok: true };
    });
    // The trimmed token is a different credential.
    const trimmed = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: { authorization: `Bearer ${serviceToken}` },
    });
    expectContractError(trimmed, 401, "UNAUTHORIZED", "Authentication failed.");
    expect(repository.getConfiguration).not.toHaveBeenCalled();
    // The raw value, including the spaces, is the credential.
    const matched = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: { authorization: `Bearer ${padded}` },
    });
    expect(matched.statusCode).toBe(200);
    expect(repository.getConfiguration).toHaveBeenCalledTimes(1);
    expect(logs()).not.toContain(serviceToken);
  });
}

/**
 * Asserts that a query token does not authenticate.
 *
 * Purpose: access_token in the URL is not a credential, and it is not logged.
 * Inputs: none.
 * Side effects: injects two requests.
 */
async function expectQueryTokenDoesNotAuthenticate(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository }, async (app, logs) => {
    registerReadProbe(app);
    const url = `/v1/configurations/cfg_demo?access_token=${serviceToken}`;
    // The query alone is not Authorization.
    const queryOnly = await app.inject({ method: "GET", url });
    expectContractError(queryOnly, 401, "UNAUTHORIZED", "Authentication failed.");
    // A wrong header is not rescued by the right token in the query.
    const queryAndWrongHeader = await app.inject({
      method: "GET",
      url,
      headers: { authorization: `Bearer ${wrongToken}` },
    });
    expectContractError(queryAndWrongHeader, 401, "UNAUTHORIZED", "Authentication failed.");
    expect(queryOnly.body).not.toContain(serviceToken);
    expect(queryAndWrongHeader.body).not.toContain(serviceToken);
    expect(queryAndWrongHeader.body).not.toContain(wrongToken);
    expect(logs()).not.toContain(serviceToken);
    expect(logs()).not.toContain(wrongToken);
    expect(repository.getConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts the private prefix is /v1 and not a longer path.
 *
 * Purpose: /v1 and /v1/ require a credential, and /v1evil does not.
 * Inputs: none.
 * Side effects: injects three requests.
 */
async function expectV1PrefixIsExact(): Promise<void> {
  await withApp({}, async (app) => {
    app.get("/v1evil", async (request) => {
      // The public route reports the tenant the guard attached, which should stay empty.
      return { tenantId: request.tenantId };
    });
    const outside = await app.inject({
      method: "GET",
      url: "/v1evil",
      headers: { "x-tenant-id": attackerTenant },
    });
    expect(outside.statusCode).toBe(200);
    expect(outside.json()).toEqual({ tenantId: null });
    expect(outside.body).not.toContain(attackerTenant);
    const root = await app.inject({ method: "GET", url: "/v1" });
    expectContractError(root, 401, "UNAUTHORIZED", "Authentication failed.");
    const slash = await app.inject({ method: "GET", url: "/v1/" });
    expectContractError(slash, 401, "UNAUTHORIZED", "Authentication failed.");
  });
}

/**
 * Asserts that authentication runs before the body checks.
 *
 * Purpose: an unauthenticated write is 401, not 413 or 415, and it does not use a write slot.
 * Inputs: none.
 * Side effects: injects four requests.
 */
async function expectAuthenticationRunsBeforeBodyChecks(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository, writeRateLimitPerMinute: 1 }, async (app) => {
    registerWriteProbes(app);
    const plain = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: { "content-type": "text/plain" },
      payload: "hello",
    });
    expectContractError(plain, 401, "UNAUTHORIZED", "Authentication failed.");
    const declaredTooLarge = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: { "content-length": String(LIMITS.maxPayloadBytes + 1) },
      payload: "{",
    });
    expectContractError(declaredTooLarge, 401, "UNAUTHORIZED", "Authentication failed.");
    const oversized = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      payload: Buffer.alloc(LIMITS.maxPayloadBytes + 1, 0x7b),
    });
    expectContractError(oversized, 401, "UNAUTHORIZED", "Authentication failed.");
    // The three failures left the one allowed write available.
    const created = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expect(created.statusCode).toBe(200);
    expect(repository.insertConfiguration).toHaveBeenCalledTimes(1);
    expect(repository.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts that the tenant comes from the server environment.
 *
 * Purpose: X-Tenant-Id and a body tenantId are ignored, and a blank setting stays empty.
 * Inputs: none.
 * Side effects: changes DEMO_TENANT_ID until the suite hook restores it.
 */
async function expectTenantComesFromTheEnvironment(): Promise<void> {
  await withApp({}, async (app) => {
    app.get("/v1/configurations/:id", async (request) => {
      // The response is the tenant the guard stored, not the caller's header.
      return { tenantId: request.tenantId };
    });
    app.post("/v1/configurations", async (request) => {
      // A body tenantId is not copied onto the request.
      return { tenantId: request.tenantId };
    });
    const headers = {
      authorization: `Bearer ${serviceToken}`,
      "x-tenant-id": attackerTenant,
    };
    const fromHeader = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers,
    });
    expect(fromHeader.json()).toEqual({ tenantId: demoTenantId });
    expect(fromHeader.body).not.toContain(attackerTenant);
    const fromBody = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: { ...headers, "content-type": "application/json" },
      payload: JSON.stringify({ tenantId: attackerTenant }),
    });
    expect(fromBody.json()).toEqual({ tenantId: demoTenantId });
    expect(fromBody.body).not.toContain(attackerTenant);
    // A blank setting is not filled in from the header.
    process.env[tenantKey] = "   ";
    const blank = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers,
    });
    expect(blank.json()).toEqual({ tenantId: null });
    expect(blank.body).not.toContain(attackerTenant);
    delete process.env[tenantKey];
    const missing = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers,
    });
    expect(missing.json()).toEqual({ tenantId: null });
    expect(missing.body).not.toContain(attackerTenant);
    expect(missing.body).not.toContain(demoTenantId);
  });
}

/**
 * Asserts the JSON media-type rules.
 *
 * Purpose: only application/json is parsed, and an empty or broken body is malformed JSON.
 * Inputs: none.
 * Side effects: injects several requests.
 */
async function expectJsonMediaTypeRules(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository }, async (app) => {
    registerWriteProbes(app);
    const brokenJson = ["Application/JSON", " application/json", "application/json ; charset=UTF-8"];
    // These are JSON, so the broken body is 400 rather than 415.
    for (const contentType of brokenJson) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/configurations",
        headers: jsonWriteHeaders(contentType),
        payload: "{",
      });
      expectContractError(response, 400, "MALFORMED_JSON", "The request body is not valid JSON.");
    }
    const rejectedTypes = ["application/jsonx", "text/json", "; charset=utf-8"];
    for (const contentType of rejectedTypes) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/configurations",
        headers: jsonWriteHeaders(contentType),
        payload: "{}",
      });
      expectContractError(response, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
    }
    // A string payload does not invent a JSON content type.
    const missingType = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: "hello",
    });
    expectContractError(missingType, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
    const empty = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        ...jsonWriteHeaders(),
        "content-length": "0",
      },
      payload: Buffer.alloc(0),
    });
    expectContractError(empty, 400, "MALFORMED_JSON", "The request body is not valid JSON.");
    const whitespace = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      headers: jsonWriteHeaders(),
      payload: "   ",
    });
    expectContractError(whitespace, 400, "MALFORMED_JSON", "The request body is not valid JSON.");
    // A read is not checked as a write, even with a non-JSON content type.
    const read = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "content-type": "text/plain",
      },
    });
    expect(read.statusCode).toBe(404);
    expect(read.body).not.toContain("UNSUPPORTED_MEDIA_TYPE");
    expect(repository.insertConfiguration).not.toHaveBeenCalled();
    expect(repository.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts that valid JSON is not rejected by the parser.
 *
 * Purpose: null, an array, and a boolean reach the write handler.
 * Inputs: none.
 * Side effects: injects three requests.
 */
async function expectValidJsonReachesTheProbe(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository }, async (app) => {
    registerWriteProbes(app);
    // None of these is an object. All of them are JSON.
    for (const payload of ["null", "[]", "true"]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/configurations",
        headers: jsonWriteHeaders(),
        payload,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: true });
    }
    expect(repository.insertConfiguration).toHaveBeenCalledTimes(3);
  });
}

/**
 * Asserts that a parsed document stays out of the 500 log.
 *
 * Purpose: a stack frame that echoes the body loses the document, including one that contains the token.
 * Inputs: none.
 * Side effects: injects two requests.
 */
async function expectParsedDocumentIsRedactedFromTheLog(): Promise<void> {
  await withApp({}, async (app, logs) => {
    app.post("/v1/configurations", async (request) => {
      const error = new Error("save failed");
      // The frame stands in for a stack line that copied the parsed body.
      const document = JSON.stringify(request.body);
      error.stack = `Error: save failed\n    at save (${document})`;
      throw error;
    });
    const bodies = [{ title: leakedTitle }, { title: leakedTitle, token: serviceToken }];
    for (const body of bodies) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/configurations",
        headers: jsonWriteHeaders(),
        payload: JSON.stringify(body),
      });
      expectContractError(response, 500, "INTERNAL", "The configuration service could not complete the request.");
      expect(response.body).not.toContain(leakedTitle);
      expect(response.body).not.toContain(serviceToken);
    }
    const logText = logs();
    expect(logText).toContain("at save");
    expect(logText).toContain("[redacted]");
    expect(logText).not.toContain(leakedTitle);
    expect(logText).not.toContain(serviceToken);
  });
}

/**
 * Asserts that an unexpected failure stays internal.
 *
 * Purpose: a driver code and a non-error message are not copied into the JSON or the log.
 * Inputs: none.
 * Side effects: injects two requests.
 */
async function expectUnknownFailureStaysInternal(): Promise<void> {
  await withApp({}, async (app, logs) => {
    app.get("/v1/configurations/:id", async () => {
      // The message and driver code must not become the HTTP error.
      const failure = new Error(`connect ECONNREFUSED postgres://user:password@127.0.0.1/reactiv ${serviceToken}`);
      Object.assign(failure, { code: "ECONNREFUSED" });
      throw failure;
    });
    app.post("/v1/configurations", async () => {
      // A plain object is not an Error, so it has no stack to copy.
      throw { code: "28P01", message: `postgres://user:${serviceToken}@localhost/reactiv` };
    });
    const read = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: { authorization: `Bearer ${serviceToken}` },
    });
    expectContractError(read, 500, "INTERNAL", "The configuration service could not complete the request.");
    const write = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expectContractError(write, 500, "INTERNAL", "The configuration service could not complete the request.");
    const logText = logs();
    for (const secret of ["ECONNREFUSED", "28P01", "postgres://", "password", serviceToken]) {
      expect(read.body).not.toContain(secret);
      expect(write.body).not.toContain(secret);
      expect(logText).not.toContain(secret);
    }
    expect(logText).toContain("INTERNAL");
  });
}

/**
 * Asserts that the process write limit is used when a server does not override it.
 *
 * Purpose: RATE_LIMIT_WRITES_PER_MINUTE of 1 allows one authenticated write.
 * Inputs: none.
 * Side effects: sets the rate-limit variable until the suite hook restores it.
 */
async function expectEnvironmentWriteLimitIsEnforced(): Promise<void> {
  process.env[rateKey] = "1";
  const repository = createSpyRepository();
  await withApp({ repository }, async (app) => {
    registerWriteProbes(app);
    const first = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expectContractError(second, 429, "RATE_LIMITED", "Too many write requests.");
    expect(repository.insertConfiguration).toHaveBeenCalledTimes(1);
  });
}

/**
 * Asserts that each server has its own write count.
 *
 * Purpose: filling one server does not fill another server in the same process.
 * Inputs: none.
 * Side effects: injects one request on each of two servers.
 */
async function expectWriteCountersArePerServer(): Promise<void> {
  const firstRepository = createSpyRepository();
  const secondRepository = createSpyRepository();
  await withApp({ repository: firstRepository, writeRateLimitPerMinute: 1 }, async (app) => {
    registerWriteProbes(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expect(response.statusCode).toBe(200);
  });
  await withApp({ repository: secondRepository, writeRateLimitPerMinute: 1 }, async (app) => {
    registerWriteProbes(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expect(response.statusCode).toBe(200);
    expect(secondRepository.insertConfiguration).toHaveBeenCalledTimes(1);
  });
  expect(firstRepository.insertConfiguration).toHaveBeenCalledTimes(1);
}

/**
 * Asserts that a rejected authenticated write still uses a slot.
 *
 * Purpose: 415 and 413 count, so the next JSON write is rate limited.
 * Inputs: none.
 * Side effects: injects three requests.
 */
async function expectRejectedWritesConsumeTheQuota(): Promise<void> {
  const repository = createSpyRepository();
  await withApp({ repository, writeRateLimitPerMinute: 2 }, async (app) => {
    registerWriteProbes(app);
    const plain = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders("text/plain"),
      payload: "hello",
    });
    expectContractError(plain, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
    const oversized = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      headers: jsonWriteHeaders(),
      payload: Buffer.alloc(LIMITS.maxPayloadBytes + 1, 0x7b),
    });
    expectContractError(oversized, 413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    const limited = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expectContractError(limited, 429, "RATE_LIMITED", "Too many write requests.");
    expect(repository.insertConfiguration).not.toHaveBeenCalled();
    expect(repository.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts that a server option overrides the environment write limit.
 *
 * Purpose: a valid per-server limit is used even when the environment value is unusable.
 * Inputs: none.
 * Side effects: sets the rate-limit variable until the suite hook restores it.
 */
async function expectWriteLimitOptionOverridesTheEnvironment(): Promise<void> {
  process.env[rateKey] = "nope";
  const repository = createSpyRepository();
  await withApp({ repository, writeRateLimitPerMinute: 1 }, async (app) => {
    registerWriteProbes(app);
    const first = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonWriteHeaders(),
      payload: "{}",
    });
    expectContractError(second, 429, "RATE_LIMITED", "Too many write requests.");
    expect(repository.insertConfiguration).toHaveBeenCalledTimes(1);
  });
}

/**
 * Asserts that an unusable write limit refuses to build a server.
 *
 * Purpose: zero, a fraction, a negative number, and a non-numeric environment value name the variable and not the value.
 * Inputs: none.
 * Side effects: sets the rate-limit variable until the suite hook restores it.
 */
function expectUnusableWriteLimitsRefuseToBuild(): void {
  const expected = "Invalid environment variable: RATE_LIMIT_WRITES_PER_MINUTE";
  // Each bad override throws before the server listens.
  for (const value of [0, -1, 1.5]) {
    let message = "";
    try {
      buildServer("@reactiv/contracts", undefined, { writeRateLimitPerMinute: value });
    } catch (error) {
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toBe(expected);
  }
  process.env[rateKey] = "nope";
  let envMessage = "";
  try {
    buildServer("@reactiv/contracts", undefined, {});
  } catch (error) {
    envMessage = error instanceof Error ? error.message : "";
  }
  expect(envMessage).toBe(expected);
  expect(envMessage).not.toContain("nope");
}

/**
 * Asserts the remaining request-id rules on HTTP responses.
 *
 * Purpose: echo a safe id, and replace an id that is or contains the service token.
 * Inputs: none.
 * Side effects: injects several requests.
 */
async function expectRequestIdEdges(): Promise<void> {
  await withApp({}, async (app, logs) => {
    const tokenId = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": serviceToken },
    });
    expect(tokenId.headers["x-request-id"]).toMatch(generatedRequestId);
    expect(tokenId.body).not.toContain(serviceToken);
    const embedded = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: { "x-request-id": `x-${serviceToken}` },
    });
    const embeddedId = String(embedded.headers["x-request-id"]);
    expect(embeddedId).toMatch(generatedRequestId);
    expect(embeddedId).not.toContain(serviceToken);
    expect(embedded.body).not.toContain(serviceToken);
    const longest = "b".repeat(80);
    const kept = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": longest },
    });
    expect(kept.headers["x-request-id"]).toBe(longest);
    const shortest = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "a" },
    });
    expect(shortest.headers["x-request-id"]).toBe("a");
    const hyphen = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": "trace-01" },
    });
    expect(hyphen.headers["x-request-id"]).toBe("trace-01");
    // A repeated header arrives joined, and that joined value is not reflected.
    const duplicate = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-request-id": ["trace_01", "trace_02"] },
    });
    expect(duplicate.headers["x-request-id"]).not.toBe("trace_01");
    expect(duplicate.headers["x-request-id"]).not.toBe("trace_02");
    expect(duplicate.headers["x-request-id"]).toMatch(generatedRequestId);
    expect(logs()).not.toContain(serviceToken);
  });
}

rememberEnv();
beforeEach(applyAuthEnv);
afterEach(restoreEnv);

describe("configuration service authentication", () => {
  it("returns health without a token", expectHealthWithoutAToken);
  it("rejects a missing token before the repository", expectMissingTokenSkipsTheRepository);

  it("rejects a wrong token before the repository", () => {
    return expectRejectedCredentialSkipsTheRepository(`Bearer ${wrongToken}`);
  });

  it("rejects a same-length wrong token before the repository", () => {
    return expectRejectedCredentialSkipsTheRepository("Bearer xxxxxxxxxxxxxxxxxx");
  });

  it("rejects an empty bearer token before the repository", () => {
    return expectRejectedCredentialSkipsTheRepository("Bearer ");
  });

  it("rejects a non-bearer credential before the repository", () => {
    return expectRejectedCredentialSkipsTheRepository(`Basic ${wrongToken}`);
  });

  it("accepts a bearer scheme in any case", expectBearerSchemeIsCaseInsensitive);

  it("rejects a token that differs by case", () => {
    return expectRejectedCredentialSkipsTheRepository(`Bearer ${serviceToken.toUpperCase()}`);
  });

  it("rejects a bearer token with an extra space", () => {
    return expectRejectedCredentialSkipsTheRepository(`Bearer  ${serviceToken}`);
  });

  it("rejects a bearer token with a trailing space", () => {
    return expectRejectedCredentialSkipsTheRepository(`Bearer ${serviceToken} `);
  });

  it("rejects a scheme glued to the token", () => {
    return expectRejectedCredentialSkipsTheRepository(`Bearer${serviceToken}`);
  });

  it("treats surrounding spaces as part of the credential", expectPaddedTokenIsTheCredential);
  it("does not accept a token from the query string", expectQueryTokenDoesNotAuthenticate);
  it("authenticates /v1 and leaves a longer prefix public", expectV1PrefixIsExact);
  it("rejects an unauthenticated write before the body checks", expectAuthenticationRunsBeforeBodyChecks);
  it("takes the tenant from the environment", expectTenantComesFromTheEnvironment);
  it("rejects the example placeholder as a credential", expectPlaceholderIsNotACredential);
  it("does not return configuration for an authenticated unknown path", expectAuthenticatedUnknownPathIsNotConfiguration);
  it("hides a repository failure behind a safe 500", expectRepositoryFailureIsSafe);
  it("rejects oversized, non-JSON, and malformed write bodies before the repository", expectWriteGuards);
  it("accepts only the application/json media type", expectJsonMediaTypeRules);
  it("lets valid JSON reach the write handler", expectValidJsonReachesTheProbe);
  it("keeps a parsed document out of the error log", expectParsedDocumentIsRedactedFromTheLog);
  it("hides an unexpected failure code and message", expectUnknownFailureStaysInternal);
  it("rate limits an authenticated write before the repository", expectWriteLimitSkipsTheRepository);
  it("applies the environment write limit to one server", expectEnvironmentWriteLimitIsEnforced);
  it("keeps a separate write count on each server", expectWriteCountersArePerServer);
  it("counts rejected authenticated writes toward the limit", expectRejectedWritesConsumeTheQuota);
  it("lets a server write limit override an unusable environment value", expectWriteLimitOptionOverridesTheEnvironment);
  it("refuses to build a server with an unusable write limit", expectUnusableWriteLimitsRefuseToBuild);
  it("returns request ids and replaces an unsafe X-Request-Id", expectRequestIds);
  it("does not reflect a request id that carries the token", expectRequestIdEdges);
});
