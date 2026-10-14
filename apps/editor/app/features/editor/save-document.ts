import { configurationSchema, type Configuration, type EditableDocument } from "@reactiv/contracts";
import type { FetcherSubmitOptions } from "react-router";
import { validateDraft } from "./draft-document.js";
import type { EditorState } from "./editor-reducer.js";

/** Polite confirmation. It is shown only after the matching acknowledgement. */
export const SAVED_MESSAGE = "Saved.";

/** Shown when a save response cannot be read as a configuration or a structured error. */
export const SAVE_FAILED_MESSAGE = "The configuration could not be saved.";

/** Shown when the action did not store the draft. The draft itself stays on the page. */
export const DRAFT_NOT_SAVED_MESSAGE = "The draft was not saved.";

/**
 * App route that accepts `{ document, baseEtag }`. It is not the private service.
 * `?index` selects the editor index route. A POST to `/` alone hits the root layout, which has no action.
 */
export const SAVE_ACTION_PATH = "/?index";

/** The body and fetcher options for one Save click. */
export type SaveFetcherCall = {
  body: {
    document: EditableDocument;
    baseEtag: string;
  };
  options: FetcherSubmitOptions;
};

/** What the editor should do with one fetcher snapshot. */
export type SaveFetcherInterpretation =
  | { kind: "wait" }
  | { kind: "acknowledged"; configuration: Configuration; etag: string; sequence: number }
  | { kind: "failed"; message: string; requestId: string }
  | { kind: "conflict"; requestId: string };

/** A save body the editor can apply, reject, or treat as a revision conflict. */
type SaveActionRead =
  | { ok: true; configuration: Configuration; etag: string }
  | { ok: false; reason: "conflict"; requestId: string }
  | { ok: false; reason: "failed"; message: string; requestId: string };

/**
 * Reports whether a value is a plain object.
 *
 * Purpose: reject arrays and null before reading a save response.
 * Inputs: value, the fetcher data or one of its fields.
 * Side effects: none.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  // An array is an object, and it is not a save response.
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads a request id from a structured error.
 *
 * Purpose: the failure UI can show the id the action returned, and skip the line when the body has none.
 * Inputs: error, the error object from the action body.
 * Side effects: none.
 */
function readErrorRequestId(error: Record<string, unknown>): string {
  // Only a string is an id. A number or an object is not shown.
  const requestId = error.requestId;
  if (typeof requestId !== "string") {
    return "";
  }
  return requestId;
}

/**
 * Unwraps one `data()` result.
 *
 * Purpose: read the page object whether the router already unwrapped it or left the wrapper in place.
 * Inputs: value, the fetcher data.
 * Side effects: none.
 */
function pageFromFetcherData(value: unknown): unknown {
  // A wrapper carries the page on `data`. A page object is returned as it is.
  if (isRecord(value) && value.type === "DataWithResponseInit" && "data" in value) {
    return value.data;
  }
  return value;
}

/**
 * Reports whether Save must stay disabled.
 *
 * Purpose: a clean draft, a missing ETag, or an invalid draft cannot be written.
 * Field errors stay on the inspectors. This function does not clear them.
 * Inputs: state, the current editor.
 * Side effects: none.
 */
export function saveControlDisabled(state: EditorState): boolean {
  // A document that matches the last acknowledged baseline has nothing new to store.
  if (!state.dirty) {
    return true;
  }
  // If-Match needs the tag from the loader. This control does not invent one.
  if (state.baseEtag === null) {
    return true;
  }
  // An invalid field keeps Save off. The draft, including that field, stays as typed.
  const validity = validateDraft(state.draft);
  return !validity.ok;
}

/**
 * Builds the fetcher submission for Save.
 *
 * Purpose: post the validated document and the loaded ETag to the editor action.
 * Inputs: document, the portable draft. baseEtag, the strong tag the loader showed.
 * Side effects: none. The returned options have no Authorization header and no service URL.
 */
export function buildSaveFetcherCall(document: EditableDocument, baseEtag: string): SaveFetcherCall {
  // The action reads these two fields. The configuration id stays on the server.
  const body = {
    document,
    baseEtag,
  };
  // method, encoding, and the index-route action. There is no headers field and no private token.
  const options: FetcherSubmitOptions = {
    method: "post",
    encType: "application/json",
    action: SAVE_ACTION_PATH,
  };
  return { body, options };
}

/**
 * Builds the HTTP request that matches one Save fetcher call.
 *
 * Purpose: the browser-side request can be checked without posting it.
 * Inputs: call, the body and options Save submits. pageUrl, the editor page used to resolve the action path.
 * Side effects: none. Authorization is not set.
 */
