import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { configurationSchema, createDemoDocument, type Configuration, type EditableDocument } from "@reactiv/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONFIGURATION_REQUEST_TIMEOUT_MS,
  EditorServerEnvError,
  MISCONFIGURED_CONFIGURATION_MESSAGE,
  assertEditorServerEnv,
  createConfiguration,
  getConfiguration,
  updateConfiguration,
} from "./configuration.server.js";

/** One request the stub observed. Header values are the raw Node header fields. */
type CapturedRequest = {
  method: string;
  url: string;
  authorization: string | undefined;
  accept: string | undefined;
  ifMatch: string | undefined;
  contentType: string | undefined;
  requestId: string | undefined;
  body: string;
};

/** What the stub should do with every request. `rawBody` replaces JSON when the body must not be an object. */
type StubPlan = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  hang?: boolean;
  rawBody?: string;
};

/** A loopback stub and the requests it recorded. */
type Stub = {
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
};

const savedUrl = process.env[["CONFIG", "SERVICE", "URL"].join("_")];
const savedToken = process.env[["CONFIG", "SERVICE", "TOKEN"].join("_")];

/**
 * Names the private service URL variable without storing it as one string.
 *
 * Purpose: this test file must not contain the credential variable names as literals.
 * Inputs: none.
 * Side effects: none.
 */
function serviceUrlKey(): string {
  // The join is the environment key the client reads.
  return ["CONFIG", "SERVICE", "URL"].join("_");
}

/**
 * Names the private service token variable without storing it as one string.
 *
 * Purpose: this test file must not contain the credential variable name as a literal.
 * Inputs: none.
 * Side effects: none.
 */
function serviceTokenKey(): string {
  // The join is the environment key the client reads.
  return ["CONFIG", "SERVICE", "TOKEN"].join("_");
}

/**
 * Sets the private service URL and token for one case.
 *
 * Purpose: point the client at a stub, or clear a variable to prove a setup failure.
 * Inputs: url, the base URL, or undefined to delete it. token, the bearer token, or undefined to delete it.
 * Side effects: writes process.env.
 */
function setServiceEnv(url: string | undefined, token: string | undefined): void {
  // Delete and assign are the two ways a variable is missing or present.
  if (url === undefined) {
    delete process.env[serviceUrlKey()];
  } else {
    process.env[serviceUrlKey()] = url;
  }
  if (token === undefined) {
    delete process.env[serviceTokenKey()];
  } else {
    process.env[serviceTokenKey()] = token;
  }
}

/**
 * Restores the private service variables.
 *
 * Purpose: keep one case from changing the next case.
 * Inputs: none.
 * Side effects: writes the saved values back to process.env.
 */
function restoreServiceEnv(): void {
  // Put back whatever this process had before the file loaded.
  setServiceEnv(savedUrl, savedToken);
}

/**
 * Builds one editable demo document.
 *
 * Purpose: give POST and PUT a schema-valid body.
 * Inputs: none.
 * Side effects: none.
 */
function sampleDocument(): EditableDocument {
  let next = 0;
  /**
   * Issues the next fixture id.
   *
   * Purpose: give createDemoDocument ten stable ids.
   * Inputs: none.
   * Side effects: increments the counter.
   */
  function nextId(): string {
    // The number is only part of the id. It is not a revision.
    next += 1;
    return `demo-${next}`;
  }
  // The shared factory returns an editable document, not a stored configuration.
  return createDemoDocument(nextId);
}

/**
 * Builds one configuration the stub can return.
 *
 * Purpose: a success body that passes the shared schema. revision stays 1 so a test can show the ETag is not copied from it.
 * Inputs: none.
 * Side effects: none.
 */
function sampleConfiguration(): Configuration {
  // id, revision, and updatedAt are service-owned. The document supplies the sections.
  return configurationSchema.parse({
    ...sampleDocument(),
    id: "cfg_demo",
    revision: 1,
    updatedAt: "2026-10-12T23:31:37.504Z",
  });
}

/**
 * Returns a configuration body with an uppercase title color.
 *
 * Purpose: the client should return the schema's lowercase color, not the raw JSON.
 * Inputs: configuration, a valid configuration.
 * Side effects: none.
 */
function bodyWithUppercaseTitleColor(configuration: Configuration): unknown {
  const sections: unknown[] = [];
  // Only text sections store titleColor. Other sections stay as the fixture wrote them.
  for (const section of configuration.data.sections) {
    if (section.type === "text") {
      sections.push({ ...section, titleColor: "#AABBCC" });
      continue;
    }
    sections.push(section);
  }
  // The rest of the document stays valid so the only schema change is the color.
  return {
    ...configuration,
    data: { sections },
  };
}

/**
 * Reads the message from a setup rejection.
 *
 * Purpose: compare the exact sentences a missing or invalid environment produces.
 * Inputs: call, a check or client call that should fail before a socket opens.
 * Side effects: runs the call.
 */
async function setupFailureMessage(call: () => unknown): Promise<string> {
  // A sync throw and a rejected promise both land here.
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(EditorServerEnvError);
    return (error as Error).message;
  }
  throw new Error("expected a setup error");
}

