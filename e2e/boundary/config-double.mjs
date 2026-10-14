import { createServer } from "node:http";
import { request as sendUpstream } from "node:http";
import { BOUNDARY_TOKEN, CONFIGURATION_ID } from "./boundary-env.mjs";

/**
 * Sends one JSON response.
 *
 * Purpose: the editor client and the boundary test both read a JSON body.
 * Inputs: response, the server response. status, the HTTP status. body, the JSON value. extraHeaders, optional headers.
 * Side effects: writes the response.
 */
function sendJson(response, status, body, extraHeaders = {}) {
  // The client parses JSON. The credential is not added to the body.
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
 * Reads the request path without the query string.
 *
 * Purpose: match the configuration route and keep the query out of the trace.
 * Inputs: rawUrl, the URL Node put on the request.
 * Side effects: none.
 */
function requestPath(rawUrl) {
  // Node gives the path and query, not an absolute URL.
  const url = new URL(rawUrl ?? "/", "http://127.0.0.1");
  return url.pathname;
}

/**
 * Reads one header as text.
 *
 * Purpose: duplicate headers are not one credential or one ETag.
 * Inputs: value, the header from Node.
 * Side effects: none.
 */
function headerText(value) {
  // A repeated header is not the single Authorization or If-Match value this trace checks.
  if (typeof value !== "string") {
    return "";
  }
  return value;
}

/**
 * Records one private API call.
 *
 * Purpose: the Playwright process can later see the method and the Authorization header.
 * Inputs: calls, the list for this process. request, the incoming call.
 * Side effects: appends one record. Does not write the credential to stdout.
 */
function recordCall(calls, request) {
  // Only the private API is the trace. The observation route itself is not a configuration call.
  const pathname = requestPath(request.url);
  if (!pathname.startsWith("/v1/")) {
    return;
  }
  calls.push({
    method: request.method ?? "",
    path: pathname,
    authorization: headerText(request.headers.authorization),
    ifMatch: headerText(request.headers["if-match"]),
  });
}

/**
 * Builds the configuration document the stub currently stores.
 *
 * Purpose: GET and PUT return the same shape the real service returns.
 * Inputs: state, the in-memory row.
 * Side effects: none.
 */
function configurationBody(state) {
  // revision and updatedAt stay on the record. The browser does not choose them.
  return {
    schemaVersion: 1,
    id: state.configurationId,
    revision: state.revision,
    updatedAt: state.updatedAt,
    data: state.data,
  };
}

/**
 * Formats the strong ETag for the stub's current revision.
 *
 * Purpose: the editor sends this value back as If-Match.
 * Inputs: revision, the stored counter.
 * Side effects: none.
 */
function strongEtag(revision) {
  // The quotes are part of the header value. Example shape: "1".
  return `"${revision}"`;
}

/**
 * Answers 401 without describing the credential.
 *
 * Purpose: a missing or wrong bearer token is not a configuration.
 * Inputs: response, the server response.
 * Side effects: writes the response.
 */
function unauthorized(response) {
  // The message does not include the token. The editor maps 401 to a setup failure.
  sendJson(response, 401, {
    error: {
      code: "UNAUTHORIZED",
      message: "Unauthorized.",
      requestId: "req_boundary",
    },
  });
}

/**
 * Reports whether the caller sent this process's bearer token.
 *
 * Purpose: the stub and the trace both require the header the editor's server client sets.
 * Inputs: request, the incoming call. token, the credential this process expects.
 * Side effects: none.
 */
function bearerMatches(request, token) {
  // The editor sends one Authorization header. Anything else is not authenticated.
  return headerText(request.headers.authorization) === `Bearer ${token}`;
}

/**
 * Creates the in-memory row the stub serves.
 *
 * Purpose: the editor can select the demo text section without Postgres.
 * Inputs: configurationId, the id the editor will request.
 * Side effects: none.
 */
function createStubState(configurationId) {
  // One text section uses the demo title so the same button name works for the stub and the seed.
  return {
    configurationId,
    revision: 1,
    updatedAt: "2026-10-13T16:00:00.000Z",
    data: {
      sections: [
        {
          id: "section-text-1",
          type: "text",
          title: "New this week",
          description: "A short list from the front table.",
          titleColor: "#112233",
          descriptionColor: "#334455",
        },
      ],
    },
  };
}

/**
 * Answers GET and PUT for the stub configuration.
 *
 * Purpose: exercise the editor's real server client when Postgres is not reachable.
 * Inputs: request, the incoming call. response, the server response. state, the in-memory row. token, the expected credential.
 * Side effects: may replace the stored document. Writes one HTTP response.
 */
function handleStub(request, response, state, token) {
  // A wrong credential is 401 before the path is treated as a document.
  if (!bearerMatches(request, token)) {
    unauthorized(response);
    return;
  }
  const pathname = requestPath(request.url);
  const expected = `/v1/configurations/${encodeURIComponent(state.configurationId)}`;
  // Any other path is not this row.
  if (pathname !== expected) {
    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Configuration not found.", requestId: "req_boundary" },
    });
    return;
  }
  // GET returns the current row and the strong tag the next save must send.
  if (request.method === "GET") {
    sendJson(response, 200, configurationBody(state), { etag: strongEtag(state.revision) });
    return;
  }
  // PUT is the conditional update. Other methods are not this API.
  if (request.method !== "PUT") {
    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Configuration not found.", requestId: "req_boundary" },
    });
    return;
  }
  const ifMatch = headerText(request.headers["if-match"]);
  // A missing or different tag does not change the row.
  if (ifMatch !== strongEtag(state.revision)) {
    sendJson(response, 412, {
      error: {
        code: "PRECONDITION_FAILED",
        message: "The configuration revision does not match.",
        requestId: "req_boundary",
      },
    });
    return;
  }
  const chunks = [];

  /**
   * Keeps one piece of the PUT body.
   *
   * Purpose: the body arrives in chunks before it can be parsed.
   * Inputs: chunk, the next piece from Node.
   * Side effects: appends to chunks.
   */
  function collectPutChunk(chunk) {
    // The document body is not the credential. It is kept only until the request ends.
    chunks.push(chunk);
  }

  /**
   * Stores a matching PUT once the body has arrived.
   *
   * Purpose: the stub returns the next revision the way the real service does.
   * Inputs: none. chunks, response, and state are closed over.
   * Side effects: may replace the stored document and writes one response.
   */
  function finishStubPut() {
    // The editor sends the editable document. A body that is not JSON is not stored.
    let parsed;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      sendJson(response, 400, {
        error: { code: "MALFORMED_JSON", message: "The request body is not valid JSON.", requestId: "req_boundary" },
      });
      return;
    }
    // Keep the submitted sections. The stub assigns the next revision and timestamp.
    if (parsed === null || typeof parsed !== "object" || !("data" in parsed)) {
      sendJson(response, 422, {
        error: { code: "VALIDATION_FAILED", message: "Some fields need attention.", requestId: "req_boundary" },
      });
      return;
    }
    state.data = parsed.data;
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    sendJson(response, 200, configurationBody(state), { etag: strongEtag(state.revision) });
  }

  request.on("data", collectPutChunk);
  request.on("end", finishStubPut);
}

