import { useRef, type JSX } from "react";
import { data, useInRouterContext, useRevalidator, type ShouldRevalidateFunctionArgs } from "react-router";
import "../features/editor/editor-shell.css";
import { EditorProvider } from "../features/editor/editor-context.js";
import { EditorShell } from "../features/editor/editor-shell.js";
import { LoaderReconciliation } from "../features/editor/loader-reconciliation.js";
import { editorLoaderShouldRevalidate } from "../features/editor/save-reconciliation.js";
import {
  VALIDATION_FAILED_MESSAGE,
  configurationSchema,
  editableDocumentSchema,
  formatError,
  issuesFromZodError,
} from "@reactiv/contracts";
import type { Configuration, ErrorBody, ErrorCode, ErrorIssue, FormatErrorInput } from "@reactiv/contracts";
import {
  EditorServerEnvError,
  MISCONFIGURED_CONFIGURATION_MESSAGE,
  getConfiguration,
  updateConfiguration,
  type ConfigurationClientResult,
} from "../services/configuration.server.js";
import { logEditorRequest } from "../services/request-log.server.js";
import { getDemoScope } from "../services/session.server.js";
import type { Route } from "./+types/editor";

/** Safe document title. It does not name a tenant or a credential. */
const EDITOR_PAGE_TITLE = "Editor";

/** Shown when the private service does not answer. */
const SERVICE_UNAVAILABLE_MESSAGE = "The configuration service is unavailable.";

/** Shown when this tenant has no row for the server-selected id. */
const NOT_FOUND_MESSAGE = "Configuration not found.";

/** Shown on the page when the saved document could not be loaded. It is not a demo document. */
const SAVED_HOME_SCREEN_LOAD_ERROR = "The saved home screen could not be loaded.";

/** Shown on the page when the service has no row. It is not the unavailable sentence. */
const HOME_SCREEN_NOT_FOUND = "This home screen was not found.";

/** Shown when this process cannot complete the load or save. */
const INTERNAL_MESSAGE = "The editor could not complete the request.";

/** Shown when the demo ids are missing. The missing value is not included. */
const DEMO_SCOPE_MESSAGE = "The editor is missing its demo configuration.";

/** Shown when Origin is present and is not this app. */
const ORIGIN_REJECTED_MESSAGE = "The request origin is not allowed.";

/** Shown when the action body is not a JSON object. */
const MALFORMED_JSON_MESSAGE = "The request body is not valid JSON.";

/** Shown when the action has no strong ETag. */
const PRECONDITION_REQUIRED_MESSAGE = "If-Match must be a strong revision ETag.";

/** Shown when the stored revision does not match the submitted tag. */
const PRECONDITION_FAILED_MESSAGE = "The configuration revision does not match.";

/** Shown when the body is larger than the service allows. */
const PAYLOAD_TOO_LARGE_MESSAGE = "The request body is too large.";

/** Shown when the body is not JSON. */
const UNSUPPORTED_MEDIA_TYPE_MESSAGE = "Content-Type must be application/json.";

/** Shown when the service refuses another write. */
const RATE_LIMITED_MESSAGE = "Too many write requests.";

/**
 * Safe sentences for a private-service error code.
 *
 * The service message is not copied. A private authentication failure uses the setup sentence.
 */
const SERVICE_CODE_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: MISCONFIGURED_CONFIGURATION_MESSAGE,
  NOT_FOUND: NOT_FOUND_MESSAGE,
  VALIDATION_FAILED: VALIDATION_FAILED_MESSAGE,
  MALFORMED_JSON: MALFORMED_JSON_MESSAGE,
  PAYLOAD_TOO_LARGE: PAYLOAD_TOO_LARGE_MESSAGE,
  UNSUPPORTED_MEDIA_TYPE: UNSUPPORTED_MEDIA_TYPE_MESSAGE,
  PRECONDITION_REQUIRED: PRECONDITION_REQUIRED_MESSAGE,
  PRECONDITION_FAILED: PRECONDITION_FAILED_MESSAGE,
  RATE_LIMITED: RATE_LIMITED_MESSAGE,
  SERVICE_UNAVAILABLE: SERVICE_UNAVAILABLE_MESSAGE,
  INTERNAL: INTERNAL_MESSAGE,
};

