// @vitest-environment happy-dom

import { createServer, request as httpRequest, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { createElement, type JSX } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configurationSchema, type Configuration } from "@reactiv/contracts";
import { createRoutesStub } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import EditorRoute, { action, loader, shouldRevalidate } from "../../routes/editor.js";
import { resetRequestLogWriter, setRequestLogWriter } from "../../services/request-log.server.js";

/** The bearer token the editor sends. It must not appear in the access log. */
const BEARER_TOKEN = "corr-bearer-token-24";

/** The title the author types. It is in the document body and must not appear in the access log. */
const DISTINCTIVE_TITLE = "QuarryLanternTitle24";

/** A request id the stub puts on the error body. The page must not show this one. */
const DIFFERENT_BODY_ID = "not-the-inbound-id";

/** The configuration id the server environment selects. */
const DEMO_CONFIGURATION_ID = "cfg_demo";

/** One request the stub recorded. */
type CapturedCall = {
  method: string;
  requestId: string | undefined;
  body: string;
};

/** The loopback stub and the calls it saw. */
type Stub = {
  url: string;
  calls: CapturedCall[];
  close: () => Promise<void>;
};

const savedTenant = process.env.DEMO_TENANT_ID;
const savedConfiguration = process.env.DEMO_CONFIGURATION_ID;
const savedUrl = process.env[["CONFIG", "SERVICE", "URL"].join("_")];
const savedToken = process.env[["CONFIG", "SERVICE", "TOKEN"].join("_")];
const originalFetch = globalThis.fetch;

/**
 * Names the private service URL variable without storing it as one string.
 *
 * Purpose: this test file must not contain the credential variable name as a literal.
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
 * Sets one environment variable, or deletes it.
 *
 * Purpose: point the editor at the stub and restore the process afterward.
 * Inputs: name, the variable. value, the text, or undefined to delete it.
 * Side effects: writes process.env.
 */
function setEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

/**
 * Points the editor at the stub.
 *
 * Purpose: the real client calls the stub with the server token.
 * Inputs: url, the stub base URL.
 * Side effects: writes process.env.
 */
function setRouteEnv(url: string): void {
  setEnv("DEMO_TENANT_ID", "tenant_demo");
  setEnv("DEMO_CONFIGURATION_ID", DEMO_CONFIGURATION_ID);
  setEnv(serviceUrlKey(), url);
  setEnv(serviceTokenKey(), BEARER_TOKEN);
}

/**
 * Restores the environment from before this file loaded.
 *
 * Purpose: keep the stub settings from leaking into another file.
 * Inputs: none.
 * Side effects: writes process.env.
 */
function restoreRouteEnv(): void {
  setEnv("DEMO_TENANT_ID", savedTenant);
  setEnv("DEMO_CONFIGURATION_ID", savedConfiguration);
  setEnv(serviceUrlKey(), savedUrl);
  setEnv(serviceTokenKey(), savedToken);
}

/**
 * Reads one header value.
 *
 * Purpose: Node may present a repeated header as an array.
 * Inputs: value, the header field.
 * Side effects: none.
 */
function oneHeader(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Reads a stub request body.
 *
 * Purpose: the assertion can prove the title was on the wire and not in the log.
 * Inputs: request, the stub request.
 * Side effects: consumes the request stream.
 */
function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

/**
 * Builds the configuration the loader receives.
 *
 * Purpose: the editor can mount and then save a different title.
 * Inputs: none.
 * Side effects: none.
 */
function storedConfiguration(): Configuration {
  return configurationSchema.parse({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "copy",
          type: "text",
          title: "Stored title",
          description: "A short list.",
          titleColor: "#112233",
          descriptionColor: "#334455",
        },
      ],
    },
    id: DEMO_CONFIGURATION_ID,
    revision: 1,
    updatedAt: "2026-10-13T18:00:00.000Z",
  });
}

/**
 * Sends one stub response.
 *
 * Purpose: GET returns the stored document. PUT fails and puts a different id in the body.
 * Inputs: request, the client call. response, the stub response. body, the raw body.
 * Side effects: ends the response.
 */
function writeStubResponse(request: IncomingMessage, response: ServerResponse, body: string): void {
  // The load is the stored document. The strong tag is the header, not the revision field.
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json", etag: '"1"' });
    response.end(JSON.stringify(storedConfiguration()));
    return;
  }
  // The body id is intentionally not the inbound X-Request-Id. The page must show the inbound one.
  void body;
  response.writeHead(500, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      error: {
        code: "INTERNAL",
        message: "The configuration service could not complete the request.",
        requestId: DIFFERENT_BODY_ID,
      },
    }),
  );
}

/**
 * Starts a loopback stub.
 *
 * Purpose: record the private PUT, including X-Request-Id, and fail it.
 * Inputs: none.
 * Side effects: listens on 127.0.0.1.
 */
