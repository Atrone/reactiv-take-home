import { createServer } from "node:http";
import {
  VALIDATION_FAILED_MESSAGE,
  createDemoDocument,
  editableDocumentSchema,
  formatError,
  issuesFromZodError,
} from "../../packages/contracts/dist/index.js";
import {
  CONTROL_PORT,
  CONFIGURATION_ID,
  FIXTURE_PORT,
  SERVICE_TOKEN,
} from "./journey-env.mjs";

/** Revision 1 timestamp. A successful save replaces it. */
const SEED_UPDATED_AT = "2026-10-13T12:00:00.000Z";

/**
 * Ids issued to createDemoDocument, in the same order as the Postgres seed.
 *
 * The screen is carousel, text, CTA, carousel, text, CTA.
 */
const DEMO_IDS = [
  "section-carousel-1",
  "image-carousel-1-1",
  "image-carousel-1-2",
  "section-text-1",
  "section-cta-1",
  "section-carousel-2",
  "image-carousel-2-1",
  "image-carousel-2-2",
  "section-text-2",
  "section-cta-2",
];

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
 * Builds the six-section demo document.
 *
 * Purpose: the journeys start from the same screen the Postgres seed inserts.
 * Inputs: none. The id queue is the constant above.
 * Side effects: none. The shared schema parse throws when the fixture is invalid.
 */
function createJourneyDocument() {
  // A new queue starts at the first carousel. The document is not a service record.
  let index = 0;
  return createDemoDocument(() => {
    const id = DEMO_IDS[index];
    index += 1;
    // createDemoDocument asks for ten ids. An eleventh call is a fixture bug.
    if (id === undefined) {
      throw new Error("The journey fixture asked for more ids than the demo queue provides.");
    }
    return id;
  });
}

/** The document every reset copies. Saves do not change this object. */
const seedDocument = createJourneyDocument();

/** The document GET and PUT currently store. */
let storedDocument = structuredClone(seedDocument);

/** The concurrency counter. It starts at 1, matching a new seed row. */
let revision = 1;

/** The timestamp returned with the stored document. */
let updatedAt = SEED_UPDATED_AT;

/** When true, the next PUT returns 500 and does not write. */
let failNextPut = false;

/** Whether the data port is accepting connections. */
let dataListening = false;

/**
 * Sends one JSON response.
 *
 * Purpose: the editor's configuration client accepts a configuration body and an ETag header.
 * Inputs: response, the server response. status, the HTTP status. body, the JSON value. extraHeaders, optional headers.
 * Side effects: writes the response. The body is not given a token field.
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
 * Sends one contract error.
 *
 * Purpose: a refused call uses the shared error body and does not echo the bearer token.
 * Inputs: response, the server response. status, the HTTP status. code, the contract code.
 * message, a safe sentence. requestId, the correlation id. issues, field errors for validation only.
 * Side effects: writes the response.
 */
function sendError(response, status, code, message, requestId, issues) {
  // formatError rejects a token or a stack on this object.
  const body = formatError({
    code,
    message,
    requestId,
    ...(issues === undefined ? {} : { issues }),
  });
  sendJson(response, status, body);
}

/**
 * Reads the correlation id from the editor, or a fixture id when the header is blank.
 *
 * Purpose: error bodies still have a request id the editor can show.
 * Inputs: request, the incoming call.
 * Side effects: none.
 */
function requestIdFrom(request) {
  // The editor sends the id it will show. A missing header gets a fixture id.
  const header = request.headers["x-request-id"];
  if (typeof header === "string" && header.trim() !== "") {
    return header;
  }
  return "req_journey";
}

/**
 * Reads a request body up to the import ceiling.
 *
 * Purpose: PUT needs the JSON text, and a huge body is not stored.
 * Inputs: request, the incoming call.
 * Side effects: consumes the body. Throws when the body is above 256 KiB.
 */
