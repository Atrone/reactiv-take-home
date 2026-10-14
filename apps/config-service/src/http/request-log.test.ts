import { PassThrough } from "node:stream";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const tokenKey = "CONFIG_SERVICE_TOKEN";
const tenantKey = "DEMO_TENANT_ID";
const bearerToken = "corr-bearer-token-24";
const distinctiveTitle = "QuarryLanternTitle24";
const requestId = "corr24Service";

let savedToken: string | undefined;
let savedTenant: string | undefined;

/**
 * Remembers the service environment.
 *
 * Purpose: restore the parent process after this file changes the token and tenant.
 * Inputs: none.
 * Side effects: records the current values.
 */
function rememberEnv(): void {
  savedToken = process.env[tokenKey];
  savedTenant = process.env[tenantKey];
}

/**
 * Restores the service environment.
 *
 * Purpose: keep this file from leaking a token into a later file.
 * Inputs: none.
 * Side effects: writes process.env.
 */
function restoreEnv(): void {
  if (savedToken === undefined) {
    delete process.env[tokenKey];
  } else {
    process.env[tokenKey] = savedToken;
  }
  if (savedTenant === undefined) {
    delete process.env[tenantKey];
  } else {
    process.env[tenantKey] = savedTenant;
  }
}

/**
 * Collects Fastify's own log stream.
 *
 * Purpose: prove the pino lines also omit the token and the document title.
 * Inputs: none.
 * Side effects: retains chunks written to the stream.
 */
function collectPinoLogs(): { stream: PassThrough; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new PassThrough();
  /**
   * Retains one pino chunk.
   *
   * Purpose: the assertion searches the service logger as text.
   * Inputs: chunk, one write from the log stream.
   * Side effects: appends the chunk.
   */
  function retainChunk(chunk: Buffer | string): void {
    // A string chunk is encoded the same way a Buffer chunk is.
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  stream.on("data", retainChunk);
  return {
    stream,
    /**
     * Returns the pino text collected so far.
     *
     * Purpose: search the service logger without reading stderr.
     * Inputs: none.
     * Side effects: none.
     */
    text(): string {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

/**
 * Asserts a failed write log omits the bearer token and the document title.
 *
 * Purpose: the access line carries the correlation id, and neither log contains the credential or the body.
 * Inputs: none.
 * Side effects: injects one PUT and closes the server.
 */
async function expectAFailedPutLogOmitsTheTokenAndTitle(): Promise<void> {
  process.env[tokenKey] = bearerToken;
  process.env[tenantKey] = "tenant_demo";
  const lines: string[] = [];
  const pino = collectPinoLogs();
  /**
   * Stores one access line.
   *
   * Purpose: inject the writer the production path would send to stdout.
   * Inputs: line, the JSON text.
   * Side effects: appends the line.
   */
  function write(line: string): void {
    lines.push(line);
  }
  const app: FastifyInstance = buildServer("@reactiv/contracts", pino.stream, {
    requestLog: write,
  });
  try {
    const response = await app.inject({
      method: "PUT",
      url: `/v1/configurations/cfg_demo?access_token=${bearerToken}`,
      headers: {
        authorization: `Bearer ${bearerToken}`,
        cookie: `session=${bearerToken}`,
        "set-cookie": `sid=${bearerToken}`,
        "content-type": "application/json",
        "if-match": '"1"',
        "x-request-id": requestId,
      },
      payload: JSON.stringify({
        schemaVersion: 1,
        data: {
          sections: [
            {
              id: "copy",
              type: "text",
              title: distinctiveTitle,
              description: "kept off the log",
              titleColor: "#112233",
              descriptionColor: "#334455",
            },
          ],
        },
      }),
    });
    const snapshot = lines.join("");
    const record = JSON.parse(lines[0] ?? "") as {
      requestId: string;
      method: string;
      path: string;
      status: number;
    };
    // One access line. It matches the response and does not repeat the document or the credential.
    expect(lines).toHaveLength(1);
    expect(response.statusCode).toBe(500);
    expect(record).toMatchObject({
      requestId,
      method: "PUT",
      path: "/v1/configurations/cfg_demo",
      status: 500,
    });
    expect(snapshot).not.toContain(bearerToken);
    expect(snapshot).not.toContain(distinctiveTitle);
    expect(snapshot).not.toContain("kept off the log");
    const pinoText = pino.text();
    expect(pinoText).not.toContain(bearerToken);
    expect(pinoText).not.toContain(distinctiveTitle);
    expect(pinoText).not.toContain("kept off the log");
  } finally {
    await app.close();
  }
}

rememberEnv();
afterEach(restoreEnv);

describe("request access log", () => {
  it("omits the bearer token and the document title", expectAFailedPutLogOmitsTheTokenAndTitle);
});
