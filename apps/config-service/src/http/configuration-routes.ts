import { VALIDATION_FAILED_MESSAGE, type Configuration, type ErrorIssue } from "@reactiv/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createConfiguration, loadConfiguration, updateConfiguration } from "../configurations/configuration-service.js";
import { parseStrongRevisionEtag, strongRevisionEtag } from "./if-match.js";
import {
  CONFIGURATION_NOT_FOUND_MESSAGE,
  INTERNAL_FAILURE_MESSAGE,
  ServiceHttpError,
} from "./service-error.js";
import { mapUpdateFailure, type UpdateRouteFailure } from "./update-result.js";

/** Private responses are not stored by a shared cache. */
const PRIVATE_CACHE_CONTROL = "private, no-store";

/**
 * Reads the server-selected tenant.
 *
 * Purpose: refuse a write or read when DEMO_TENANT_ID was blank. The caller cannot fill it in.
 * Inputs: request, the current request. tenantId was set by the /v1 guard.
 * Side effects: throws a safe 500 when the tenant is missing. Does not read the repository.
 */
function requireTenantId(request: FastifyRequest): string {
  // Null means the environment tenant was unset or blank. Do not use X-Tenant-Id.
  if (request.tenantId === null) {
    throw new ServiceHttpError(500, "INTERNAL", INTERNAL_FAILURE_MESSAGE);
  }
  return request.tenantId;
}

/**
 * Builds the Location path for a new configuration.
 *
 * Purpose: point the client at the id the service generated.
 * Inputs: id, the stored configuration id.
 * Side effects: none.
 */
function locationFor(id: string): string {
  // The path is relative to this service. It is not a browser origin.
  return `/v1/configurations/${id}`;
}

/**
 * Sends one configuration.
 *
 * Purpose: set the private cache policy and the strong ETag, then return the contract body.
 * Inputs: reply, the response. configuration, the stored document. statusCode, 200 for load and update, 201 for create.
 * Side effects: sets response headers and the status code.
 */
function sendConfiguration(reply: FastifyReply, configuration: Configuration, statusCode: 200 | 201): Configuration {
  // Configuration responses are private. The ETag is the quoted revision.
  reply.header("cache-control", PRIVATE_CACHE_CONTROL);
  reply.header("etag", strongRevisionEtag(configuration.revision));
  if (statusCode === 201) {
    reply.header("location", locationFor(configuration.id));
  }
  reply.code(statusCode);
  return configuration;
}

/**
 * Sends the tenant-scoped not-found error.
 *
 * Purpose: a miss for this tenant is 404. The message does not mention any other tenant.
 * Inputs: reply, the response. The cache header is set before the error handler writes the body.
 * Side effects: throws ServiceHttpError. Does not include the configuration id.
 */
function notFound(reply: FastifyReply): never {
  // Do not cache a miss, and do not attach an ETag for a document that was not returned.
  reply.header("cache-control", PRIVATE_CACHE_CONTROL);
  throw new ServiceHttpError(404, "NOT_FOUND", CONFIGURATION_NOT_FOUND_MESSAGE);
}

/**
 * Sends a validation failure.
 *
 * Purpose: invalid documents are 422 with field paths, and the handler does not write.
 * Inputs: reply, the response. issues, the paths from the shared schema.
 * Side effects: throws ServiceHttpError.
 */
function validationFailed(reply: FastifyReply, issues: readonly ErrorIssue[]): never {
  // The error body uses the shared validation message and these field issues.
  reply.header("cache-control", PRIVATE_CACHE_CONTROL);
  throw new ServiceHttpError(422, "VALIDATION_FAILED", VALIDATION_FAILED_MESSAGE, issues);
}

/**
 * Sends a mapped update failure.
 *
 * Purpose: 404, 412, 422, and 428 share the private cache header and the contract error body.
 * Inputs: reply, the response. failure, the header or service result. A success is not passed here.
 * Side effects: throws ServiceHttpError. Does not write a configuration.
 */