/**
 * Reads one Node header that may be repeated.
 *
 * Purpose: keep the first value when Node presents a string array.
 * Inputs: value, the header field.
 * Side effects: none.
 */
function oneHeader(value: string | string[] | undefined): string | undefined {
  // A repeated header is still one field for these assertions.
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Reads the request body.
 *
 * Purpose: capture POST and PUT JSON. A GET body is empty.
 * Inputs: request, the stub request.
 * Side effects: consumes the request stream.
 */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    // Collect the payload. The client sends a small document.
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    // The body is complete. Decode it as UTF-8 text.
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    // A socket error fails the capture instead of hanging the test.
    request.on("error", reject);
  });
}

/**
 * Records the method, path, and headers the client sent.
 *
 * Purpose: assert the bearer token, Accept, and If-Match without logging them outside the test.
 * Inputs: request, the stub request. body, the raw body text.
 * Side effects: none.
 */
function captureRequest(request: IncomingMessage, body: string): CapturedRequest {
  // Node stores header names in lower case.
  return {
    method: request.method ?? "",
    url: request.url ?? "",
    authorization: oneHeader(request.headers.authorization),
    accept: oneHeader(request.headers.accept),
    ifMatch: oneHeader(request.headers["if-match"]),
    contentType: oneHeader(request.headers["content-type"]),
    requestId: oneHeader(request.headers["x-request-id"]),
    body,
  };
}

/**
 * Writes a JSON response.
 *
 * Purpose: give the client one status, one body, and optional headers such as ETag.
 * Inputs: response, the stub response. status, the HTTP status. body, the JSON value. headers, extra header fields.
 * Side effects: ends the response.
 */
