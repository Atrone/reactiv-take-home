import type { FastifyReply, FastifyRequest } from "fastify";
import { readConfiguredServiceToken } from "../env.js";
import { bearerIsValid } from "./bearer-auth.js";
import {
  AUTHENTICATION_FAILED_MESSAGE,
  RATE_LIMITED_MESSAGE,
  ServiceHttpError,
  UNSUPPORTED_MEDIA_TYPE_MESSAGE,
} from "./service-error.js";
import type { WriteRateLimit } from "./write-rate-limit.js";

/**
 * Reads the server-selected demo tenant.
 *
 * Purpose: take the tenant from DEMO_TENANT_ID and not from the caller.
 * Inputs: DEMO_TENANT_ID from the environment.
 * Side effects: none.
 */
function readDemoTenantId(): string | null {
  // An unset or blank tenant is not replaced with a caller-supplied id.
  const value = process.env.DEMO_TENANT_ID;
  if (value === undefined || value.trim() === "") {
    return null;
  }
  return value;
}

/**
 * Reports whether the path is in the private HTTP contract.
 *
 * Purpose: apply authentication to /v1 and leave /health public.
 * Inputs: url, the request path, which may include a query string.
 * Side effects: none.
 */
function isV1Request(url: string): boolean {
  // The query string is not part of the route prefix.
  const path = url.split("?")[0] ?? url;
  return path === "/v1" || path.startsWith("/v1/");
}

/**
 * Reports whether the method is a configuration write.
 *
 * Purpose: rate limit and content-type checks apply to POST and PUT.
 * Inputs: method, the HTTP method.
 * Side effects: none.
 */
function isWriteMethod(method: string): boolean {
  // GET and other reads are not write attempts.
  return method === "POST" || method === "PUT";
}

/**
 * Reports whether the body is JSON.
 *
 * Purpose: accept application/json and reject every other media type.
 * Inputs: header, the Content-Type value.
 * Side effects: none.
 */
function isApplicationJson(header: string | string[] | undefined): boolean {
  // A missing or repeated Content-Type is not JSON.
  if (typeof header !== "string") {
    return false;
  }
  // Parameters such as charset stay on application/json.
  const mediaType = header.split(";")[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json";
}

/**
 * Builds the onRequest hook for /v1.
 *
 * Purpose: authenticate before any configuration read or write. Hiding a route or relying on CORS is not authentication.
 * Inputs: rateLimit, the in-memory write counter for this server.
 * Side effects: none until the returned hook runs.
 */
export function createV1Guard(rateLimit: WriteRateLimit): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  /**
   * Authenticates /v1 and applies the write guards.
   *
   * The tenant is DEMO_TENANT_ID from the environment. X-Tenant-Id and a body tenantId are ignored.
   * Do not trust the caller. A later optional prompt can replace this with a session-derived tenant.
   *
   * Purpose: reject a bad credential before the repository, then limit and check JSON writes.
   * Inputs: request, the current request. reply, the response, used for the request id header.
   * Side effects: may throw a service error. Does not read or write configuration data.
   */
  async function guardV1(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // Every response, including health and errors, carries the id.
    reply.header("x-request-id", request.id);
    // Health and other non-v1 routes stay public.
    if (!isV1Request(request.url)) {
      return;
    }
    // Missing, empty, non-bearer, and mismatched tokens share one 401.
    const expected = readConfiguredServiceToken();
    if (!bearerIsValid(request.headers.authorization, expected)) {
      throw new ServiceHttpError(401, "UNAUTHORIZED", AUTHENTICATION_FAILED_MESSAGE);
    }
    // The tenant comes from the server environment after the credential matches.
    // X-Tenant-Id and a body tenantId are ignored. Do not trust the caller.
    request.tenantId = readDemoTenantId();
    // Reads are not counted toward the write guard.
    if (!isWriteMethod(request.method)) {
      return;
    }
    // A full window fails before the body parser and before the repository.
    if (!rateLimit.tryConsume()) {
      throw new ServiceHttpError(429, "RATE_LIMITED", RATE_LIMITED_MESSAGE);
    }
    // POST and PUT must be JSON. The size limit runs in the parser after this hook.
    if (!isApplicationJson(request.headers["content-type"])) {
      throw new ServiceHttpError(415, "UNSUPPORTED_MEDIA_TYPE", UNSUPPORTED_MEDIA_TYPE_MESSAGE);
    }
  }

  return guardV1;
}