function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      // Stop before a large body is stored. 256 KiB is the shared payload ceiling.
      size += chunk.length;
      if (size > 262144) {
        reject(new Error("body too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      // The editor sends UTF-8 JSON. An empty body is an empty string.
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

/**
 * Discards a body the handler will not parse.
 *
 * Purpose: a GET or a rejected call still finishes the request.
 * Inputs: request, the incoming call.
 * Side effects: consumes the body.
 */
function drain(request) {
  // readBody enforces the same ceiling. The text is thrown away.
  return readBody(request).then(() => undefined);
}

/**
 * Reports whether the call carries this fixture's bearer token.
 *
 * Purpose: the editor's server client must present the token. A missing or different token is not a document.
 * Inputs: request, the incoming call.
 * Side effects: none.
 */
function authorized(request) {
  // One header. A repeated authorization header is not this token.
  return request.headers.authorization === `Bearer ${SERVICE_TOKEN}`;
}

/**
 * Reads a strong revision from If-Match.
 *
 * Purpose: accept only the quoted revision this fixture emits.
 * Inputs: header, the If-Match value. A repeated header is not one revision.
 * Side effects: none.
 */
function revisionFromIfMatch(header) {
  // A missing header and a repeated header are not one revision.
  if (typeof header !== "string") {
    return undefined;
  }
  // The quotes are part of the value. Example: "1".
  const match = /^"([1-9][0-9]*)"$/.exec(header.trim());
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const parsed = Number(match[1]);
  // A revision this large is not one the fixture stored.
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }
  return parsed;
}

/**
 * Builds the configuration body for the current row.
 *
 * Purpose: GET and a successful PUT return id, revision, and updatedAt around the stored document.
 * Inputs: none. The row is the module state.
 * Side effects: none. The token is not a field.
 */
function configurationBody() {
  // schemaVersion and data come from the stored document. The service fields are added here.
  return {
    schemaVersion: storedDocument.schemaVersion,
    id: CONFIGURATION_ID,
    revision,
    updatedAt,
    data: storedDocument.data,
  };
}

/**
 * Sends the current configuration.
 *
 * Purpose: the editor hydrates from this body and keeps the strong ETag for the next save.
 * Inputs: response, the server response.
 * Side effects: writes 200. Does not change the row.
 */
function sendConfiguration(response) {
  // The quotes are part of the header value, matching the configuration service.
  sendJson(response, 200, configurationBody(), { etag: `"${revision}"` });
}

/**
 * Restores the seeded document and clears a pending save failure.
 *
 * Purpose: one test's save or unsaved edit must not become the next test's screen.
 * Inputs: none.
 * Side effects: replaces the in-memory row with revision 1.
 */
function resetStore() {
  // Clone so a later PUT cannot change the seed object.
  storedDocument = structuredClone(seedDocument);
  revision = 1;
  updatedAt = SEED_UPDATED_AT;
  failNextPut = false;
}

/**
 * Replaces the stored document when If-Match is current.
 *
 * Purpose: Save can persist, and one flagged PUT can fail without writing.
 * Inputs: response, the server response. text, the JSON body. ifMatch, the If-Match header.
 * requestId, the correlation id.
 * Side effects: may write the row and advance the revision, or send an error and leave the row.
 */
function handlePut(response, text, ifMatch, requestId) {
  // A flagged save fails once. The draft on the page is not stored.
  if (failNextPut) {
    failNextPut = false;
    sendError(response, 500, "INTERNAL", "The configuration service could not complete the request.", requestId);
    return;
  }
  // Missing, weak, and non-canonical tags are not a write.
  const expected = revisionFromIfMatch(ifMatch);
  if (expected === undefined) {
    sendError(response, 428, "PRECONDITION_REQUIRED", "If-Match must be a strong revision ETag.", requestId);
    return;
  }
  let value;
  try {
    // The editor sends one JSON object. Other text is not a document.
    value = JSON.parse(text);
  } catch {
    sendError(response, 400, "MALFORMED_JSON", "The request body is not valid JSON.", requestId);
    return;
  }
  const parsed = editableDocumentSchema.safeParse(value);
  if (!parsed.success) {
    // An invalid document does not replace the row.
    sendError(
      response,
      422,
      "VALIDATION_FAILED",
      VALIDATION_FAILED_MESSAGE,
      requestId,
      issuesFromZodError(parsed.error),
    );
    return;
  }
  // A stale tag leaves the current row in place.
  if (expected !== revision) {
    sendError(response, 412, "PRECONDITION_FAILED", "The configuration revision does not match.", requestId);
    return;
  }
  // Store the validated document. The next GET returns the new revision.
  storedDocument = parsed.data;
  revision += 1;
  updatedAt = new Date().toISOString();
  sendConfiguration(response);
}

/**
 * Answers one configuration request.
 *
 * Purpose: GET hydrates the editor and PUT stores a save, using the same paths as the configuration service.
 * Inputs: request, the incoming call. response, the server response.
 * Side effects: may write a status and a body, and may update the in-memory row.
 */
async function handleDataRequest(request, response) {
  // The path and the headers are read before the body is consumed.
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const requestId = requestIdFrom(request);
  const expectedPath = `/v1/configurations/${encodeURIComponent(CONFIGURATION_ID)}`;
  if (!authorized(request)) {
    // A wrong token is not a configuration. The body is not stored.
    await drain(request);
    sendError(response, 401, "UNAUTHORIZED", "Authentication failed.", requestId);
    return;
  }
  if (request.method === "GET" && url.pathname === expectedPath) {
    // The strong tag is the revision the next save must send.
    await drain(request);
    sendConfiguration(response);
    return;
  }
  if (request.method === "PUT" && url.pathname === expectedPath) {
    // The body is the editable document. If-Match is the strong tag from the last GET.
    const text = await readBody(request);
    handlePut(response, text, request.headers["if-match"], requestId);
    return;
  }
  // Any other path is not this fixture's document.
  await drain(request);
  sendError(response, 404, "NOT_FOUND", "Configuration not found.", requestId);
}

/**
 * Opens the data port when it is closed.
 *
 * Purpose: Retry after a closed port can reach the seeded document again.
 * Inputs: none.
 * Side effects: listens on the fixture port. Resolves immediately when it is already listening.
 */
function listenData(dataServer) {
  if (dataListening) {
    // A second open does not bind the port twice.
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    /**
     * Marks the data port as accepting connections.
     *
     * Purpose: the ready flag is set only after listen succeeds.
     * Inputs: none.
     * Side effects: sets dataListening and resolves the caller.
     */
    function onListening() {
      // Drop the error listener so a later request error is not this listen failure.
      dataServer.off("error", onError);
      dataListening = true;
      resolve();
    }

    /**
     * Fails the open when the port cannot be bound.
     *
     * Purpose: a busy port is reported to the caller instead of hanging.
     * Inputs: error, the listen failure.
     * Side effects: rejects the caller.
     */
    function onError(error) {
      // The listening listener must not also resolve.
      dataServer.off("listening", onListening);
      reject(error);
    }

    dataServer.once("listening", onListening);
    dataServer.once("error", onError);
    // Loopback only. The editor process is the client.
    dataServer.listen(FIXTURE_PORT, "127.0.0.1");
  });
}

/**
 * Closes the data port.
 *
 * Purpose: the editor's next load sees a refused connection, which is the load error.
 * Inputs: dataServer, the configuration server.
 * Side effects: stops accepting connections. Resolves immediately when the port is already closed.
 */
function closeData(dataServer) {
  if (!dataListening) {
    // Closing twice is still a closed port.
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    // Drop idle keep-alive sockets so close finishes before the editor's next load.
    if (typeof dataServer.closeAllConnections === "function") {
      dataServer.closeAllConnections();
    }
    // close waits until remaining sockets finish. New connections are refused after that.
    dataServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      dataListening = false;
      resolve();
    });
  });
}