/** A load or save the page can render. `etag` is the strong validator from the service. `requestId` correlates the logs. */
export type EditorSuccess = {
  title: string;
  configuration: Configuration;
  etag: string | null;
  requestId: string;
};

/** A load or save that failed. `error` is the shared error object. */
export type EditorFailure = {
  title: string;
  error: ErrorBody["error"];
};

/** Loader and action data. The tenant id, service URL, and bearer token are not fields. */
export type EditorPageData = EditorSuccess | EditorFailure;

/**
 * Builds a request id for an error this process creates.
 *
 * Purpose: give the page a request id when the private service did not send one.
 * Inputs: none.
 * Side effects: none.
 */
function createRequestId(): string {
  // The id is random. It is not a tenant, a configuration id, or a credential.
  return globalThis.crypto.randomUUID();
}

/**
 * Reports whether a JSON value is a plain object.
 *
 * Purpose: reject arrays and null before reading the action fields.
 * Inputs: value, the parsed JSON.
 * Side effects: none.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  // An array is an object, and it is not the action body.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Copies field issues onto a fresh list.
 *
 * Purpose: keep path and message, and leave any extra key off the page data.
 * Inputs: issues, the list from the schema or the private service.
 * Side effects: none.
 */
function copyIssues(issues: readonly ErrorIssue[]): ErrorIssue[] {
  const copied: ErrorIssue[] = [];
  for (const issue of issues) {
    // One contract issue. The path is the field, such as data.sections[0].title.
    copied.push({
      path: issue.path,
      message: issue.message,
    });
  }
  return copied;
}

/**
 * Returns the safe sentence for a private-service code.
 *
 * Purpose: the page can render a message without copying the service text.
 * Inputs: code, the contract error code.
 * Side effects: none.
 */
function messageForServiceCode(code: ErrorCode): string {
  // The map covers every code. The service message is not a source.
  return SERVICE_CODE_MESSAGES[code];
}

/**
 * Builds a page error from the shared error contract.
 *
 * Purpose: return code, message, request id, and validation issues, and nothing else.
 * Inputs: code, the contract code. message, the safe sentence. requestId, the id to show. issues, field errors for validation only.
 * Side effects: none.
 */
function editorFailure(
  code: ErrorCode,
  message: string,
  requestId: string,
  issues?: readonly ErrorIssue[],
): EditorFailure {
  const input: FormatErrorInput = {
    code,
    message,
    requestId,
  };
  // Validation failures carry issues. Other codes omit the field.
  if (code === "VALIDATION_FAILED") {
    input.issues = copyIssues(issues ?? []);
  }
  // The builder rejects a stack, a token, or any other extra key.
  const formatted = formatError(input);
  return {
    title: EDITOR_PAGE_TITLE,
    error: formatted.error,
  };
}

/**
 * Builds a successful page payload.
 *
 * Purpose: return the configuration, its strong ETag, and a safe title.
 * Inputs: configuration, the parsed document. etag, the ETag header, or null when the service omitted it.
 * Side effects: none. The tenant id and the bearer token are not copied.
 */
function editorSuccess(configuration: Configuration, etag: string | null, requestId: string): EditorSuccess {
  // revision stays on the configuration. etag is the validator a later save sends back.
  // requestId is the correlation id from the start of this loader or action.
  return {
    title: EDITOR_PAGE_TITLE,
    configuration,
    etag,
    requestId,
  };
}

/**
 * Parses a configuration again at this boundary.
 *
 * Purpose: drop a body that does not match the shared schema, including an unknown token field.
 * Inputs: configuration, the value the client returned.
 * Side effects: none.
 */