/**
 * Forwards one call to the real configuration service.
 *
 * Purpose: the spy sees Authorization, then the real service still performs the read or write.
 * Inputs: request, the incoming call. response, the reply to the editor. upstreamPort, the real service port.
 * Side effects: opens a socket to the upstream port and writes the upstream response.
 */
function handleProxy(request, response, upstreamPort) {
  const chunks = [];

  /**
   * Keeps one piece of the body that will be forwarded.
   *
   * Purpose: the upstream request needs the full body the editor sent.
   * Inputs: chunk, the next piece from Node.
   * Side effects: appends to chunks.
   */
  function collectProxyChunk(chunk) {
    // The document body is forwarded. It is not copied into the observation list.
    chunks.push(chunk);
  }

  /**
   * Copies the upstream status and body back to the editor.
   *
   * Purpose: ETag and the configuration JSON stay the real service's values.
   * Inputs: upstreamResponse, the response from the configuration service.
   * Side effects: writes the editor's response.
   */
  function pipeUpstream(upstreamResponse) {
    // Status and headers, including ETag, pass through unchanged.
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  }

  /**
   * Answers 502 when the upstream socket fails.
   *
   * Purpose: a dead service is not a configuration and does not echo a credential.
   * Inputs: none.
   * Side effects: writes one response when headers have not been sent.
   */
  function reportUpstreamFailure() {
    // A response that already started cannot be replaced.
    if (!response.headersSent) {
      sendJson(response, 502, {
        error: { code: "SERVICE_UNAVAILABLE", message: "The configuration service is unavailable.", requestId: "req_boundary" },
      });
    }
  }

  /**
   * Forwards the buffered call once the editor has finished sending it.
   *
   * Purpose: the spy records the call, then the real service still performs it.
   * Inputs: none. request, response, chunks, and upstreamPort are closed over.
   * Side effects: opens a socket to the upstream port.
   */
  function forwardBufferedRequest() {
    // Copy headers, then point Host at the upstream so the service sees its own address.
    const headers = { ...request.headers };
    headers.host = `127.0.0.1:${upstreamPort}`;
    const upstream = sendUpstream(
      {
        hostname: "127.0.0.1",
        port: upstreamPort,
        path: request.url,
        method: request.method,
        headers,
      },
      pipeUpstream,
    );
    upstream.on("error", reportUpstreamFailure);
    // The body is the editor's document. It is forwarded and not written to the observation list.
    upstream.end(Buffer.concat(chunks));
  }

  request.on("data", collectProxyChunk);
  request.on("end", forwardBufferedRequest);
}

