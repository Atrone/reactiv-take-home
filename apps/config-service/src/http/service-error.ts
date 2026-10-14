import { randomUUID } from "node:crypto";
import { formatError, type ErrorCode, type ErrorIssue, type FormatErrorInput } from "@reactiv/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { readConfiguredServiceToken } from "../env.js";

/** Safe 401 text. It does not say whether the token was missing or wrong. */
export const AUTHENTICATION_FAILED_MESSAGE = "Authentication failed.";

/** Safe 400 text for a body that is not JSON. */
export const MALFORMED_JSON_MESSAGE = "The request body is not valid JSON.";

/** Safe 413 text. It does not include the body. */
export const PAYLOAD_TOO_LARGE_MESSAGE = "The request body is too large.";

/** Safe 415 text. */
export const UNSUPPORTED_MEDIA_TYPE_MESSAGE = "Content-Type must be application/json.";

/** Safe 429 text. This is the local write guard, not a production quota explanation. */
export const RATE_LIMITED_MESSAGE = "Too many write requests.";

/** Safe 500 text. It does not include a stack, SQL, or upstream body. */
export const INTERNAL_FAILURE_MESSAGE = "The configuration service could not complete the request.";

/** Safe 404 text. It does not say whether another tenant has the id. */
export const CONFIGURATION_NOT_FOUND_MESSAGE = "Configuration not found.";

/** Safe 428 text. It does not echo the header or the document. */
export const PRECONDITION_REQUIRED_MESSAGE = "If-Match must be a strong revision ETag.";

/** Safe 412 text. It does not include the stored revision or the document. */
export const PRECONDITION_FAILED_MESSAGE = "The configuration revision does not match.";

/** One mapped failure, ready for the contract error body. */
type MappedServiceError = {
  statusCode: number;
  code: ErrorCode;
  message: string;
  issues?: ErrorIssue[];
};

/**
 * A failure the service already mapped to a status and a safe message.
 *
 * Purpose: carry the contract code without using the caller's token as the message.
 * Inputs: statusCode, the HTTP status. errorCode, the contract code. message, a safe sentence.
 * Side effects: none.
 */
export class ServiceHttpError extends Error {
  readonly statusCode: number;
  readonly errorCode: ErrorCode;
  readonly issues?: readonly ErrorIssue[];

  /**
   * Stores the status, code, safe message, and optional field issues.
   *
   * Purpose: keep those fields for the error mapper. Validation failures include issues.
   * Inputs: statusCode, errorCode, message, and issues when the code is VALIDATION_FAILED.
   * Side effects: none.
   */
  constructor(statusCode: number, errorCode: ErrorCode, message: string, issues?: readonly ErrorIssue[]) {
    // The Error message is the public sentence. Callers must not pass a token or a document.
    super(message);
    this.name = "ServiceHttpError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    // Field issues belong on validation failures. Other codes omit them.
    if (issues !== undefined) {
      this.issues = issues;
    }
  }
}

/**
 * Copies field issues onto a plain list.
 *
 * Purpose: keep path and message, and leave extra keys off the mapped error.
 * Inputs: issues, the list from a service error.
 * Side effects: none.
 */
function copyIssues(issues: readonly ErrorIssue[]): ErrorIssue[] {
  const copied: ErrorIssue[] = [];
  for (const issue of issues) {
    // One contract issue. The path is the field, such as data.sections[2].url.
    copied.push({
      path: issue.path,
      message: issue.message,
    });
  }
  return copied;
}

/**
 * Reads a Fastify error code when the thrown value has one.
 *
 * Purpose: recognize body-parser failures without copying their messages.
 * Inputs: error, the thrown value.
 * Side effects: none.
 */
function fastifyErrorCode(error: unknown): string | undefined {
  // Strings and bare errors have no Fastify code.
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  // The parser sets code to an FST_ERR string.
  if (typeof error.code !== "string") {
    return undefined;
  }
  return error.code;
}

/**
 * Maps a thrown failure onto the contract error fields.
 *
 * Purpose: one mapper for every /v1 failure, including unexpected exceptions.
 * Inputs: error, the thrown value.
 * Side effects: none. The raw message is not copied for unexpected errors.
 */
export function mapServiceFailure(error: unknown): MappedServiceError {
  // Service errors already have a safe message.
  if (error instanceof ServiceHttpError) {
    const mapped: MappedServiceError = {
      statusCode: error.statusCode,
      code: error.errorCode,
      message: error.message,
    };
    // Validation responses need the field list. Other codes leave it off.
    if (error.issues !== undefined) {
      mapped.issues = copyIssues(error.issues);
    }
    return mapped;
  }
  // Parser failures become the contract codes. Their text is not reused.
  const code = fastifyErrorCode(error);
  if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
    return { statusCode: 413, code: "PAYLOAD_TOO_LARGE", message: PAYLOAD_TOO_LARGE_MESSAGE };
  }
  if (code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
    return { statusCode: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: UNSUPPORTED_MEDIA_TYPE_MESSAGE };
  }
  if (code === "FST_ERR_CTP_INVALID_JSON_BODY" || code === "FST_ERR_CTP_EMPTY_JSON_BODY") {
    return { statusCode: 400, code: "MALFORMED_JSON", message: MALFORMED_JSON_MESSAGE };
  }
  // Anything else is an internal failure. The response does not include the cause.
  return { statusCode: 500, code: "INTERNAL", message: INTERNAL_FAILURE_MESSAGE };
}

