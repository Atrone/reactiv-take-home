import { randomUUID } from "node:crypto";
import {
  HTTP_API_PREFIX,
  configurationSchema,
  errorBodySchema,
} from "@reactiv/contracts";
import type { Configuration, EditableDocument, ErrorCode, ErrorIssue } from "@reactiv/contracts";

/**
 * Server-only client for the private configuration API.
 *
 * This file name ends in `.server.ts`. React Router 7.18.4 keeps `.server` modules
 * out of the client bundle and fails the build if a client module imports one.
 * This is the only editor module that may read CONFIG_SERVICE_TOKEN or open a
 * socket to CONFIG_SERVICE_URL. Route files stay ordinary modules. A loader or
 * action calls this client, and the framework removes that server code from the browser.
 */

/** How long one private call may wait before it is reported unavailable. */
export const CONFIGURATION_REQUEST_TIMEOUT_MS = 5_000;

/**
 * Safe text for a private 401.
 *
 * The service rejected the server credential. That is not a reason to tell the person using the editor to sign in.
 */
export const MISCONFIGURED_CONFIGURATION_MESSAGE =
  "The editor could not reach its configuration service." as const;

/** The example file's token. It is not a credential. */
const PLACEHOLDER_SERVICE_TOKEN = "replace-me";

/** HTTP methods this client sends. */
type ConfigurationMethod = "GET" | "POST" | "PUT";

/** One private call. `etag` is the caller's strong validator, and this module does not invent one. */
type ConfigurationRequest = {
  method: ConfigurationMethod;
  id?: string;
  document?: EditableDocument;
  etag?: string;
  requestId: string;
};

/** A document the service accepted, plus the ETag header it sent. */
export type ConfigurationSuccess = {
  ok: true;
  configuration: Configuration;
  etag: string | null;
};

/** The private service did not answer before the timeout, or the socket failed. */
export type ConfigurationUnavailable = {
  ok: false;
  kind: "unavailable";
};

/** The private service rejected the server credential. The message does not include that credential. */
export type ConfigurationMisconfigured = {
  ok: false;
  kind: "misconfigured";
  message: typeof MISCONFIGURED_CONFIGURATION_MESSAGE;
};

/** A success status or error status whose body was not the contract. The raw body is not included. */
export type ConfigurationInternal = {
  ok: false;
  kind: "internal";
};

/**
 * A contract error from the private service.
 *
 * `code`, `requestId`, and `issues` are kept. The service message and any other body field are not.
 */
export type ConfigurationServiceFailure = {
  ok: false;
  kind: "service";
  status: number;
  code: ErrorCode;
  requestId: string;
  issues?: ErrorIssue[];
};

/** Every result a loader or action can handle without catching a raw fetch rejection. */
export type ConfigurationClientResult =
  | ConfigurationSuccess
  | ConfigurationUnavailable
  | ConfigurationMisconfigured
  | ConfigurationInternal
  | ConfigurationServiceFailure;

/**
 * Setup failure for the editor's private-service environment.
 *
 * Purpose: name the variable that is missing or still the example placeholder, without copying its value.
 * Inputs: problems, one sentence per variable.
 * Side effects: none.
 */
export class EditorServerEnvError extends Error {
  /**
   * Stores the setup sentences on the error.
   *
   * Purpose: let a caller read which variables failed without a second channel that might include a secret.
   * Inputs: problems, the sentences from the environment check.
   * Side effects: none.
   */
  constructor(problems: readonly string[]) {
    // One error can name the URL and the token together. Neither sentence includes a value.
    super(problems.join("\n"));
    // Callers can tell a setup failure from a transport failure by this name.
    this.name = "EditorServerEnvError";
  }
}

/**
 * Reads one environment variable and treats whitespace as missing.
 *
 * Purpose: a blank value is not a usable URL or token.
 * Inputs: name, the variable to read.
 * Side effects: none. The value is not logged.
 */
function readNonBlankEnv(name: string): string | undefined {
  // Read the process environment at call time. There is no fallback credential.
  const value = process.env[name];
  // Unset and whitespace are both missing.
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  // Keep the original text so a token with surrounding spaces can still match the service.
  return value;
}

/**
 * Names a URL that is missing or not a plain http(s) address.
 *
 * Purpose: refuse to call an unset, non-HTTP, or credential-bearing base URL.
 * Inputs: CONFIG_SERVICE_URL from the environment.
 * Side effects: none. The URL text is not included in the sentence.
 */