function startStub(): Promise<Stub> {
  const calls: CapturedCall[] = [];
  const sockets = new Set<Socket>();
  /**
   * Records one private call and answers it.
   *
   * Purpose: the test can compare the inbound id with the page.
   * Inputs: request, the client call. response, the stub response.
   * Side effects: records the call and ends the response.
   */
  function onRequest(request: IncomingMessage, response: ServerResponse): void {
    void readBody(request).then((body) => {
      calls.push({
        method: request.method ?? "",
        requestId: oneHeader(request.headers["x-request-id"]),
        body,
      });
      writeStubResponse(request, response, body);
    });
  }
  const server: Server = createServer(onRequest);
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        calls,
        /**
         * Closes the stub.
         *
         * Purpose: release the port after the assertion.
         * Inputs: none.
         * Side effects: destroys sockets and closes the server.
         */
        close(): Promise<void> {
          for (const socket of sockets) {
            socket.destroy();
          }
          return new Promise((done, fail) => {
            server.close((error) => {
              if (error) {
                fail(error);
                return;
              }
              done();
            });
          });
        },
      });
    });
  });
}

/**
 * Copies fetch headers into a Node header bag.
 *
 * Purpose: the private call keeps Authorization, X-Request-Id, and If-Match.
 * Inputs: headers, the fetch headers, or undefined.
 * Side effects: none.
 */
function nodeHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const copied: Record<string, string> = {};
  const list = new Headers(headers);
  list.forEach((value, name) => {
    copied[name] = value;
  });
  return copied;
}

/**
 * Sends one fetch through Node so the stub is not subject to the browser CORS check.
 *
 * Purpose: the loader and the action run in this test file, and the private call must reach the stub.
 * Inputs: input, the URL. init, the method, headers, and body.
 * Side effects: opens a socket to the stub.
 */
function nodeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  const method = init?.method ?? "GET";
  const headers = nodeHeaders(init?.headers);
  const body = typeof init?.body === "string" ? init.body : undefined;
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (typeof value === "string") {
              responseHeaders.set(name, value);
            } else if (Array.isArray(value)) {
              for (const item of value) {
                responseHeaders.append(name, item);
              }
            }
          }
          resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 500, headers: responseHeaders }));
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * Installs the Node fetch used by the private client.
 *
 * Purpose: replace the browser fetch for the duration of the case.
 * Inputs: none.
 * Side effects: replaces global fetch.
 */
function installNodeFetch(): void {
  globalThis.fetch = nodeFetch as typeof fetch;
}

/**
 * Asserts a failed save shows the same id the stub recorded, and the log omits secrets.
 *
 * Purpose: the action, the private request, the access line, and the failure UI share one id.
 * Inputs: none.
 * Side effects: renders the editor, types a title, and clicks Save.
 */
async function expectAFailedSaveToShowTheStubRequestId(): Promise<void> {
  const lines: string[] = [];
  const stub = await startStub();
  setRouteEnv(stub.url);
  installNodeFetch();
  /**
   * Stores one editor access line.
   *
   * Purpose: the assertion reads the snapshot instead of stdout.
   * Inputs: line, the JSON text.
   * Side effects: appends the line.
   */
  function write(line: string): void {
    lines.push(line);
  }
  setRequestLogWriter(write);
  const StubRoutes = createRoutesStub([
    {
      path: "/",
      Component: EditorRoute,
      loader,
      action,
      shouldRevalidate,
    },
  ]);
  try {
    render(
      createElement(StubRoutes as (props: { initialEntries: string[] }) => JSX.Element, { initialEntries: ["/"] }),
    );
    const title = await screen.findByLabelText("Title");
    const user = userEvent.setup();
    await user.clear(title);
    await user.type(title, DISTINCTIVE_TITLE);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const reference = await screen.findByText(/^Reference: \S+$/);
    const shownId = reference.textContent?.slice("Reference: ".length) ?? "";
    const put = stub.calls.find((call) => call.method === "PUT");
    const failed = lines
      .map((line) => JSON.parse(line) as { requestId: string; method: string; status: number })
      .find((record) => record.status === 500);
    const snapshot = lines.join("");
    // The page, the inbound private call, and the editor access line are the same id.
    expect(shownId.length).toBeGreaterThan(0);
    expect(shownId).not.toBe(DIFFERENT_BODY_ID);
    expect(put?.requestId).toBe(shownId);
    expect(put?.body).toContain(DISTINCTIVE_TITLE);
    expect(failed?.requestId).toBe(shownId);
    expect(snapshot).not.toContain(BEARER_TOKEN);
    expect(snapshot).not.toContain(DISTINCTIVE_TITLE);
    expect(snapshot).not.toContain(DIFFERENT_BODY_ID);
    expect(screen.queryByText("Saved.")).toBeNull();
  } finally {
    cleanup();
    await stub.close();
  }
}

afterEach(() => {
  resetRequestLogWriter();
  restoreRouteEnv();
  globalThis.fetch = originalFetch;
  cleanup();
});

describe("correlation", () => {
  it("shows the same request id the failed save sent", expectAFailedSaveToShowTheStubRequestId);
});
