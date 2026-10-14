import type { IncomingMessage } from "node:http";
import { randomUUID } from "node:crypto";
import { readConfiguredServiceToken } from "../env.js";

/** Incoming ids may use these characters and no more than 80 of them. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Decides whether a caller-supplied request id can be reflected.
 *
 * Purpose: reject spaces, newlines, overlong values, and any id that contains the service token.
 * Inputs: header, one header value. token, the server credential, or an empty string when it is not configured.
 * Side effects: none.
 */
function isAcceptableRequestId(header: string, token: string): boolean {
  // The pattern rejects empty text, spaces, and newlines.
  if (!REQUEST_ID_PATTERN.test(header)) {
    return false;
  }
  // A request id that contains the credential would be written to the log and the response.
  if (token.length > 0 && header.includes(token)) {
    return false;
  }
  return true;
}

/**
 * Chooses the request id for one call.
 *
 * Purpose: keep a safe caller id and otherwise generate a UUID.
 * Inputs: header, the raw X-Request-Id value. token, the server credential used only for the rejection check.
 * Side effects: none.
 */
export function resolveRequestId(header: string | string[] | undefined, token: string): string {
  // Duplicate headers are an array. Do not join or reflect them.
  if (typeof header === "string" && isAcceptableRequestId(header, token)) {
    return header;
  }
  // Replacement ids are UUIDs, which fit the same character rule.
  return randomUUID();
}

/**
 * Builds the Fastify request id.
 *
 * Purpose: validate X-Request-Id before Fastify stores it on the request and the log.
 * Inputs: req, the raw Node request.
 * Side effects: reads CONFIG_SERVICE_TOKEN. Does not log it.
 */
export function createRequestId(req: IncomingMessage): string {
  // Compare against the configured credential so the token is not accepted as an id.
  const token = readConfiguredServiceToken() ?? "";
  return resolveRequestId(req.headers["x-request-id"], token);
}