/**
 * Replaces secret text with a fixed marker.
 *
 * Purpose: keep a token, cookie, or document out of a log line.
 * Inputs: text, the log text. secrets, values that must not appear.
 * Side effects: none.
 */
function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  // Longer values first, so a document that contains the token is removed whole.
  const ordered = [...secrets].sort((left, right) => right.length - left.length);
  for (const secret of ordered) {
    // An empty secret would split the text into characters.
    if (secret.length === 0) {
      continue;
    }
    redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

/**
 * Serializes a parsed body so it can be removed from a log.
 *
 * Purpose: avoid writing the configuration document when a handler throws after parsing.
 * Inputs: body, the parsed request body.
 * Side effects: none.
 */
function serializedBody(body: unknown): string | undefined {
  // A body that was not parsed is not a document to redact.
  if (body === undefined || body === null) {
    return undefined;
  }
  if (typeof body === "string") {
    return body.length > 0 ? body : undefined;
  }
  try {
    // JSON text is what would leak if the thrown error echoed the body.
    const serialized = JSON.stringify(body);
    return serialized.length > 0 ? serialized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Collects values that logs must not contain.
 *
 * Purpose: redact the credential, the authorization header, cookies, and a parsed body.
 * Inputs: request, the current request.
 * Side effects: reads the configured token. Does not log it.
 */
function logSecrets(request: FastifyRequest): string[] {
  const secrets: string[] = [];
  // The credential itself, when one is configured.
  const token = readConfiguredServiceToken();
  if (token !== undefined) {
    secrets.push(token);
  }
  // The raw header can contain the scheme plus the token.
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.length > 0) {
    secrets.push(authorization);
  }
  // Cookies are not authentication for this service and are not logged.
  const cookie = request.headers.cookie;
  if (typeof cookie === "string" && cookie.length > 0) {
    secrets.push(cookie);
  }
  // A parsed document is not part of the error log.
  const body = serializedBody(request.body);
  if (body !== undefined) {
    secrets.push(body);
  }
  return secrets;
}

/**
 * Keeps stack frames and drops the error message line.
 *
 * Purpose: the log may include the stack location, not the message that may hold SQL or a document.
 * Inputs: error, the thrown value.
 * Side effects: none.
 */
function stackFrames(error: unknown): string {
  // Non-errors have no stack to keep.
  if (!(error instanceof Error) || typeof error.stack !== "string") {
    return "";
  }
  const frames: string[] = [];
  for (const line of error.stack.split("\n")) {
    // Frame lines start with "at ". The first line is the message and is left out.
    if (line.trimStart().startsWith("at ")) {
      frames.push(line);
    }
  }
  return frames.join("\n");
}

/**
 * Reads the id Fastify stored for this request.
 *
 * Purpose: put the same id on the error body and the response header.
 * Inputs: request, the current request.
 * Side effects: none.
 */
function requestIdOf(request: FastifyRequest): string {
  // genReqId already replaced an unsafe header with a UUID.
  if (typeof request.id === "string" && request.id.length > 0) {
    return request.id;
  }
  return randomUUID();
}

/**
 * Writes the request id and error code, and a stack only for 500s.
 *
 * Purpose: log the failure without the token, the Authorization header, cookies, or the document.
 * Inputs: request, the current request. mapped, the safe error. error, the thrown value.
 * Side effects: writes one log line.
 */
function logServiceFailure(request: FastifyRequest, mapped: MappedServiceError, error: unknown): void {
  // Redact before the line is written. The secret list itself is not logged.
  const secrets = logSecrets(request);
  const requestId = redactSecrets(requestIdOf(request), secrets);
  // Unexpected failures may include stack frames. Client errors log the code and the id.
  if (mapped.statusCode >= 500) {
    const stack = redactSecrets(stackFrames(error), secrets);
    request.log.error({ requestId, code: mapped.code, stack }, "request failed");
    return;
  }
  request.log.info({ requestId, code: mapped.code }, "request rejected");
}

/**
 * Sends the contract error body for one thrown failure.
 *
 * Purpose: every /v1 failure uses the same JSON shape.
 * Inputs: error, the thrown value. request, the current request. reply, the response.
 * Side effects: writes the response and one log line. Does not include a stack, SQL, token, or upstream body.
 */
export function handleServiceError(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  // A response that already started cannot be replaced.
  if (reply.sent) {
    return;
  }
  // Map first so the log and the body share one code.
  const mapped = mapServiceFailure(error);
  const requestId = requestIdOf(request);
  logServiceFailure(request, mapped, error);
  // formatError copies only the contract fields. Validation failures include issues.
  const errorFields: FormatErrorInput = {
    code: mapped.code,
    message: mapped.message,
    requestId,
  };
  if (mapped.code === "VALIDATION_FAILED") {
    errorFields.issues = mapped.issues ?? [];
  }
  const body = formatError(errorFields);
  // The header matches the id inside the body.
  reply.header("x-request-id", requestId);
  reply.code(mapped.statusCode).send(body);
}