function acceptedConfiguration(configuration: Configuration): Configuration | undefined {
  // Strict parsing fails when a field outside the contract is present.
  const parsed = configurationSchema.safeParse(configuration);
  if (!parsed.success) {
    return undefined;
  }
  // The parsed value is the page data. The raw object is not returned.
  return parsed.data;
}

/**
 * Maps a private-client failure onto a status and a page error.
 *
 * Purpose: show a structured error and keep the demo document out of a failed load.
 * Inputs: result, an unsuccessful client result.
 * Side effects: none. Does not call the private service again.
 */
function failureFromClient(
  result: Exclude<ConfigurationClientResult, { ok: true }>,
  requestId: string,
): {
  status: number;
  page: EditorFailure;
} {
  // The page shows the id this process generated and sent. A service body with a different id is not copied.
  if (result.kind === "unavailable") {
    return {
      status: 503,
      page: editorFailure("SERVICE_UNAVAILABLE", SERVICE_UNAVAILABLE_MESSAGE, requestId),
    };
  }
  // A private 401 is a server setup problem. The client message does not say to sign in.
  if (result.kind === "misconfigured") {
    return {
      status: 500,
      page: editorFailure("INTERNAL", result.message, requestId),
    };
  }
  // An unreadable body is not editor data.
  if (result.kind === "internal") {
    return {
      status: 500,
      page: editorFailure("INTERNAL", INTERNAL_MESSAGE, requestId),
    };
  }
  // Keep the service status, except 401, which would look like an editor sign-in challenge.
  const status = result.status === 401 ? 500 : result.status;
  return {
    status,
    page: editorFailure(
      result.code,
      messageForServiceCode(result.code),
      requestId,
      result.code === "VALIDATION_FAILED" ? result.issues : undefined,
    ),
  };
}

/**
 * Maps a private-client success onto page data.
 *
 * Purpose: return the parsed configuration and the strong ETag the service sent.
 * Inputs: result, a successful client result.
 * Side effects: none.
 */
function successFromClient(
  result: Extract<ConfigurationClientResult, { ok: true }>,
  requestId: string,
): {
  status: number;
  page: EditorPageData;
} {
  // A success body that fails the schema is not shown.
  const configuration = acceptedConfiguration(result.configuration);
  if (configuration === undefined) {
    return {
      status: 500,
      page: editorFailure("INTERNAL", INTERNAL_MESSAGE, requestId),
    };
  }
  // The ETag is the header value. The request id is the one sent on X-Request-Id.
  return {
    status: 200,
    page: editorSuccess(configuration, result.etag, requestId),
  };
}

/**
 * Maps any private-client result onto page data.
 *
 * Purpose: one path for the loader and the action.
 * Inputs: result, the client result.
 * Side effects: none.
 */
function pageFromClientResult(
  result: ConfigurationClientResult,
  requestId: string,
): { status: number; page: EditorPageData } {
  // Failures become a structured error. Successes become the configuration. Both carry this request id.
  if (!result.ok) {
    return failureFromClient(result, requestId);
  }
  return successFromClient(result, requestId);
}

/**
 * Turns a setup failure into a page error and lets any other error surface.
 *
 * Purpose: a missing service URL or token does not become page text, and it does not become a demo document.
 * Inputs: error, the thrown value.
 * Side effects: returns a 500 page for EditorServerEnvError. Returns undefined for any other error so the caller can rethrow it.
 */
function pageFromSetupError(
  error: unknown,
  requestId: string,
): { status: number; page: EditorFailure } | undefined {
  // The thrown sentence can name a variable. The page uses the fixed setup sentence and this request id.
  if (error instanceof EditorServerEnvError) {
    return {
      status: 500,
      page: editorFailure("INTERNAL", MISCONFIGURED_CONFIGURATION_MESSAGE, requestId),
    };
  }
  // The caller decides whether to rethrow. This function does not hide an unexpected error.
  return undefined;
}

