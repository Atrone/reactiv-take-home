import { describe, expect, it } from "vitest";
import { logCompletedRequest, redactSecretHeaders, type RequestLogWriter } from "./request-log.js";

/** A bearer token that must not appear in a log line. */
const BEARER_TOKEN = "corr-bearer-token-24";

/** A cookie value that must not appear in a log line. */
const COOKIE_VALUE = "session-cookie-value-24";

/** A set-cookie value that must not appear in a log line. */
const SET_COOKIE_VALUE = "sid=set-cookie-value-24";

/** A title that is present on the document body and must not appear in a log line. */
const DISTINCTIVE_TITLE = "QuarryLanternTitle24";

/**
 * Collects lines from an injected writer.
 *
 * Purpose: assert on the log text without reading stdout.
 * Inputs: none.
 * Side effects: retains the lines the writer receives.
 */
function captureLogs(): { write: RequestLogWriter; text: () => string } {
  const lines: string[] = [];
  return {
    /**
     * Stores one line.
     *
     * Purpose: stand in for stdout.
     * Inputs: line, the JSON text.
     * Side effects: appends the line.
     */
    write(line: string): void {
      lines.push(line);
    },
    /**
     * Returns the captured text.
     *
     * Purpose: give one string to search.
     * Inputs: none.
     * Side effects: none.
     */
    text(): string {
      return lines.join("");
    },
  };
}

/**
 * Asserts a request line keeps the correlation fields and drops secrets and the body.
 *
 * Purpose: the snapshot of a request that carries a bearer token and a document title contains neither.
 * Inputs: none.
 * Side effects: none.
 */
function expectTheLineOmitsCredentialsAndTheBody(): void {
  const logs = captureLogs();
  logCompletedRequest(
    {
      requestId: "corr-24",
      method: "PUT",
      path: `/v1/configurations/cfg_demo?access_token=${BEARER_TOKEN}`,
      status: 500,
      durationMs: 12,
      headers: {
        authorization: `Bearer ${BEARER_TOKEN}`,
        cookie: COOKIE_VALUE,
        "set-cookie": SET_COOKIE_VALUE,
      },
      body: {
        schemaVersion: 1,
        data: { sections: [{ type: "text", title: DISTINCTIVE_TITLE }] },
      },
    },
    logs.write,
  );
  const snapshot = logs.text();
  const record = JSON.parse(snapshot) as Record<string, unknown>;
  // The correlation fields are the line. The query, the token, and the title are not.
  expect(record).toEqual({
    requestId: "corr-24",
    method: "PUT",
    path: "/v1/configurations/cfg_demo",
    status: 500,
    durationMs: 12,
  });
  expect(snapshot).not.toContain(BEARER_TOKEN);
  expect(snapshot).not.toContain(COOKIE_VALUE);
  expect(snapshot).not.toContain(SET_COOKIE_VALUE);
  expect(snapshot).not.toContain(DISTINCTIVE_TITLE);
  expect(snapshot.endsWith("\n")).toBe(true);
}

/**
 * Asserts a request id that is the bearer token is not written.
 *
 * Purpose: scrubbing covers a credential that was copied into an allowed field.
 * Inputs: none.
 * Side effects: none.
 */
function expectATokenUsedAsTheRequestIdIsScrubbed(): void {
  const logs = captureLogs();
  logCompletedRequest(
    {
      requestId: BEARER_TOKEN,
      method: "GET",
      path: "/health",
      status: 200,
      headers: { authorization: `Bearer ${BEARER_TOKEN}` },
    },
    logs.write,
  );
  const snapshot = logs.text();
  // The token string is gone. The rest of the line remains JSON.
  expect(snapshot).not.toContain(BEARER_TOKEN);
  expect(JSON.parse(snapshot)).toMatchObject({
    requestId: "[redacted]",
    method: "GET",
    path: "/health",
    status: 200,
  });
}

/**
 * Asserts secret header names are removed from a header copy.
 *
 * Purpose: a logger that prints headers still drops authorization, cookie, and set-cookie.
 * Inputs: none.
 * Side effects: none.
 */
function expectSecretHeaderNamesAreRemoved(): void {
  const redacted = redactSecretHeaders({
    authorization: `Bearer ${BEARER_TOKEN}`,
    cookie: COOKIE_VALUE,
    "set-cookie": [SET_COOKIE_VALUE],
    accept: "application/json",
  });
  const text = JSON.stringify(redacted);
  // Accept remains. The three secret names and their values do not.
  expect(redacted).toEqual({ accept: "application/json" });
  expect(text).not.toContain(BEARER_TOKEN);
  expect(text).not.toContain(COOKIE_VALUE);
  expect(text).not.toContain(SET_COOKIE_VALUE);
}

describe("request log", () => {
  it("omits the bearer token, cookies, and the document body", expectTheLineOmitsCredentialsAndTheBody);
  it("scrubs a bearer token that was used as the request id", expectATokenUsedAsTheRequestIdIsScrubbed);
  it("removes authorization, cookie, and set-cookie from a header copy", expectSecretHeaderNamesAreRemoved);
});