function serviceUrlProblem(): string | undefined {
  // Blank is missing. There is no built-in service address.
  const raw = readNonBlankEnv("CONFIG_SERVICE_URL");
  if (raw === undefined) {
    return "Missing required environment variable: CONFIG_SERVICE_URL";
  }
  // A value that is not an absolute URL is not a base address we can call.
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return "Invalid environment variable: CONFIG_SERVICE_URL";
  }
  // Only HTTP and HTTPS. file, data, and other schemes are not the private service.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Invalid environment variable: CONFIG_SERVICE_URL";
  }
  // Userinfo would put a credential in the URL. The bearer token is a header, not this.
  if (url.username !== "" || url.password !== "") {
    return "Invalid environment variable: CONFIG_SERVICE_URL";
  }
  return undefined;
}

/**
 * Names a token that is missing or still the example placeholder.
 *
 * Purpose: replace-me is not a credential, and a blank token is not replaced with one.
 * Inputs: CONFIG_SERVICE_TOKEN from the environment.
 * Side effects: none. The token text is not included.
 */
function serviceTokenProblem(): string | undefined {
  // Blank is missing. There is no built-in token.
  const token = readNonBlankEnv("CONFIG_SERVICE_TOKEN");
  if (token === undefined) {
    return "Missing required environment variable: CONFIG_SERVICE_TOKEN";
  }
  // Surrounding spaces do not turn the example placeholder into a credential.
  if (token.trim() === PLACEHOLDER_SERVICE_TOKEN) {
    return "Invalid environment variable: CONFIG_SERVICE_TOKEN";
  }
  return undefined;
}

/**
 * Lists every URL or token problem.
 *
 * Purpose: one failure can name each variable that is not ready.
 * Inputs: CONFIG_SERVICE_URL and CONFIG_SERVICE_TOKEN from the environment.
 * Side effects: none.
 */
function collectEditorServerEnvProblems(): string[] {
  const problems: string[] = [];
  // The base URL is checked before the token so the sentences stay in a stable order.
  const urlProblem = serviceUrlProblem();
  if (urlProblem !== undefined) {
    problems.push(urlProblem);
  }
  // The token check does not print the token, including the example placeholder.
  const tokenProblem = serviceTokenProblem();
  if (tokenProblem !== undefined) {
    problems.push(tokenProblem);
  }
  return problems;
}

/**
 * Fails when the editor cannot call the private service.
 *
 * Purpose: stop at the server entry, and before any socket, when the URL or token is not usable.
 * Inputs: CONFIG_SERVICE_URL and CONFIG_SERVICE_TOKEN from the environment.
 * Side effects: throws EditorServerEnvError. Does not open a socket and does not print a credential.
 */
export function assertEditorServerEnv(): void {
  // Gather every gap so one failure names each problem.
  const problems = collectEditorServerEnvProblems();
  // A ready environment returns without throwing.
  if (problems.length === 0) {
    return;
  }
  // The sentences name variables. They do not include the URL or the token.
  throw new EditorServerEnvError(problems);
}

/**
 * Reads the base URL and bearer token after the setup check has passed.
 *
 * Purpose: give one call a single snapshot of the server environment.
 * Inputs: CONFIG_SERVICE_URL and CONFIG_SERVICE_TOKEN from the environment.
 * Side effects: throws EditorServerEnvError when setup is incomplete.
 */
function readServiceTarget(): { url: string; token: string } {
  // Refuse to open a socket when the URL or token is missing or the token is the example placeholder.
  assertEditorServerEnv();
  // The check above only returns when both values are usable.
  const url = readNonBlankEnv("CONFIG_SERVICE_URL");
  const token = readNonBlankEnv("CONFIG_SERVICE_TOKEN");
  // A concurrent deletion is the same setup failure. Do not fall through to fetch.
  if (url === undefined || token === undefined) {
    throw new EditorServerEnvError(collectEditorServerEnvProblems());
  }
  // Trim the URL for the parser. Send the token unchanged so it can match the service.
  return { url: url.trim(), token };
}

/**
 * Builds the private configurations URL.
 *
 * Purpose: call the configured origin and path, and ignore any query string on the base URL.
 * Inputs: rawBase, the checked CONFIG_SERVICE_URL. id, the configuration id for GET and PUT. Omit id for POST.
 * Side effects: none.
 */