/**
 * Reads the path of a document or action request.
 *
 * Purpose: the access line keeps the path and drops the query.
 * Inputs: request, the loader or action request.
 * Side effects: none.
 */
function requestPath(request: Request): string {
  // The pathname has no search string. A token in the query is not logged.
  return new URL(request.url).pathname;
}

/**
 * Reads the correlation id the page will show.
 *
 * Purpose: the access line uses the same id as the success metadata or the error.
 * Inputs: page, the loader or action payload.
 * Side effects: none.
 */
function pageRequestId(page: EditorPageData): string {
  // An error object carries the id. A success payload carries it beside the configuration.
  if ("error" in page) {
    return page.error.requestId;
  }
  return page.requestId;
}

/**
 * Logs one finished editor request and returns its page data.
 *
 * Purpose: the browser receives the page, and stdout receives one JSON line with the same request id.
 * Inputs: request, the document or action request. status, the HTTP status. page, the payload. startedAt, the start time in milliseconds. loggedBody, the action body when there is one. It is not written.
 * Side effects: writes one access line.
 */
function completeEditorResult(
  request: Request,
  status: number,
  page: EditorPageData,
  startedAt: number,
  loggedBody?: unknown,
) {
  // The line uses the id on the page. Headers and the document body are passed through and not printed.
  logEditorRequest({
    requestId: pageRequestId(page),
    method: request.method,
    path: requestPath(request),
    status,
    durationMs: Date.now() - startedAt,
    headers: request.headers,
    body: loggedBody,
  });
  return data(page, { status });
}

/**
 * Loads the seeded configuration for GET /.
 *
 * Purpose: fetch the server-selected configuration and return it, or a structured error.
 * Inputs: request, the document request. Its query string is not the configuration id.
 * Side effects: calls the private service when the editor environment is ready. Does not insert a row. Writes one access line.
 */
export async function loader({ request }: Route.LoaderArgs) {
  const startedAt = Date.now();
  // This id is sent as X-Request-Id and returned on the page.
  const requestId = createRequestId();
  let configurationId: string;
  try {
    // The id comes from the server environment. The request is ignored by getDemoScope.
    configurationId = getDemoScope(request).configurationId;
  } catch (error) {
    // A missing demo id is a page error. The thrown text is not copied.
    const setup = pageFromSetupError(error, requestId);
    if (setup !== undefined) {
      return completeEditorResult(request, setup.status, setup.page, startedAt);
    }
    return completeEditorResult(
      request,
      500,
      editorFailure("INTERNAL", DEMO_SCOPE_MESSAGE, requestId),
      startedAt,
    );
  }
  try {
    // GET the server-selected id. A miss, a timeout, or a 500 does not create or seed a document.
    const result = await getConfiguration(configurationId, requestId);
    const page = pageFromClientResult(result, requestId);
    return completeEditorResult(request, page.status, page.page, startedAt);
  } catch (error) {
    // A setup failure stays a structured error. Any other failure is not hidden.
    const setup = pageFromSetupError(error, requestId);
    if (setup !== undefined) {
      return completeEditorResult(request, setup.status, setup.page, startedAt);
    }
    throw error;
  }
}

/**
 * Reports whether a present Origin header is not this app.
 *
 * Purpose: refuse a cross-origin POST before the private service is called.
 * A missing Origin is allowed. React Router 7.18.4 runs the same rule in
 * throwIfPotentialCSRFAttack before both document mutations and single-fetch actions:
 * a missing Origin leaves originDomain null, so that check does not reject the request.
 * A same-origin framework submission is covered by that check. A present Origin whose
 * origin is not the request URL origin is rejected here. The header value "null" does
 * not parse as a URL and is rejected.
 * Inputs: request, the action request.
 * Side effects: none.
 */
