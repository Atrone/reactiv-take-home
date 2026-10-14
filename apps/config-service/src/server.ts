import type { Writable } from "node:stream";
import {
  LIMITS,
  logCompletedRequest,
  writeRequestLogStdout,
  type RequestLogWriter,
} from "@reactiv/contracts";
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { ConfigurationRepository } from "./configurations/repository.js";
import { resolveWriteRateLimitPerMinute } from "./env.js";
import { healthStatus, type HealthStatus } from "./health.js";
import { registerConfigurationRoutes } from "./http/configuration-routes.js";
import { createRequestId } from "./http/request-id.js";
import { handleServiceError } from "./http/service-error.js";
import "./http/types.js";
import { createUnavailableRepository } from "./http/unavailable-repository.js";
import { createV1Guard } from "./http/v1-guard.js";
import { createWriteRateLimit } from "./http/write-rate-limit.js";

/** Options for one in-process server. The process entry uses the defaults. */
export type BuildServerOptions = {
  repository?: ConfigurationRepository;
  writeRateLimitPerMinute?: number;
  /**
   * When false, POST, GET, and PUT configuration routes are left unregistered.
   * Authentication tests install their own handlers on those paths.
   * The process entry leaves this unset so create, load, and update are registered.
   */
  configurationRoutes?: boolean;
  /**
   * Receives one JSON access line. Tests pass this so they do not read stderr.
   * The process entry leaves it unset, and the line is written to stdout.
   */
  requestLog?: RequestLogWriter;
};

/**
 * Builds the request fields that are safe to log.
 *
 * Purpose: omit the query string and headers so a token on the request is not written to the log.
 * Inputs: request, the Fastify request being logged.
 * Side effects: none.
 */
function serializeRequest(request: FastifyRequest): { method: string; url: string } {
  // The path is the part before any query. Headers are not copied.
  const path = request.url.split("?")[0] ?? request.url;
  return {
    method: request.method,
    url: path,
  };
}

/**
 * Handles GET /health.
 *
 * Purpose: return the ok status without reading the request.
 * Inputs: none. The request is unused so a header cannot be copied into the response.
 * Side effects: none.
 */
async function healthRoute(): Promise<HealthStatus> {
  // Use the same helper the sample test calls.
  return healthStatus();
}

/**
 * Chooses where the access line is written.
 *
 * Purpose: production uses stdout. A test can inject a writer, or reuse the Fastify log stream.
 * Inputs: logStream, the optional Fastify destination. requestLog, the optional injected writer.
 * Side effects: none. Writing happens when the returned function is called.
 */
function requestLogWriter(logStream: Writable | undefined, requestLog: RequestLogWriter | undefined): RequestLogWriter {
  // An injected writer wins, so a test does not depend on capturing stderr.
  if (requestLog !== undefined) {
    return requestLog;
  }
  // Existing tests capture the Fastify stream. The access line belongs in that capture.
  if (logStream !== undefined) {
    // Copy the narrowed stream so the nested writer does not see the outer union.
    const stream = logStream;
    /**
     * Writes the access line to the Fastify log stream.
     *
     * Purpose: tests that already collect that stream also see the access line.
     * Inputs: line, the JSON text.
     * Side effects: writes to the stream.
     */
    function writeToLogStream(line: string): void {
      // The stream is the one buildServer was given. It is not stderr.
      stream.write(line);
    }
    return writeToLogStream;
  }
  // The process entry writes the line to stdout.
  return writeRequestLogStdout;
}

/**
 * Writes the access line for one finished request.
 *
 * Purpose: one JSON line with the correlation id, method, path, and status. Headers and the body are not included.
 * Inputs: request, the finished request. reply, the response. write, the log destination.
 * Side effects: calls write with one line.
 */
function logFastifyRequest(request: FastifyRequest, reply: FastifyReply, write: RequestLogWriter): void {
  // The path drops the query so a token in the search string is not logged.
  const path = request.url.split("?")[0] ?? request.url;
  // genReqId already replaced an unsafe X-Request-Id. The access line uses that same id.
  const requestId = typeof request.id === "string" ? request.id : String(request.id);
  logCompletedRequest(
    {
      requestId,
      method: request.method,
      path,
      status: reply.statusCode,
      durationMs: reply.elapsedTime,
      headers: request.headers,
      body: request.body,
    },
    write,
  );
}

/**
 * Builds the configuration service.
 *
 * Purpose: serve public health, protect /v1, and register create, load, and conditional update.
 * Inputs: packageName, the linked contracts package name, recorded in the log and not in responses. logStream, an optional log destination. options, an optional repository, write limit, and route switch.
 * Side effects: creates a Fastify instance. Does not listen, query a database, or enable CORS.
 */
export function buildServer(
  packageName: string,
  logStream?: Writable,
  options?: BuildServerOptions,
): FastifyInstance {
  // Each server has its own write counter. The body limit is the shared 256 KiB ceiling.
  const writeRateLimit = createWriteRateLimit(resolveWriteRateLimitPerMinute(options?.writeRateLimitPerMinute));
  const write = requestLogWriter(logStream, options?.requestLog);
  const app = Fastify({
    bodyLimit: LIMITS.maxPayloadBytes,
    // The access line below is the one request log. Fastify's incoming and completed lines stay off.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: createRequestId,
    logger: {
      level: "info",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers['set-cookie']",
          "res.headers['set-cookie']",
          "req.headers['x-config-token']",
        ],
        remove: true,
      },
      serializers: { req: serializeRequest },
      ...(logStream === undefined ? {} : { stream: logStream }),
    },
  });
  /**
   * Logs one finished request.
   *
   * Purpose: write the access line after the status is known.
   * Inputs: request, the finished request. reply, the response.
   * Side effects: writes one JSON line. Does not write the body.
   */
  async function logResponse(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    // The status on the reply is the one the client received.
    logFastifyRequest(request, reply, write);
  }
  app.addHook("onResponse", logResponse);
  // The tenant field starts empty. The /v1 hook sets it from DEMO_TENANT_ID after authentication.
  app.decorateRequest("tenantId", null);
  // A caller-supplied repository is for tests. The process does not connect here.
  app.decorate("configurationRepository", options?.repository ?? createUnavailableRepository());
  // Record the workspace link without putting it on the health payload.
  app.log.info({ packageName }, "shared contracts package linked");
  // Contract failures use one JSON shape. Unexpected exceptions become a safe 500.
  app.setErrorHandler(handleServiceError);
  // text/plain is not a configuration body. An unmatched type becomes 415.
  app.removeContentTypeParser("text/plain");
  // The tenant is DEMO_TENANT_ID. X-Tenant-Id and a body tenantId are ignored. Do not trust the caller.
  app.addHook("onRequest", createV1Guard(writeRateLimit));
  // Open CORS is intentionally not registered.
  app.get("/health", healthRoute);
  // Create, load, and conditional update. Authentication tests can omit these routes.
  if (options?.configurationRoutes !== false) {
    registerConfigurationRoutes(app);
  }
  return app;
}