/**
 * Starts the recording observer.
 *
 * Purpose: every authenticated configuration call during the browser session is visible to the test.
 * Inputs: options.listenPort, the port the editor calls. options.mode, "postgres" or "stub".
 * options.upstreamPort, the real service port when mode is postgres. options.token, the expected credential.
 * options.configurationId, the demo id for the stub.
 * Side effects: listens on loopback until close is called.
 */
export function startObserver(options) {
  const calls = [];
  const state = createStubState(options.configurationId ?? CONFIGURATION_ID);
  const token = options.token ?? BOUNDARY_TOKEN;

  /**
   * Answers one observer request.
   *
   * Purpose: serve the trace, or the stub, or a proxy hop.
   * Inputs: request, the incoming call. response, the server response.
   * Side effects: may record a call and write a response.
   */
  function handle(request, response) {
    // Record private API calls before the handler writes. The trace route is skipped inside recordCall.
    recordCall(calls, request);
    const pathname = requestPath(request.url);
    // The test process reads this route. The browser is not given the URL.
    if (request.method === "GET" && pathname === "/__boundary/observations") {
      sendJson(response, 200, { mode: options.mode, calls });
      return;
    }
    // Postgres mode forwards to the real service. Stub mode answers here.
    if (options.mode === "postgres") {
      handleProxy(request, response, options.upstreamPort);
      return;
    }
    handleStub(request, response, state, token);
  }

  const server = createServer(handle);

  /**
   * Closes the observer after the last response finishes.
   *
   * Purpose: the launcher can release the port when the editor exits.
   * Inputs: none.
   * Side effects: stops listening.
   */
  function close() {
    return new Promise(finishClose);
  }

  /**
   * Resolves after the server has stopped accepting connections.
   *
   * Purpose: close waits for in-flight responses.
   * Inputs: done, the promise resolver.
   * Side effects: closes the server.
   */
  function finishClose(done) {
    /**
     * Resolves the close promise.
     *
     * Purpose: the launcher continues after the port is released.
     * Inputs: none.
     * Side effects: resolves done.
     */
    function markClosed() {
      // In-flight responses have finished. The editor is already stopping.
      done();
    }

    server.close(markClosed);
  }

  /**
   * Resolves once the observer is listening.
   *
   * Purpose: the launcher starts the editor only after this port is open.
   * Inputs: resolve, the promise resolver. reject, the promise rejecter.
   * Side effects: binds the loopback port.
   */
  function listen(resolve, reject) {
    /**
     * Hands the close handle to the launcher.
     *
     * Purpose: the port is open, so the editor may start.
     * Inputs: none.
     * Side effects: resolves the start promise.
     */
    function publishHandle() {
      // close is the only method the launcher needs.
      resolve({ close });
    }

    // A bind failure rejects so the launcher does not start the editor against a closed port.
    server.on("error", reject);
    server.listen(options.listenPort, "127.0.0.1", publishHandle);
  }

  return new Promise(listen);
}