function originIsCrossSite(request: Request): boolean {
  // A missing header is not a cross-origin value.
  const origin = request.headers.get("Origin");
  if (origin === null) {
    return false;
  }
  // An opaque or unparseable Origin is not this app.
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return true;
  }
  // Compare scheme, host, and port with this request. A different host fails.
  return parsed.origin !== new URL(request.url).origin;
}

/**
 * Reads the action body as a JSON object.
 *
 * Purpose: accept `{ document, baseEtag }` and reject a body that is not JSON or not an object.
 * Inputs: request, the action request.
 * Side effects: reads the body stream.
 */
async function readActionJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    // request.json rejects an empty body and invalid JSON. The raw text is not returned.
    const parsed = (await request.json()) as unknown;
    // Arrays and null are not the action envelope.
    if (!isRecord(parsed)) {
      return undefined;
    }
    return parsed;
  } catch {
    // The caller answers 400. The body text is not copied onto the page.
    return undefined;
  }
}

/**
 * Reads the strong ETag the loader last showed.
 *
 * Purpose: use the caller's validator and ignore every other body field.
 * Inputs: body, the parsed JSON object.
 * Side effects: none. tenantId, configurationId, and actorId are not read.
 */
function readBaseEtag(body: Record<string, unknown>): string | undefined {
  // Only a non-empty string is a validator. A number is not a strong tag.
  const etag = body.baseEtag;
  if (typeof etag !== "string" || etag.trim() === "") {
    return undefined;
  }
  // Keep the original text, including quotes. Do not trim a real tag.
  return etag;
}

/**
 * Saves the editor document for POST /.
 *
 * Purpose: validate the document, then send a conditional PUT with the server-held token.
 * Inputs: request, the action request. Its body does not choose the configuration id.
 * Side effects: calls the private service only after origin, JSON, schema, and ETag checks pass.
 */
export async function action({ request }: Route.ActionArgs) {
  const startedAt = Date.now();
  // This id is sent as X-Request-Id and returned on the page, including when the save fails first.
  const requestId = createRequestId();
  // A cross-origin Origin fails before the body is used and before the private service is called.
  if (originIsCrossSite(request)) {
    return completeEditorResult(
      request,
      403,
      editorFailure("UNAUTHORIZED", ORIGIN_REJECTED_MESSAGE, requestId),
      startedAt,
    );
  }
  // The envelope is JSON. Sibling ids in the body are not read.
  const body = await readActionJson(request);
  if (body === undefined) {
    return completeEditorResult(
      request,
      400,
      editorFailure("MALFORMED_JSON", MALFORMED_JSON_MESSAGE, requestId),
      startedAt,
    );
  }
  // The shared schema is the only document check. A failure does not call the private service.
  const parsed = editableDocumentSchema.safeParse(body.document);
  if (!parsed.success) {
    return completeEditorResult(
      request,
      422,
      editorFailure(
        "VALIDATION_FAILED",
        VALIDATION_FAILED_MESSAGE,
        requestId,
        issuesFromZodError(parsed.error),
      ),
      startedAt,
      body,
    );
  }
  // The strong tag is the one the loader showed. A missing tag is not invented from revision.
  const baseEtag = readBaseEtag(body);
  if (baseEtag === undefined) {
    return completeEditorResult(
      request,
      428,
      editorFailure("PRECONDITION_REQUIRED", PRECONDITION_REQUIRED_MESSAGE, requestId),
      startedAt,
      body,
    );
  }
  let configurationId: string;
  try {
    // The id comes from the server environment. A body configurationId is ignored.
    configurationId = getDemoScope(request).configurationId;
  } catch (error) {
    const setup = pageFromSetupError(error, requestId);
    if (setup !== undefined) {
      return completeEditorResult(request, setup.status, setup.page, startedAt, body);
    }
    return completeEditorResult(
      request,
      500,
      editorFailure("INTERNAL", DEMO_SCOPE_MESSAGE, requestId),
      startedAt,
      body,
    );
  }
  try {
    // One PUT. A timeout comes back as unavailable and is not turned into success or sent again.
    const result = await updateConfiguration(configurationId, parsed.data, baseEtag, requestId);
    const page = pageFromClientResult(result, requestId);
    return completeEditorResult(request, page.status, page.page, startedAt, body);
  } catch (error) {
    // A setup failure stays a structured error. Any other failure is not hidden.
    const setup = pageFromSetupError(error, requestId);
    if (setup !== undefined) {
      return completeEditorResult(request, setup.status, setup.page, startedAt, body);
    }
    throw error;
  }
}