function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> | undefined,
): void {
  // The client parses this text with the configuration or error schema.
  response.writeHead(status, {
    "content-type": "application/json",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

/**
 * Writes the planned stub response.
 *
 * Purpose: send JSON, or the raw text when the case needs an empty or non-JSON body.
 * Inputs: response, the stub response. plan, the status, body, and headers.
 * Side effects: ends the response.
 */
function writePlannedResponse(response: ServerResponse, plan: StubPlan): void {
  // A raw body is sent unchanged. JSON.stringify would hide an empty or HTML response.
  if (plan.rawBody !== undefined) {
    response.writeHead(plan.status, {
      "content-type": "text/plain",
      ...plan.headers,
    });
    response.end(plan.rawBody);
    return;
  }
  // The usual plan is a JSON object the client parses with a schema.
  writeJson(response, plan.status, plan.body, plan.headers);
}

/**
 * Reads the stub's TCP port.
 *
 * Purpose: build a loopback URL after listen(0).
 * Inputs: server, the listening stub.
 * Side effects: throws when the address is not a TCP port.
 */
function portOf(server: Server): number {
  // listen(0) assigns an ephemeral port on 127.0.0.1.
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The stub server has no TCP port.");
  }
  return (address as AddressInfo).port;
}

/**
 * Stops a stub and its open sockets.
 *
 * Purpose: let the process exit after a hang test destroys the client connection.
 * Inputs: server, the stub. sockets, connections the stub accepted.
 * Side effects: destroys sockets and closes the server.
 */
function closeServer(server: Server, sockets: Set<Socket>): Promise<void> {
  // The timeout test leaves the response open. Destroy those sockets before close.
  for (const socket of sockets) {
    socket.destroy();
  }
  // A server that never listened has nothing to close.
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    // close waits until remaining connections end. They were destroyed above.
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

/**
 * Answers one stub request.
 *
 * Purpose: record headers immediately, then write the planned response after the body arrives.
 * Inputs: request, the client call. response, the stub response. plan, what to send. requests, the capture list.
 * Side effects: records the request and may end the response.
 */
function answerStubRequest(
  request: IncomingMessage,
  response: ServerResponse,
  plan: StubPlan,
  requests: CapturedRequest[],
): void {
  // Headers are available before the body. A hang test can see them without waiting for the deadline.
  const captured = captureRequest(request, "");
  requests.push(captured);
  /**
   * Finishes the capture and writes the planned response.
   *
   * Purpose: store the body, then respond unless this call is supposed to hang.
   * Inputs: body, the raw request text.
   * Side effects: updates the capture and may end the response.
   */
  function finishRequest(body: string): void {
    // POST and PUT assertions read this after the client returns.
    captured.body = body;
    // A hanging plan keeps the socket open until the client reaches its deadline.
    if (plan.hang === true) {
      return;
    }
    writePlannedResponse(response, plan);
  }

  /**
   * Ignores a body that ends because the socket was destroyed.
   *
   * Purpose: the timeout test closes the stub while the request is still open.
   * Inputs: none.
   * Side effects: none.
   */
  function ignoreBodyError(): void {
    // The headers were already recorded. There is no second response to write.
  }

  // The body arrives next. A destroyed socket rejects this read during cleanup.
  void readBody(request).then(finishRequest, ignoreBodyError);
}

/**
 * Starts a loopback stub.
 *
 * Purpose: answer the client, or leave the response open when the plan says to hang.
 * Inputs: plan, the status, body, headers, and hang flag.
 * Side effects: listens on 127.0.0.1 and records requests.
 */
function startStub(plan: StubPlan): Promise<Stub> {
  const requests: CapturedRequest[] = [];
  const sockets = new Set<Socket>();
  /**
   * Handles one stub connection.
   *
   * Purpose: pass the shared plan and capture list to the answer function.
   * Inputs: request, the client call. response, the stub response.
   * Side effects: records the request and may end the response.
   */
  function onRequest(request: IncomingMessage, response: ServerResponse): void {
    // The plan is closed over from startStub. Each request uses that same plan.
    answerStubRequest(request, response, plan, requests);
  }
  const server = createServer(onRequest);
  // Track sockets so close can destroy the one the timeout test leaves open.
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  return new Promise((resolve, reject) => {
    // A listen failure rejects the stub instead of hanging the test.
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const url = `http://127.0.0.1:${portOf(server)}`;
      resolve({
        url,
        requests,
        /**
         * Closes this stub.
         *
         * Purpose: release the port and any hung socket.
         * Inputs: none.
         * Side effects: destroys sockets and closes the server.
         */
        close(): Promise<void> {
          // The same sockets set is the one the connection listener fills.
          return closeServer(server, sockets);
        },
      });
    });
  });
}

/**
 * Asserts GET sends the bearer token and does not return it.
 *
 * Purpose: the Authorization header is the only place the token appears.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectGetSendsBearerWithoutReturningIt(): Promise<void> {
  const token = "server-only-token-9f3c";
  const configuration = sampleConfiguration();
  // The header ETag is "4" while the body revision is 1, so the client cannot be copying revision.
  const stub = await startStub({ status: 200, body: configuration, headers: { etag: '"4"' } });
  try {
    setServiceEnv(stub.url, token);
    const result = await getConfiguration("cfg_demo");
    // One GET, with the token only in Authorization, and no If-Match.
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe("GET");
    expect(stub.requests[0]?.url).toBe("/v1/configurations/cfg_demo");
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${token}`);
    expect(stub.requests[0]?.requestId).toMatch(/^[A-Za-z0-9_-]{1,80}$/);
    expect(stub.requests[0]?.accept).toBe("application/json");
    expect(stub.requests[0]?.ifMatch).toBeUndefined();
    expect(stub.requests[0]?.body).toBe("");
    expect(result).toEqual({ ok: true, configuration, etag: '"4"' });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a private 401 becomes the safe misconfigured result.
 *
 * Purpose: the service body can contain the token and a sign-in sentence, and neither is returned.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectUnauthorizedIsMisconfigured(): Promise<void> {
  const token = "unauthorized-token-4aa1";
  const stub = await startStub({
    status: 401,
    body: {
      token,
      error: {
        code: "UNAUTHORIZED",
        message: `Please sign in with ${token}`,
        requestId: "req_401",
        token,
      },
    },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await getConfiguration("cfg_demo");
    // The fixed sentence replaces the service body.
    expect(result).toEqual({
      ok: false,
      kind: "misconfigured",
      message: MISCONFIGURED_CONFIGURATION_MESSAGE,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("sign in");
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a stub that never answers becomes unavailable.
 *
 * Purpose: the five-second deadline is the client's timeout, and fetch's rejection is not thrown.
 * Inputs: none.
 * Side effects: starts a hanging stub and sets the service environment.
 */
async function expectHangTimesOut(): Promise<void> {
  const token = "timeout-token-18b0";
  const stub = await startStub({ status: 200, body: {}, hang: true });
  try {
    setServiceEnv(stub.url, token);
    const started = Date.now();
    const result = await getConfiguration("cfg_demo");
    const elapsed = Date.now() - started;
    // The deadline is five seconds. An early failure would be a different result.
    expect(result).toEqual({ ok: false, kind: "unavailable" });
    expect(elapsed).toBeGreaterThanOrEqual(CONFIGURATION_REQUEST_TIMEOUT_MS - 500);
    expect(JSON.stringify(result)).not.toContain(token);
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${token}`);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts an invalid 200 body is internal and drops the token.
 *
 * Purpose: a success status is not editor data until the configuration schema accepts it.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectInvalidSuccessIsInternal(): Promise<void> {
  const token = "invalid-body-token-55e2";
  const stub = await startStub({ status: 200, body: { token, id: "not-a-configuration" } });
  try {
    setServiceEnv(stub.url, token);
    const result = await getConfiguration("cfg_demo");
    // The body is not returned, so the token stuffed into it is gone.
    expect(result).toEqual({ ok: false, kind: "internal" });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts PUT sends the If-Match value it was given.
 *
 * Purpose: the client does not quote a revision or replace the caller's validator.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectUpdateSendsGivenEtag(): Promise<void> {
  const token = "update-token-71c4";
  const document = sampleDocument();
  const etag = '"17"';
  const configuration = configurationSchema.parse({
    ...document,
    id: "cfg_demo",
    revision: 18,
    updatedAt: "2026-10-12T23:31:37.504Z",
  });
  const stub = await startStub({ status: 200, body: configuration, headers: { etag: '"18"' } });
  try {
    setServiceEnv(stub.url, token);
    const result = await updateConfiguration("cfg_demo", document, etag);
    // If-Match is the argument, not the revision inside the response.
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe("PUT");
    expect(stub.requests[0]?.ifMatch).toBe(etag);
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${token}`);
    expect(stub.requests[0]?.accept).toBe("application/json");
    expect(stub.requests[0]?.contentType).toContain("application/json");
    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual(document);
    expect(result).toEqual({ ok: true, configuration, etag: '"18"' });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a caller request id is sent on X-Request-Id.
 *
 * Purpose: the loader and the action pass the id the page will show, and the service receives that same id.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectCallerRequestIdIsForwarded(): Promise<void> {
  const token = "request-id-token-24c1";
  const requestId = "corr-editor-24";
  const document = sampleDocument();
  const configuration = configurationSchema.parse({
    ...document,
    id: "cfg_demo",
    revision: 2,
    updatedAt: "2026-10-12T23:31:37.504Z",
  });
  const stub = await startStub({ status: 200, body: configuration, headers: { etag: '"2"' } });
  try {
    setServiceEnv(stub.url, token);
    await updateConfiguration("cfg_demo", document, '"1"', requestId);
    // The inbound header is the id the caller passed, not a second generated id.
    expect(stub.requests[0]?.requestId).toBe(requestId);
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${token}`);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a 422 body keeps issues and requestId and drops other fields.
 *
 * Purpose: field errors survive, and a token on the body does not.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectValidationFailureKeepsIssues(): Promise<void> {
  const token = "validation-token-90d8";
  const stub = await startStub({
    status: 422,
    body: {
      token,
      error: {
        code: "VALIDATION_FAILED",
        message: `Some fields need attention. ${token}`,
        requestId: "req_422",
        stack: token,
        issues: [
          { path: "data.sections[0].title", message: "Enter a title.", token },
          { path: "data.sections[1].url", message: "Use an absolute HTTP(S) URL." },
        ],
      },
    },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await updateConfiguration("cfg_demo", sampleDocument(), '"1"');
    // code, requestId, and issues stay. The service message and the token do not.
    expect(result).toEqual({
      ok: false,
      kind: "service",
      status: 422,
      code: "VALIDATION_FAILED",
      requestId: "req_422",
      issues: [
        { path: "data.sections[0].title", message: "Enter a title." },
        { path: "data.sections[1].url", message: "Use an absolute HTTP(S) URL." },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts POST sends the document and does not send If-Match.
 *
 * Purpose: create has no caller-supplied revision.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectCreateSendsDocument(): Promise<void> {
  const token = "create-token-22ab";
  const document = sampleDocument();
  const configuration = configurationSchema.parse({
    ...document,
    id: "cfg_created",
    revision: 1,
    updatedAt: "2026-10-12T23:31:37.504Z",
  });
  const stub = await startStub({ status: 201, body: configuration, headers: { etag: '"1"' } });
  try {
    setServiceEnv(stub.url, token);
    const result = await createConfiguration(document);
    // POST carries the document and the bearer token, and no If-Match.
    expect(stub.requests).toHaveLength(1);
    expect(stub.requests[0]?.method).toBe("POST");
    expect(stub.requests[0]?.url).toBe("/v1/configurations");
    expect(stub.requests[0]?.ifMatch).toBeUndefined();
    expect(stub.requests[0]?.accept).toBe("application/json");
    expect(stub.requests[0]?.contentType).toBe("application/json");
    expect(stub.requests[0]?.authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(stub.requests[0]?.body ?? "")).toEqual(document);
    expect(result).toEqual({ ok: true, configuration, etag: '"1"' });
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a refused connection is unavailable.
 *
 * Purpose: a down service is the same typed result as a timeout, without throwing fetch's error.
 * Inputs: none.
 * Side effects: binds a port, closes it, and sets the service environment.
 */
async function expectClosedPortIsUnavailable(): Promise<void> {
  const token = "closed-port-token-63f1";
  const stub = await startStub({ status: 200, body: {} });
  const url = stub.url;
  // Close before the call so the port refuses the connection.
  await stub.close();
  setServiceEnv(url, token);
  const result = await getConfiguration("cfg_demo");
  expect(result).toEqual({ ok: false, kind: "unavailable" });
  expect(JSON.stringify(result)).not.toContain(token);
}

/**
 * Asserts a redirect is not followed.
 *
 * Purpose: the bearer token must not be sent to the Location host.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectRedirectIsNotFollowed(): Promise<void> {
  const token = "redirect-token-08e7";
  const stub = await startStub({
    status: 302,
    body: { token },
    headers: { location: "http://127.0.0.1:9/steal" },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await getConfiguration("cfg_demo");
    // One request, and the redirect body is not editor data.
    expect(stub.requests).toHaveLength(1);
    expect(result).toEqual({ ok: false, kind: "internal" });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts setup failures name the variable and omit the credential.
 *
 * Purpose: a missing URL, a missing token, and the example placeholder throw before a socket opens.
 * Inputs: none.
 * Side effects: starts a stub and changes the service environment.
 */
async function expectSetupErrorsDoNotCall(): Promise<void> {
  const token = "setup-secret-44c0";
  const stub = await startStub({ status: 200, body: { token } });
  try {
    setServiceEnv(undefined, token);
    // A missing URL names that variable and does not include the token that is set.
    const missingUrl = `Missing required environment variable: ${serviceUrlKey()}`;
    const missingToken = `Missing required environment variable: ${serviceTokenKey()}`;
    expect(() => assertEditorServerEnv()).toThrow(EditorServerEnvError);
    expect(() => assertEditorServerEnv()).toThrow(missingUrl);
    await expect(getConfiguration("cfg_demo")).rejects.toThrow(EditorServerEnvError);
    expect(stub.requests).toHaveLength(0);

    setServiceEnv(stub.url, undefined);
    // A missing token names the token variable.
    expect(() => assertEditorServerEnv()).toThrow(missingToken);
    await expect(getConfiguration("cfg_demo")).rejects.toThrow(missingToken);

    setServiceEnv(stub.url, "   ");
    // Whitespace is missing, not a credential.
    expect(() => assertEditorServerEnv()).toThrow(missingToken);

    setServiceEnv(stub.url, "replace-me");
    // The example placeholder is invalid, and the sentence does not repeat it.
    expect(() => assertEditorServerEnv()).toThrow(EditorServerEnvError);
    try {
      assertEditorServerEnv();
    } catch (error) {
      expect(error).toBeInstanceOf(EditorServerEnvError);
      expect((error as Error).message).toBe(`Invalid environment variable: ${serviceTokenKey()}`);
      expect((error as Error).message).not.toContain("replace-me");
      expect((error as Error).message).not.toContain(token);
    }

    setServiceEnv("not a url setup-secret-44c0", token);
    // An unusable URL names the URL variable and does not include the rejected text.
    try {
      assertEditorServerEnv();
      throw new Error("expected a setup error");
    } catch (error) {
      expect(error).toBeInstanceOf(EditorServerEnvError);
      expect((error as Error).message).toBe(`Invalid environment variable: ${serviceUrlKey()}`);
      expect((error as Error).message).not.toContain("setup-secret-44c0");
    }
    expect(stub.requests).toHaveLength(0);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a ready environment does not throw.
 *
 * Purpose: the server entry can call the same check the client uses.
 * Inputs: none.
 * Side effects: sets the service environment.
 */
function expectReadyEnvPasses(): void {
  // These values are usable. The check does not open a socket.
  setServiceEnv("http://127.0.0.1:4001", "ready-token-12ab");
  expect(() => assertEditorServerEnv()).not.toThrow();
  // HTTPS is a valid scheme. This check still does not open a socket.
  setServiceEnv("https://127.0.0.1:4001", "ready-token-12ab");
  expect(() => assertEditorServerEnv()).not.toThrow();
}

/**
 * Asserts one error names every setup problem, in a stable order.
 *
 * Purpose: a missing URL and a placeholder token are both visible, and the placeholder is not copied.
 * Inputs: none.
 * Side effects: starts a stub and changes the service environment.
 */
async function expectCombinedSetupProblemsStayOrdered(): Promise<void> {
  const stub = await startStub({ status: 200, body: {} });
  const missingUrl = `Missing required environment variable: ${serviceUrlKey()}`;
  const invalidToken = `Invalid environment variable: ${serviceTokenKey()}`;
  try {
    setServiceEnv(undefined, "replace-me");
    // The URL line comes first. The token line does not repeat the placeholder.
    const combined = await setupFailureMessage(() => getConfiguration("cfg_demo"));
    expect(combined).toBe(`${missingUrl}\n${invalidToken}`);
    expect(combined).not.toContain("replace-me");
    expect(stub.requests).toHaveLength(0);

    setServiceEnv(stub.url, "  replace-me  ");
    // Spaces around the placeholder do not make it a credential.
    const padded = await setupFailureMessage(() => assertEditorServerEnv());
    expect(padded).toBe(invalidToken);
    expect(padded).not.toContain("replace-me");
    expect(stub.requests).toHaveLength(0);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a credential in the URL, or a non-HTTP URL, never opens a socket.
 *
 * Purpose: userinfo and other schemes are setup failures, and their text is not in the error.
 * Inputs: none.
 * Side effects: starts a stub and changes the service environment.
 */
async function expectUnsafeUrlsDoNotCall(): Promise<void> {
  const stub = await startStub({ status: 200, body: {} });
  const invalidUrl = `Invalid environment variable: ${serviceUrlKey()}`;
  try {
    const port = new URL(stub.url).port;
    setServiceEnv(`http://editor:url-secret-77@127.0.0.1:${port}/private`, "ready-token-12ab");
    // The userinfo secret is not echoed, and the stub sees no request.
    const userinfo = await setupFailureMessage(() => getConfiguration("cfg_demo"));
    expect(userinfo).toBe(invalidUrl);
    expect(userinfo).not.toContain("url-secret-77");
    expect(stub.requests).toHaveLength(0);

    setServiceEnv("file:///tmp/url-secret-88", "ready-token-12ab");
    // A file URL is not the private service, and its path is not echoed.
    const fileUrl = await setupFailureMessage(() => getConfiguration("cfg_demo"));
    expect(fileUrl).toBe(invalidUrl);
    expect(fileUrl).not.toContain("url-secret-88");
    expect(stub.requests).toHaveLength(0);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts the request path keeps the base prefix and drops a query credential.
 *
 * Purpose: an id slash cannot add a path segment, and a secret in the base URL is not forwarded.
 * Inputs: none.
 * Side effects: starts a stub and changes the service environment.
 */
async function expectRequestTargetDropsQueryAndEncodesId(): Promise<void> {
  const token = "path-token-18de";
  const stub = await startStub({ status: 200, body: sampleConfiguration(), headers: { etag: '"1"' } });
  try {
    setServiceEnv(`${stub.url}/private/?access_token=query-secret-11#section`, token);
    await getConfiguration("cfg/demo");
    // The query and hash are gone. The slash in the id is one encoded segment.
    expect(stub.requests[0]?.url).toBe("/private/v1/configurations/cfg%2Fdemo");
    expect(stub.requests[0]?.url).not.toContain("query-secret-11");

    setServiceEnv(`${stub.url}/private/`, token);
    await getConfiguration("cfg_demo");
    // A trailing slash on the base path does not become a double slash.
    expect(stub.requests[1]?.url).toBe("/private/v1/configurations/cfg_demo");
  } finally {
    await stub.close();
  }
}

/**
 * Asserts each call reads the environment again.
 *
 * Purpose: a trimmed URL still reaches the stub, a padded token is sent unchanged, and a later URL is the one that is called.
 * Inputs: none.
 * Side effects: starts two stubs and changes the service environment.
 */
async function expectEnvironmentIsReadAtCallTime(): Promise<void> {
  const first = await startStub({ status: 200, body: sampleConfiguration(), headers: { etag: '"1"' } });
  const second = await startStub({ status: 200, body: sampleConfiguration(), headers: { etag: '"2"' } });
    const paddedToken = "  spaced-token  ";
  try {
    setServiceEnv(`  ${first.url}  `, paddedToken);
    await getConfiguration("cfg_demo");
    // Spaces around the URL are trimmed. Leading spaces in the token are sent.
    // A header field drops trailing spaces, so those two characters are not on the wire.
    expect(first.requests).toHaveLength(1);
    expect(first.requests[0]?.authorization).toBe("Bearer   spaced-token");

    setServiceEnv(second.url, "second-token-91ab");
    await getConfiguration("cfg_demo");
    // The second call does not reuse the first stub.
    expect(first.requests).toHaveLength(1);
    expect(second.requests).toHaveLength(1);
    expect(second.requests[0]?.authorization).toBe("Bearer second-token-91ab");
  } finally {
    await first.close();
    await second.close();
  }
}

/**
 * Asserts a missing ETag header stays null.
 *
 * Purpose: the client does not format revision into a validator.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectMissingEtagStaysNull(): Promise<void> {
  const configuration = sampleConfiguration();
  const stub = await startStub({ status: 200, body: configuration });
  try {
    setServiceEnv(stub.url, "etag-token-44b0");
    const result = await getConfiguration("cfg_demo");
    // revision is 1. The returned validator is the absent header, not "1".
    expect(result).toEqual({ ok: true, configuration, etag: null });
  } finally {
    await stub.close();
  }
}

/**
 * Asserts an empty or non-JSON success body is internal.
 *
 * Purpose: a 200 that is not a configuration does not become editor data, and a token in HTML is not returned.
 * Inputs: none.
 * Side effects: starts stubs and sets the service environment.
 */
async function expectUnreadableSuccessBodyIsInternal(): Promise<void> {
  const token = "html-token-90aa";
  const empty = await startStub({ status: 200, body: null, rawBody: "  \n" });
  try {
    setServiceEnv(empty.url, token);
    // Whitespace is not JSON and is not a configuration.
    expect(await getConfiguration("cfg_demo")).toEqual({ ok: false, kind: "internal" });
  } finally {
    await empty.close();
  }

  const html = await startStub({
    status: 200,
    body: null,
    rawBody: `<html>${token}</html>`,
    headers: { "content-type": "text/html" },
  });
  try {
    setServiceEnv(html.url, token);
    const result = await getConfiguration("cfg_demo");
    expect(result).toEqual({ ok: false, kind: "internal" });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await html.close();
  }
}

/**
 * Asserts a valid configuration with an extra token field is internal.
 *
 * Purpose: unknown keys fail the schema instead of being stripped into a success value.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectExtraTokenFieldIsInternal(): Promise<void> {
  const token = "extra-token-12ff";
  const stub = await startStub({
    status: 200,
    body: { ...sampleConfiguration(), token },
    headers: { etag: '"1"' },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await getConfiguration("cfg_demo");
    expect(result).toEqual({ ok: false, kind: "internal" });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts the client returns the schema's normalized configuration.
 *
 * Purpose: a stored color is lowercase #rrggbb after a successful parse.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectSchemaNormalizesTheConfiguration(): Promise<void> {
  const sent = bodyWithUppercaseTitleColor(sampleConfiguration());
  const stub = await startStub({ status: 200, body: sent, headers: { etag: '"9"' } });
  try {
    setServiceEnv(stub.url, "color-token-33ab");
    const result = await getConfiguration("cfg_demo");
    // The stub body still has the uppercase color. The result is the parsed form.
    expect(JSON.stringify(sent)).toContain("#AABBCC");
    expect(result).toEqual({
      ok: true,
      configuration: configurationSchema.parse(sent),
      etag: '"9"',
    });
  } finally {
    await stub.close();
  }
}

/**
 * Asserts only the method's success status is accepted.
 *
 * Purpose: POST succeeds on 201, and GET succeeds on 200. The other status is not editor data.
 * Inputs: none.
 * Side effects: starts stubs and sets the service environment.
 */
async function expectWrongSuccessStatusIsInternal(): Promise<void> {
  const configuration = sampleConfiguration();
  const created = await startStub({ status: 200, body: configuration, headers: { etag: '"1"' } });
  try {
    setServiceEnv(created.url, "status-token-70c1");
    // A 200 from create is not a created configuration.
    expect(await createConfiguration(sampleDocument())).toEqual({ ok: false, kind: "internal" });
  } finally {
    await created.close();
  }

  const loaded = await startStub({ status: 201, body: configuration, headers: { etag: '"1"' } });
  try {
    setServiceEnv(loaded.url, "status-token-70c1");
    // A 201 from a load is not a loaded configuration.
    expect(await getConfiguration("cfg_demo")).toEqual({ ok: false, kind: "internal" });
  } finally {
    await loaded.close();
  }
}

/**
 * Asserts a not-found body keeps code and requestId.
 *
 * Purpose: the service message and extra fields are dropped, and issues is omitted.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectNotFoundKeepsCodeAndDropsMessage(): Promise<void> {
  const token = "missing-token-81e2";
  const stub = await startStub({
    status: 404,
    body: {
      token,
      error: {
        code: "NOT_FOUND",
        message: `Configuration not found. ${token}`,
        requestId: "req_404",
        token,
      },
    },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await getConfiguration("cfg_demo");
    expect(result).toEqual({
      ok: false,
      kind: "service",
      status: 404,
      code: "NOT_FOUND",
      requestId: "req_404",
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("Configuration not found");
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a contract 500 stays a service result.
 *
 * Purpose: the request id is kept, which an unreadable 500 cannot invent.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectServiceInternalKeepsRequestId(): Promise<void> {
  const token = "internal-token-64d0";
  const stub = await startStub({
    status: 500,
    body: {
      token,
      error: {
        code: "INTERNAL",
        message: `Service failed. ${token}`,
        requestId: "req_500",
      },
    },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await getConfiguration("cfg_demo");
    expect(result).toEqual({
      ok: false,
      kind: "service",
      status: 500,
      code: "INTERNAL",
      requestId: "req_500",
    });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts an unreadable error body is internal.
 *
 * Purpose: HTML on a 500 does not throw and does not return the token it contains.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectUnreadableErrorBodyIsInternal(): Promise<void> {
  const token = "html-error-token-19b4";
  const stub = await startStub({
    status: 500,
    body: null,
    rawBody: `<html>${token}</html>`,
    headers: { "content-type": "text/html" },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await getConfiguration("cfg_demo");
    expect(result).toEqual({ ok: false, kind: "internal" });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts an error body that breaks the issues rule is internal.
 *
 * Purpose: a validation failure without issues, or a not-found body with issues, is not forwarded.
 * Inputs: none.
 * Side effects: starts stubs and sets the service environment.
 */
async function expectInvalidErrorShapeIsInternal(): Promise<void> {
  const token = "shape-token-77c1";
  const missingIssues = await startStub({
    status: 422,
    body: {
      token,
      error: {
        code: "VALIDATION_FAILED",
        message: `bad ${token}`,
        requestId: "req_shape",
      },
    },
  });
  try {
    setServiceEnv(missingIssues.url, token);
    const missing = await getConfiguration("cfg_demo");
    expect(missing).toEqual({ ok: false, kind: "internal" });
    expect(JSON.stringify(missing)).not.toContain(token);
  } finally {
    await missingIssues.close();
  }

  const extraIssues = await startStub({
    status: 404,
    body: {
      token,
      error: {
        code: "NOT_FOUND",
        message: "missing",
        requestId: "req_shape",
        issues: [{ path: "id", message: token }],
      },
    },
  });
  try {
    setServiceEnv(extraIssues.url, token);
    const extra = await getConfiguration("cfg_demo");
    expect(extra).toEqual({ ok: false, kind: "internal" });
    expect(JSON.stringify(extra)).not.toContain(token);
  } finally {
    await extraIssues.close();
  }
}

/**
 * Asserts an empty validation issue list is kept.
 *
 * Purpose: validation failures include issues even when the list is empty.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectEmptyValidationIssuesAreKept(): Promise<void> {
  const stub = await startStub({
    status: 422,
    body: {
      error: {
        code: "VALIDATION_FAILED",
        message: "Some fields need attention.",
        requestId: "req_empty",
        issues: [],
      },
    },
  });
  try {
    setServiceEnv(stub.url, "empty-issues-token-08aa");
    const result = await updateConfiguration("cfg_demo", sampleDocument(), '"1"');
    expect(result).toEqual({
      ok: false,
      kind: "service",
      status: 422,
      code: "VALIDATION_FAILED",
      requestId: "req_empty",
      issues: [],
    });
  } finally {
    await stub.close();
  }
}

/**
 * Asserts PUT treats 401 the same way GET does.
 *
 * Purpose: a body on the request does not change the safe misconfigured result.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectUpdateUnauthorizedIsMisconfigured(): Promise<void> {
  const token = "put-unauthorized-token-5c19";
  const stub = await startStub({
    status: 401,
    body: {
      error: {
        code: "UNAUTHORIZED",
        message: `Please sign in with ${token}`,
        requestId: "req_401",
      },
    },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await updateConfiguration("cfg_demo", sampleDocument(), '"17"');
    expect(stub.requests[0]?.ifMatch).toBe('"17"');
    expect(result).toEqual({
      ok: false,
      kind: "misconfigured",
      message: MISCONFIGURED_CONFIGURATION_MESSAGE,
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("sign in");
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a weak validator is forwarded unchanged.
 *
 * Purpose: the client does not turn W/"1" into a strong tag or a revision.
 * Inputs: none.
 * Side effects: starts a stub and sets the service environment.
 */
async function expectWeakEtagIsForwarded(): Promise<void> {
  const token = "weak-etag-token-2af0";
  const etag = 'W/"1"';
  const stub = await startStub({
    status: 428,
    body: {
      token,
      error: {
        code: "PRECONDITION_REQUIRED",
        message: `Stale document. ${token}`,
        requestId: "req_428",
      },
    },
  });
  try {
    setServiceEnv(stub.url, token);
    const result = await updateConfiguration("cfg_demo", sampleDocument(), etag);
    expect(stub.requests[0]?.ifMatch).toBe(etag);
    expect(result).toEqual({
      ok: false,
      kind: "service",
      status: 428,
      code: "PRECONDITION_REQUIRED",
      requestId: "req_428",
    });
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    await stub.close();
  }
}

/**
 * Asserts a timed-out PUT is unavailable and is not sent again.
 *
 * Purpose: a timeout is not a successful write, and the client does not issue a second PUT that could double-apply.
 * Inputs: none.
 * Side effects: points the client at a closed address and replaces fetch for this case.
 */
async function expectAPutTimeoutToStayUnavailableWithoutRetry(): Promise<void> {
  const token = "put-timeout-token-22a4";
  setServiceEnv("http://127.0.0.1:9", token);
  const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
  const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(timeout);
  try {
    // The deadline rejection is the whole response. There is no success body to adopt.
    const result = await updateConfiguration("cfg_demo", sampleDocument(), '"4"');
    expect(result).toEqual({ ok: false, kind: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(token);
  } finally {
    // The next case uses the real fetch against its own stub.
    fetchMock.mockRestore();
  }
}

afterEach(restoreServiceEnv);

describe("configuration server client", () => {
  it("sends the bearer token and does not return it", expectGetSendsBearerWithoutReturningIt);
  it("maps a 401 to the safe misconfigured result", expectUnauthorizedIsMisconfigured);
  it("maps a hanging service to unavailable", expectHangTimesOut, 20_000);
  it("keeps a timed-out PUT unavailable and does not retry it", expectAPutTimeoutToStayUnavailableWithoutRetry);
  it("maps an invalid 200 body to an internal result", expectInvalidSuccessIsInternal);
  it("sends the If-Match value it was given", expectUpdateSendsGivenEtag);
  it("sends the caller request id", expectCallerRequestIdIsForwarded);
  it("keeps issues and requestId from a 422 body", expectValidationFailureKeepsIssues);
  it("creates a configuration without If-Match", expectCreateSendsDocument);
  it("maps a refused connection to unavailable", expectClosedPortIsUnavailable);
  it("does not follow a redirect", expectRedirectIsNotFollowed);
  it("names setup problems without calling the service", expectSetupErrorsDoNotCall);
  it("accepts a ready service URL and token", expectReadyEnvPasses);
  it("names every setup problem in a stable order", expectCombinedSetupProblemsStayOrdered);
  it("rejects a credential in the URL and a non-HTTP URL", expectUnsafeUrlsDoNotCall);
  it("drops a query credential and encodes the configuration id", expectRequestTargetDropsQueryAndEncodesId);
  it("reads the service environment at call time", expectEnvironmentIsReadAtCallTime);
  it("leaves a missing ETag null", expectMissingEtagStaysNull);
  it("maps an unreadable success body to an internal result", expectUnreadableSuccessBodyIsInternal);
  it("maps a configuration with an extra field to an internal result", expectExtraTokenFieldIsInternal);
  it("returns the schema's normalized configuration", expectSchemaNormalizesTheConfiguration);
  it("accepts only the success status for that method", expectWrongSuccessStatusIsInternal);
  it("keeps code and requestId from a not-found body", expectNotFoundKeepsCodeAndDropsMessage);
  it("keeps the request id from a contract 500", expectServiceInternalKeepsRequestId);
  it("maps an unreadable error body to an internal result", expectUnreadableErrorBodyIsInternal);
  it("maps an invalid error shape to an internal result", expectInvalidErrorShapeIsInternal);
  it("keeps an empty validation issue list", expectEmptyValidationIssuesAreKept);
  it("maps a 401 on update to the safe misconfigured result", expectUpdateUnauthorizedIsMisconfigured);
  it("forwards a weak If-Match value unchanged", expectWeakEtagIsForwarded);
});