function configurationUrl(rawBase: string, id: string | undefined): string {
  // The setup check already required an http(s) URL without userinfo.
  const base = new URL(rawBase);
  // Keep a base path such as /prefix, and drop a trailing slash so the join is single.
  const prefix = base.pathname.replace(/\/$/, "");
  // POST has no id. GET and PUT encode the id so a slash cannot add another path segment.
  const resource =
    id === undefined
      ? `${HTTP_API_PREFIX}/configurations`
      : `${HTTP_API_PREFIX}/configurations/${encodeURIComponent(id)}`;
  // An absolute path replaces the base path, so the prefix is included in the path itself.
  const url = new URL(`${prefix}${resource}`, base);
  // A query or hash on the configured URL is not forwarded. The credential is the Authorization header.
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Reports whether fetch failed because of the network or the deadline.
 *
 * Purpose: map those failures to unavailable and let any other error surface.
 * Inputs: error, the rejection from fetch or a nested cause.
 * Side effects: none.
 */
function isTransportFailure(error: unknown): boolean {
  // AbortSignal.timeout rejects with TimeoutError. A caller abort is AbortError.
  if (isAbortOrTimeout(error) || error instanceof TypeError) {
    return true;
  }
  // Node fetch often wraps the socket failure in `error.cause`.
  if (typeof error === "object" && error !== null && "cause" in error) {
    const cause = error.cause;
    return isAbortOrTimeout(cause) || cause instanceof TypeError;
  }
  return false;
}

/**
 * Reports whether an error is an abort or a timeout.
 *
 * Purpose: recognize the deadline without reading the error message, which can contain the URL.
 * Inputs: error, a thrown value.
 * Side effects: none.
 */
function isAbortOrTimeout(error: unknown): boolean {
  // DOMException and Error both expose name. Other throws do not count.
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return false;
  }
  // TimeoutError is the deadline. AbortError is the same signal family.
  return error.name === "TimeoutError" || error.name === "AbortError";
}

/**
 * Drops an unread response body.
 *
 * Purpose: release the socket without parsing a body that must not become editor data.
 * Inputs: response, the private response.
 * Side effects: cancels the body stream when it exists.
 */
async function cancelUnreadBody(response: Response): Promise<void> {
  // A response with no body has nothing to parse and nothing to cancel.
  if (response.body === null) {
    return;
  }
  // Cancel so a 401 or redirect body is not copied into a result.
  await response.body.cancel();
}

/**
 * Parses a response body as JSON.
 *
 * Purpose: tell an unreadable body apart from a JSON value the schema can check.
 * Inputs: response, the private response.
 * Side effects: reads the body stream.
 */
async function readJsonBody(response: Response): Promise<unknown> {
  // Read text first so an empty body is not a JSON exception.
  const text = await response.text();
  // An empty success or error body is not the contract.
  if (text.trim() === "") {
    return undefined;
  }
  try {
    // The schema, not this cast, decides whether the value is a configuration or an error.
    return JSON.parse(text) as unknown;
  } catch {
    // Invalid JSON is not editor data and is not a service error we can forward.
    return undefined;
  }
}

/**
 * Returns the unavailable result.
 *
 * Purpose: one shape for a timeout and a refused connection.
 * Inputs: none.
 * Side effects: none.
 */
function unavailableResult(): ConfigurationUnavailable {
  // The kind is the contract. The error message from fetch is not copied, because it can include the URL.
  return { ok: false, kind: "unavailable" };
}

/**
 * Returns the safe 401 result.
 *
 * Purpose: replace the service's authentication text with a sentence that does not mention signing in or the token.
 * Inputs: none.
 * Side effects: none.
 */
function misconfiguredResult(): ConfigurationMisconfigured {
  // The sentence is fixed. The response body is not a source for this message.
  return { ok: false, kind: "misconfigured", message: MISCONFIGURED_CONFIGURATION_MESSAGE };
}

/**
 * Returns the internal result.
 *
 * Purpose: a status we cannot trust did not become editor data.
 * Inputs: none.
 * Side effects: none.
 */
function internalResult(): ConfigurationInternal {
  // The raw body stays here. A token in that body must not be returned.
  return { ok: false, kind: "internal" };
}

/**
 * Reports whether the status is the success status for this method.
 *
 * Purpose: GET and PUT succeed on 200, and POST succeeds on 201.
 * Inputs: method, the call. status, the response status.
 * Side effects: none.
 */
function isSuccessStatus(method: ConfigurationMethod, status: number): boolean {
  // Create is 201. Load and conditional update are 200.
  if (method === "POST") {
    return status === 201;
  }
  return status === 200;
}

/**
 * Parses a success body into a configuration.
 *
 * Purpose: accept only the shared schema, and return the ETag header without building one from revision.
 * Inputs: response, the success response. body, the parsed JSON, or undefined when it was not JSON.
 * Side effects: none.
 */