/**
 * Keeps a loaded configuration from being stored by the browser.
 *
 * Purpose: a reload after the service stops shows the error, not a cached document.
 * Inputs: none.
 * Side effects: none.
 */
export function headers(): HeadersInit {
  // The configuration is private to this response.
  return { "Cache-Control": "private, no-store" };
}

/**
 * Sets the document title from the loader.
 *
 * Purpose: the browser title is the safe page title.
 * Inputs: data, the loader payload.
 * Side effects: none.
 */
export function meta({ data: loaderData }: Route.MetaArgs) {
  // The loader sends the title on both success and failure.
  return [{ title: loaderData.title }];
}

/**
 * Decides whether a loader revalidation runs after an action.
 *
 * Purpose: a 412 needs the current server document for Compare and Reload. Other statuses keep the router's choice.
 * Inputs: args, the router revalidation arguments. `actionStatus` is the action's HTTP status when there was one.
 * Side effects: none.
 */
export function shouldRevalidate(args: ShouldRevalidateFunctionArgs): boolean {
  // The helper returns true only for 412. A successful save still follows the default, which revalidates.
  return editorLoaderShouldRevalidate(args.actionStatus, args.defaultShouldRevalidate);
}

/**
 * Chooses the sentence for a failed load.
 *
 * Purpose: an outage or a 500 is not a missing row, and neither one is the demo document.
 * Inputs: code, the error code on the loader payload.
 * Side effects: none.
 */
function loadErrorLead(code: EditorFailure["error"]["code"]): string {
  // Not-found keeps its own sentence. Every other failed load is an outage of the saved document.
  if (code === "NOT_FOUND") {
    return HOME_SCREEN_NOT_FOUND;
  }
  return SAVED_HOME_SCREEN_LOAD_ERROR;
}

/**
 * Returns the action's safe sentence when it adds a reason under the lead.
 *
 * Purpose: the page can say both that the home screen did not load and why, without repeating one sentence.
 * Inputs: failure, the loader payload. lead, the sentence already chosen for this code.
 * Side effects: none.
 */
function loadErrorDetail(failure: EditorFailure, lead: string): string | null {
  // Not-found uses only its own sentence. The service's "Configuration not found." stays off this page.
  if (failure.error.code === "NOT_FOUND") {
    return null;
  }
  // A blank message, or the same words as the lead, does not get a second paragraph.
  if (failure.error.message.trim() === "" || failure.error.message === lead) {
    return null;
  }
  return failure.error.message;
}

/**
 * Loads the document request again from outside the data router.
 *
 * Purpose: a render that is not inside the router can still ask the browser for the page.
 * Inputs: none.
 * Side effects: assigns the current path, which reloads this document.
 */
function reloadDocumentRequest(): void {
  // Keep the path and the query. The query is not the configuration id.
  window.location.assign(`${window.location.pathname}${window.location.search}`);
}

/**
 * Renders the load error and its Retry button.
 *
 * Purpose: the failed load shows the lead sentence, the reference id, and a way to load the document again.
 * Inputs: failure, the loader payload. onRetry, the reload handler. retrying, whether that reload is in flight.
 * Side effects: none until Retry is activated.
 */