export function buildSaveFetcherRequest(call: SaveFetcherCall, pageUrl: string): Request {
  // The action path is resolved against the editor origin. It is not a service host.
  const action = call.options.action ?? SAVE_ACTION_PATH;
  const url = new URL(action, pageUrl);
  // Content-Type names the JSON body. No other header is added.
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  // The private token is not a browser header. Authorization stays unset.
  return new Request(url, {
    method: (call.options.method ?? "post").toUpperCase(),
    headers,
    body: JSON.stringify(call.body),
  });
}

/**
 * Reads a save response as a configuration, a revision conflict, or a failure message.
 *
 * Purpose: an acknowledgement needs a parsed configuration and a strong ETag.
 * A 412 is `PRECONDITION_FAILED` and keeps the request id. Anything else that is an error is a failure.
 * Inputs: data, the fetcher data after it has changed from the value captured at click time.
 * Side effects: none.
 */
export function readSaveActionResult(data: unknown): SaveActionRead | undefined {
  // Ignore a value that has not arrived. The caller waits while the snapshot is still the old one.
  const page = pageFromFetcherData(data);
  if (!isRecord(page)) {
    return undefined;
  }
  // A structured error keeps the draft. A stale If-Match is a conflict, not a discarded draft.
  if ("error" in page) {
    const error = page.error;
    // A body that is not the error object still keeps the draft. It has no request id to show.
    if (!isRecord(error)) {
      return { ok: false, reason: "failed", message: SAVE_FAILED_MESSAGE, requestId: "" };
    }
    const requestId = readErrorRequestId(error);
    if (error.code === "PRECONDITION_FAILED") {
      // The request id is the one the action put on the 412 body. A missing id is still a conflict.
      return { ok: false, reason: "conflict", requestId };
    }
    if (typeof error.message === "string" && error.message.trim() !== "") {
      // Unavailable, internal, and misconfigured all arrive as this failed shape. The draft is not replaced.
      return { ok: false, reason: "failed", message: error.message, requestId };
    }
    return { ok: false, reason: "failed", message: SAVE_FAILED_MESSAGE, requestId };
  }
  // A success page has a configuration. A body with neither shape is not ready, or is not a save result.
  if (!("configuration" in page)) {
    return undefined;
  }
  const parsed = configurationSchema.safeParse(page.configuration);
  if (!parsed.success) {
    // The page must not adopt a body that fails the shared schema.
    return { ok: false, reason: "failed", message: SAVE_FAILED_MESSAGE, requestId: "" };
  }
  // A missing tag cannot become the next If-Match. Treat that response as a failed save.
  if (typeof page.etag !== "string" || page.etag.trim() === "") {
    return { ok: false, reason: "failed", message: SAVE_FAILED_MESSAGE, requestId: "" };
  }
  return {
    ok: true,
    configuration: parsed.data,
    etag: page.etag,
  };
}

/**
 * Decides whether a fetcher snapshot acknowledges a save, fails it, or is still in flight.
 *
 * Purpose: Saved is not inferred from the fetcher settling. The sequence is the one captured at saveStarted.
 * Inputs: fetcherState, the fetcher status. data, the current fetcher data. dataAtSubmit, the data reference from click time.
 * sequence, the local sequence recorded for this click, or null when no save is waiting.
 * Side effects: none.
 */
export function interpretSaveFetcherResult(
  fetcherState: string,
  data: unknown,
  dataAtSubmit: unknown,
  sequence: number | null,
): SaveFetcherInterpretation {
  // No click is waiting. A leftover success body must not acknowledge again.
  if (sequence === null) {
    return { kind: "wait" };
  }
  // submitting and loading are not an acknowledgement, even when an older body is still on the fetcher.
  if (fetcherState !== "idle") {
    return { kind: "wait" };
  }
  // The click has not received a new body yet. Idle plus the previous data is not success.
  if (data === dataAtSubmit) {
    return { kind: "wait" };
  }
  const result = readSaveActionResult(data);
  if (result === undefined) {
    // The new body is not a save result. Keep the draft and surface the fallback sentence.
    return { kind: "failed", message: SAVE_FAILED_MESSAGE, requestId: "" };
  }
  if (!result.ok && result.reason === "conflict") {
    // 412 keeps the draft. Do not submit again with a newer tag from this body.
    return { kind: "conflict", requestId: result.requestId };
  }
  if (!result.ok) {
    // The action refused the write. The sequence is dropped by the caller. The draft stays.
    return { kind: "failed", message: result.message, requestId: result.requestId };
  }
  // The sequence is the one from saveStarted, not the sequence after later keystrokes.
  return {
    kind: "acknowledged",
    configuration: result.configuration,
    etag: result.etag,
    sequence,
  };
}