function successResult(response: Response, body: unknown): ConfigurationClientResult {
  // A success status with no JSON is not a configuration.
  if (body === undefined) {
    return internalResult();
  }
  // Unknown keys, including a token field, fail this parse.
  const parsed = configurationSchema.safeParse(body);
  if (!parsed.success) {
    return internalResult();
  }
  // Use the header the service sent. Do not format revision into a new validator.
  return {
    ok: true,
    configuration: parsed.data,
    etag: response.headers.get("etag"),
  };
}

/**
 * Reports whether a value is a plain object.
 *
 * Purpose: reject arrays and null before copying error fields.
 * Inputs: value, the JSON value.
 * Side effects: none.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  // An array is an object, and it is not the error wrapper.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copies path and message from one issue, and drops every other key.
 *
 * Purpose: a token or stack on an issue does not survive into the schema input.
 * Inputs: value, one JSON issue.
 * Side effects: none.
 */
function pickIssue(value: unknown): Record<string, unknown> | unknown {
  // A non-object issue is left for the schema to reject.
  if (!isRecord(value)) {
    return value;
  }
  // Only the two contract fields are copied. Extra keys are omitted.
  return {
    path: value.path,
    message: value.message,
  };
}

/**
 * Copies the error fields the schema knows, and drops every other key.
 *
 * Purpose: parse code, message, requestId, and issues even when the body also carries a token or a stack.
 * Inputs: value, the JSON body.
 * Side effects: none.
 */
function pickErrorBody(value: unknown): unknown {
  // A body without an object wrapper cannot be the error contract.
  if (!isRecord(value)) {
    return value;
  }
  // The contract wrapper is `{ error }`. Sibling keys are not copied.
  const error = value.error;
  if (!isRecord(error)) {
    return { error };
  }
  const picked: Record<string, unknown> = {};
  // message is required by the schema and is dropped again after a successful parse.
  if ("code" in error) {
    picked.code = error.code;
  }
  if ("message" in error) {
    picked.message = error.message;
  }
  if ("requestId" in error) {
    picked.requestId = error.requestId;
  }
  // Each issue keeps path and message. A token on an issue is not copied.
  if ("issues" in error && Array.isArray(error.issues)) {
    const issues: unknown[] = [];
    for (const issue of error.issues) {
      issues.push(pickIssue(issue));
    }
    picked.issues = issues;
  } else if ("issues" in error) {
    picked.issues = error.issues;
  }
  return { error: picked };
}

/**
 * Copies field issues into a fresh list.
 *
 * Purpose: the result holds path and message, not the schema's internal object.
 * Inputs: issues, the parsed field list.
 * Side effects: none.
 */
function copyIssues(issues: readonly ErrorIssue[]): ErrorIssue[] {
  const copied: ErrorIssue[] = [];
  for (const issue of issues) {
    // Copy the two fields the loader can render. Nothing else is on the parsed issue.
    copied.push({
      path: issue.path,
      message: issue.message,
    });
  }
  return copied;
}

/**
 * Parses an error body into the fields the loader may see.
 *
 * Purpose: keep code, requestId, and issues. Drop the service message and anything outside the schema.
 * Inputs: status, the HTTP status. body, the parsed JSON, or undefined when it was not JSON.
 * Side effects: none.
 */
function serviceErrorResult(status: number, body: unknown): ConfigurationClientResult {
  // A non-JSON error body is not a contract error we can forward.
  if (body === undefined) {
    return internalResult();
  }
  // Strip unknown keys first so a token field does not fail the strict schema.
  const parsed = errorBodySchema.safeParse(pickErrorBody(body));
  if (!parsed.success) {
    return internalResult();
  }
  const failure: ConfigurationServiceFailure = {
    ok: false,
    kind: "service",
    status,
    code: parsed.data.error.code,
    requestId: parsed.data.error.requestId,
  };
  // Validation failures include issues. Other codes omit the field when the service omitted it.
  if (parsed.data.error.issues !== undefined) {
    failure.issues = copyIssues(parsed.data.error.issues);
  }
  // parsed.data.error.message is intentionally not copied.
  return failure;
}

/**
 * Maps one HTTP response onto a typed result.
 *
 * Purpose: turn 401 into the safe misconfigured result, success JSON into a configuration, and contract errors into code, requestId, and issues.
 * Inputs: method, the call. response, the private response.
 * Side effects: reads or cancels the body.
 */