function LoadErrorBody({
  failure,
  onRetry,
  retrying,
}: {
  failure: EditorFailure;
  onRetry: () => void;
  retrying: boolean;
}): JSX.Element {
  const lead = loadErrorLead(failure.error.code);
  const detail = loadErrorDetail(failure, lead);
  // The lead is the sentence for this failure. The editor shell is not mounted under it.
  return (
    <main className="load-error">
      <h1>{failure.title}</h1>
      <p role="alert">{lead}</p>
      {detail !== null ? <p>{detail}</p> : null}
      <p>Reference: {failure.error.requestId}</p>
      <button type="button" onClick={onRetry} disabled={retrying}>
        Retry
      </button>
    </main>
  );
}

/**
 * Reloads the document through the data router.
 *
 * Purpose: Retry runs the loader again. It does not create or seed a configuration.
 * Inputs: failure, the loader payload that has an error.
 * Side effects: may revalidate the loader when Retry is activated.
 */
function LoadErrorInRouter({ failure }: { failure: EditorFailure }): JSX.Element {
  const revalidator = useRevalidator();

  /**
   * Asks the router to load the document again.
   *
   * Purpose: the next loader result replaces this error when the service answers.
   * Inputs: none.
   * Side effects: revalidates the route loader. Does not post a document.
   */
  function onRetry(): void {
    // revalidate runs the loader. A 404 or an outage still does not insert a row.
    void revalidator.revalidate();
  }

  // The button stays disabled while that loader request is in flight.
  return <LoadErrorBody failure={failure} onRetry={onRetry} retrying={revalidator.state === "loading"} />;
}

/**
 * Renders the load error.
 *
 * Purpose: a failed first load shows a recoverable error and does not invent a document.
 * Inputs: failure, the loader payload that has an error.
 * Side effects: none until Retry is activated.
 */
function EditorLoadError({ failure }: { failure: EditorFailure }): JSX.Element {
  const inRouter = useInRouterContext();
  // Outside the data router there is no loader to revalidate. The browser reloads the document instead.
  if (!inRouter) {
    return <LoadErrorBody failure={failure} onRetry={reloadDocumentRequest} retrying={false} />;
  }
  return <LoadErrorInRouter failure={failure} />;
}

/**
 * Renders the mounted editor for one retained document.
 *
 * Purpose: the provider hydrates from the first success. Later loader payloads are passed in for reconciliation.
 * Inputs: page, the document the shell title and the first hydrate use. loaded, the latest success, or null when this render failed.
 * Side effects: none. Reconciliation may dispatch after this render.
 */
function MountedEditor({ page, loaded }: { page: EditorSuccess; loaded: EditorSuccess | null }): JSX.Element {
  // The provider copies `page` on its first render only. A later `loaded` value does not hydrate again.
  return (
    <EditorProvider initialConfiguration={page.configuration} initialEtag={page.etag}>
      <LoaderReconciliation loaded={loaded}>
        <EditorShell title={page.title} />
      </LoaderReconciliation>
    </EditorProvider>
  );
}

/**
 * Renders the editor, or the loader error.
 *
 * Purpose: a successful load hydrates the reducer once and shows the shell. A failed first load stays a message.
 * A later failed revalidation keeps the mounted draft. A later successful payload is reconciled and does not hydrate over a dirty draft.
 * Inputs: loaderData, the loader payload.
 * Side effects: none. This component does not fetch and does not hold the service token.
 */
export default function EditorRoute({ loaderData }: Route.ComponentProps): JSX.Element {
  const retainedSuccess = useRef<EditorSuccess | null>(null);
  if (!("error" in loaderData)) {
    // Remember the last document so a failed revalidation does not unmount the draft.
    retainedSuccess.current = loaderData;
  }
  if ("error" in loaderData) {
    const retained = retainedSuccess.current;
    if (retained === null) {
      // The first load failed. There is no draft to keep.
      return <EditorLoadError failure={loaderData} />;
    }
    // The draft stays mounted. This failed payload is not a document to compare.
    return <MountedEditor page={retained} loaded={null} />;
  }
  // A successful payload is both the retained page and the document reconciliation may compare.
  return <MountedEditor page={loaderData} loaded={loaderData} />;
}