function rejectUpdate(reply: FastifyReply, failure: UpdateRouteFailure): never {
  // The mapper chooses the status. The repository does not know these codes.
  const mapped = mapUpdateFailure(failure);
  // Do not cache a failure, and do not attach an ETag for a document that was not returned.
  reply.header("cache-control", PRIVATE_CACHE_CONTROL);
  throw new ServiceHttpError(mapped.statusCode, mapped.code, mapped.message, mapped.issues);
}

/**
 * Handles POST /v1/configurations.
 *
 * Purpose: store a valid editable document and return 201. Invalid JSON was already rejected by the parser.
 * Inputs: request, the authenticated request. reply, the response.
 * Side effects: inserts one row when the body is valid.
 */
async function createConfigurationRoute(request: FastifyRequest, reply: FastifyReply): Promise<Configuration> {
  // The tenant is DEMO_TENANT_ID. A body tenantId was not copied onto the request.
  const tenantId = requireTenantId(request);
  const created = await createConfiguration(request.server.configurationRepository, {
    tenantId,
    body: request.body,
  });
  // A schema failure leaves the database unchanged. The repository was not called.
  if (!created.ok) {
    if (created.reason === "validation-failed") {
      validationFailed(reply, created.issues);
    }
    // A generated id collided. Do not retry the insert and do not describe the constraint.
    throw new ServiceHttpError(500, "INTERNAL", INTERNAL_FAILURE_MESSAGE);
  }
  return sendConfiguration(reply, created.configuration, 201);
}

/**
 * Handles GET /v1/configurations/:id.
 *
 * Purpose: return one configuration for this tenant, or 404 when this tenant has no such id.
 * Inputs: request, the authenticated request including the id. reply, the response.
 * Side effects: reads one tenant-scoped row. A miss does not insert a row.
 */
async function loadConfigurationRoute(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<Configuration> {
  // The id comes from the path. The tenant still comes from the environment.
  const tenantId = requireTenantId(request);
  const loaded = await loadConfiguration(request.server.configurationRepository, {
    tenantId,
    id: request.params.id,
  });
  // Not-found does not insert a demo row, and it does not fall through to another tenant's row.
  if (!loaded.ok) {
    notFound(reply);
  }
  return sendConfiguration(reply, loaded.configuration, 200);
}

/**
 * Handles PUT /v1/configurations/:id.
 *
 * Purpose: replace the whole document when If-Match is the current strong revision. There is no patch of one section.
 * Inputs: request, the authenticated request. The expected revision is If-Match, not a body field. reply, the response.
 * Side effects: commits one conditional update when the document is valid and the revision matches. Other results do not write.
 */
async function updateConfigurationRoute(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<Configuration> {
  // The tenant is DEMO_TENANT_ID. A body tenantId was not copied onto the request.
  const tenantId = requireTenantId(request);
  // Missing, *, and weak validators are 428 before the body is compared to the stored row.
  const precondition = parseStrongRevisionEtag(request.headers["if-match"]);
  if (!precondition.ok) {
    rejectUpdate(reply, { reason: "precondition-required" });
  }
  // The service validates the editable document before the conditional update, then commits, then returns.
  const updated = await updateConfiguration(request.server.configurationRepository, {
    tenantId,
    id: request.params.id,
    expectedRevision: precondition.revision,
    body: request.body,
  });
  // Not-found, conflict, and validation failures leave the previous row in place.
  if (!updated.ok) {
    rejectUpdate(reply, updated);
  }
  // The repository has committed. 200 carries the new revision and its strong ETag.
  return sendConfiguration(reply, updated.configuration, 200);
}

/**
 * Registers create, load, and conditional update.
 *
 * Purpose: expose POST /v1/configurations, GET /v1/configurations/:id, and PUT /v1/configurations/:id.
 * There is no list route and no PATCH.
 * Inputs: app, the configuration service.
 * Side effects: adds those three routes.
 */
export function registerConfigurationRoutes(app: FastifyInstance): void {
  // Create stores a new document. Load reads one id. Put replaces that id when the revision matches.
  app.post("/v1/configurations", createConfigurationRoute);
  app.get<{ Params: { id: string } }>("/v1/configurations/:id", loadConfigurationRoute);
  app.put<{ Params: { id: string } }>("/v1/configurations/:id", updateConfigurationRoute);
}