async function interpretResponse(
  method: ConfigurationMethod,
  response: Response,
): Promise<ConfigurationClientResult> {
  // A private 401 means the server credential was rejected. Do not tell the editor user to sign in.
  if (response.status === 401) {
    await cancelUnreadBody(response);
    return misconfiguredResult();
  }
  // Manual redirects stay on this host. Node may expose the 3xx status or an opaque redirect with status 0.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    await cancelUnreadBody(response);
    return internalResult();
  }
  // Success and contract errors both start from JSON. Unreadable JSON becomes internal below.
  const body = await readJsonBody(response);
  if (isSuccessStatus(method, response.status)) {
    return successResult(response, body);
  }
  return serviceErrorResult(response.status, body);
}

/**
 * Chooses the correlation id for one private call.
 *
 * Purpose: send the id the loader or action will show, or a new id when a direct call did not pass one.
 * Inputs: requestId, the caller id, or undefined.
 * Side effects: none.
 */
function callRequestId(requestId: string | undefined): string {
  // A blank id is not sent. The service would replace it, and the two logs would not match.
  if (requestId !== undefined && requestId.trim() !== "") {
    return requestId;
  }
  // Direct calls still get an id the service can accept.
  return randomUUID();
}

/**
 * Sends one authenticated call and maps the outcome.
 *
 * Purpose: attach the server token, bound the wait, and return a typed result instead of a raw fetch rejection.
 * Inputs: request, the method, optional id, optional document, and optional strong ETag.
 * Side effects: opens a socket to CONFIG_SERVICE_URL when setup succeeds. Throws EditorServerEnvError when it does not.
 */
async function requestConfiguration(request: ConfigurationRequest): Promise<ConfigurationClientResult> {
  // Read the environment at call time. A missing token throws before fetch.
  const target = readServiceTarget();
  // The id is encoded in the path. POST does not send one.
  const url = configurationUrl(target.url, request.id);
  const headers = new Headers();
  // The browser never sees this header. Only this server process sends it.
  headers.set("Authorization", `Bearer ${target.token}`);
  headers.set("Accept", "application/json");
  // The same id is on the editor log, the service log, and a failed page.
  headers.set("X-Request-Id", request.requestId);
  let body: string | undefined;
  // GET has no body. POST and PUT send the editable document as JSON.
  if (request.document !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(request.document);
  }
  // The caller supplies the strong ETag. This client does not quote a revision or invent one.
  if (request.etag !== undefined) {
    headers.set("If-Match", request.etag);
  }
  try {
    // Do not follow redirects: the Authorization header must stay on this URL.
    const response = await fetch(url, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      signal: AbortSignal.timeout(CONFIGURATION_REQUEST_TIMEOUT_MS),
    });
    return await interpretResponse(request.method, response);
  } catch (error) {
    // A timeout or a refused connection is unavailable, not a successful write.
    // Do not call fetch again. A timed-out PUT may already have committed, and a second PUT would be another write.
    if (isTransportFailure(error)) {
      return unavailableResult();
    }
    throw error;
  }
}

/**
 * Loads one configuration.
 *
 * Purpose: GET /v1/configurations/:id with the server token.
 * Inputs: id, the configuration id. The tenant is not sent. The service selects its own tenant.
 * Side effects: calls the private service, or throws when the editor environment is not ready.
 */
export function getConfiguration(id: string, requestId?: string): Promise<ConfigurationClientResult> {
  // GET does not send If-Match and does not send a document. The request id is the caller's correlation id.
  return requestConfiguration({ method: "GET", id, requestId: callRequestId(requestId) });
}

/**
 * Creates one configuration.
 *
 * Purpose: POST /v1/configurations with the editable document and the server token.
 * Inputs: document, the portable document. The service assigns id, revision, and updatedAt.
 * Side effects: calls the private service, or throws when the editor environment is not ready.
 */
export function createConfiguration(
  document: EditableDocument,
  requestId?: string,
): Promise<ConfigurationClientResult> {
  // POST does not send an id or an If-Match validator. The request id is the caller's correlation id.
  return requestConfiguration({ method: "POST", document, requestId: callRequestId(requestId) });
}

/**
 * Replaces one configuration when the strong ETag still matches.
 *
 * Purpose: PUT /v1/configurations/:id with If-Match set to the validator the caller already holds.
 * Inputs: id, the configuration id. document, the portable document. etag, the strong ETag from a previous response.
 * Side effects: calls the private service, or throws when the editor environment is not ready. Does not invent a revision.
 */
export function updateConfiguration(
  id: string,
  document: EditableDocument,
  etag: string,
  requestId?: string,
): Promise<ConfigurationClientResult> {
  // If-Match is the given validator, including its quotes. The request id is the caller's correlation id.
  return requestConfiguration({
    method: "PUT",
    id,
    document,
    etag,
    requestId: callRequestId(requestId),
  });
}