/**
 * Answers one test-control request.
 *
 * Purpose: a journey can reset the row, close the port, or fail one save without sharing drafts.
 * Inputs: request, the incoming call. response, the control response. dataServer, the configuration server.
 * Side effects: may change the row or the data port. Does not return the token or the document.
 */
async function handleControl(request, response, dataServer) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  // Control calls are POST. A browser navigation is not a control.
  if (request.method !== "POST") {
    sendJson(response, 404, { ok: false });
    return;
  }
  await drain(request);
  if (url.pathname === "/reset") {
    // The next test starts from the seed, including after a closed port.
    resetStore();
    await listenData(dataServer);
    sendJson(response, 200, { ok: true, listening: true });
    return;
  }
  if (url.pathname === "/close") {
    // The data port stops accepting connections. Postgres is not involved.
    await closeData(dataServer);
    sendJson(response, 200, { ok: true, listening: false });
    return;
  }
  if (url.pathname === "/open") {
    // Retry can load the row that was stored before the port closed.
    await listenData(dataServer);
    sendJson(response, 200, { ok: true, listening: true });
    return;
  }
  if (url.pathname === "/fail-next-put") {
    // The following save returns 500 once and does not advance the revision.
    failNextPut = true;
    sendJson(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/clear-save-failure") {
    // Restoring the service clears a failure that was not consumed.
    failNextPut = false;
    sendJson(response, 200, { ok: true });
    return;
  }
  sendJson(response, 404, { ok: false });
}

/**
 * Checks the environment and starts both ports.
 *
 * Purpose: the editor and the tests share one seeded fixture for this process.
 * Inputs: none. The port, token, and configuration id come from the environment.
 * Side effects: listens until the process exits.
 */
function startJourneyFixture() {
  // The editor sends this token. A different token is not a configuration.
  const token = requiredEnv("CONFIG_SERVICE_TOKEN");
  const configurationId = requiredEnv("DEMO_CONFIGURATION_ID");
  const port = Number(requiredEnv("FIXTURE_PORT"));
  const controlPort = Number(requiredEnv("CONTROL_PORT"));
  if (
    token !== SERVICE_TOKEN ||
    configurationId !== CONFIGURATION_ID ||
    port !== FIXTURE_PORT ||
    controlPort !== CONTROL_PORT
  ) {
    // The process and this module must name the same stub.
    throw new Error("Fixture environment does not match journey-fixture.mjs");
  }
  const dataServer = createServer((request, response) => {
    // A handler failure becomes a safe 500. The token is not written.
    void handleDataRequest(request, response).catch(() => {
      if (!response.headersSent) {
        sendError(response, 500, "INTERNAL", "The configuration service could not complete the request.", "req_journey");
      }
    });
  });
  const controlServer = createServer((request, response) => {
    // Control failures are reported as 500 without the document.
    void handleControl(request, response, dataServer).catch(() => {
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false });
      }
    });
  });
  // The control port is up before the data port, so Playwright's port check implies both are ready.
  controlServer.listen(CONTROL_PORT, "127.0.0.1", () => {
    listenData(dataServer)
      .then(() => {
        // The log names ports only. It does not name the token.
        console.log(`Journey fixture data port ${FIXTURE_PORT}, control port ${CONTROL_PORT}`);
      })
      .catch((error) => {
        // A bind failure is a message, not an environment dump.
        console.error(error instanceof Error ? error.message : "Journey fixture failed to listen");
        process.exit(1);
      });
  });
}

startJourneyFixture();
