import {
  configurationSchema,
  editableDocumentSchema,
  SUPPORTED_SCHEMA_VERSION,
  type Configuration,
  type EditableDocument,
} from "@reactiv/contracts";
import { describe, expect, it } from "vitest";
import type { DraftDocument } from "./draft-document.js";
import { createInitialEditorState, type EditorState } from "./editor-reducer.js";
import {
  SAVED_MESSAGE,
  SAVE_FAILED_MESSAGE,
  buildSaveFetcherCall,
  buildSaveFetcherRequest,
  interpretSaveFetcherResult,
  saveControlDisabled,
} from "./save-document.js";

/** A strong tag used only by these cases. */
const BASE_ETAG = '"4"';

/**
 * Builds one text section draft.
 *
 * Purpose: the disable and request cases share one valid shape, and one case can break a color.
 * Inputs: titleColor, the draft color string.
 * Side effects: none.
 */
function textDraft(titleColor: string): DraftDocument {
  // One text block is enough. The color is the field the invalid case breaks.
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: {
      sections: [
        {
          id: "text-1",
          type: "text",
          title: "Hello",
          description: "Body",
          titleColor,
          descriptionColor: "#334455",
        },
      ],
    },
  };
}

/**
 * Builds an editor state around one draft.
 *
 * Purpose: Save's disabled rule reads dirty, the ETag, and validation.
 * Inputs: draft, the working document. dirty, whether it differs from the baseline.
 * Side effects: none.
 */
function editorWith(draft: DraftDocument, dirty: boolean): EditorState {
  // The other fields stay at the initial values. baseEtag is the tag a save would send.
  return {
    ...createInitialEditorState(),
    draft,
    dirty,
    baseEtag: BASE_ETAG,
    localSequence: dirty ? 1 : 0,
  };
}

/**
 * Builds a stored configuration for an acknowledgement.
 *
 * Purpose: the interpreter needs a schema-valid success body.
 * Inputs: title, the text title on the returned section.
 * Side effects: none.
 */
function storedConfiguration(title: string): Configuration {
  // id, revision, and updatedAt are service-owned. The section is the saved text.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: {
      sections: [
        {
          id: "text-1",
          type: "text",
          title,
          description: "Body",
          titleColor: "#112233",
          descriptionColor: "#334455",
        },
      ],
    },
    id: "cfg_demo",
    revision: 2,
    updatedAt: "2026-10-13T18:00:00.000Z",
  });
}

/**
 * Builds a portable document for the request helper.
 *
 * Purpose: the fetcher body has to be schema-valid JSON.
 * Inputs: none.
 * Side effects: none.
 */
function portableDocument(): EditableDocument {
  // The request carries this document and the ETag, and nothing else.
  return editableDocumentSchema.parse(textDraft("#112233"));
}

/**
 * Asserts Save is disabled for a clean draft and for an invalid draft.
 *
 * Purpose: a clean screen cannot save, and a bad color stays in the draft with Save off.
 * Inputs: none.
 * Side effects: none.
 */
function expectSaveToStayDisabledWhenCleanOrInvalid(): void {
  const valid = textDraft("#112233");
  const invalid = textDraft("nope");
  // The clean draft matches the baseline, so there is nothing to write.
  expect(saveControlDisabled(editorWith(valid, false))).toBe(true);
  // The invalid color fails validation. The helper does not repair the draft.
  expect(saveControlDisabled(editorWith(invalid, true))).toBe(true);
  expect(invalid.data.sections[0]).toMatchObject({ titleColor: "nope" });
  // A dirty valid draft can be saved.
  expect(saveControlDisabled(editorWith(valid, true))).toBe(false);
}

/**
 * Asserts the save request does not carry Authorization or a private-service URL.
 *
 * Purpose: the browser posts to the editor action. A header named Authorization fails this case.
 * Inputs: none.
 * Side effects: none.
 */
async function expectTheSaveRequestToOmitAuthorization(): Promise<void> {
  const document = portableDocument();
  const call = buildSaveFetcherCall(document, BASE_ETAG);
  const request = buildSaveFetcherRequest(call, "http://127.0.0.1:5173/editor");
  const url = new URL(request.url);
  const headerNames = [...request.headers.keys()];
  const body = (await request.json()) as { document: EditableDocument; baseEtag: string };
  // The action path is the app route. The private service port is not the target.
  expect(call.options.action).toBe("/?index");
  expect(call.options.method).toBe("post");
  expect(call.options.encType).toBe("application/json");
  expect(call.options).not.toHaveProperty("headers");
  expect(url.pathname).toBe("/");
  expect(url.search).toBe("?index");
  expect(url.port).not.toBe("4001");
  expect(url.href).not.toContain(":4001");
  expect(request.method).toBe("POST");
  expect(request.headers.get("Authorization")).toBeNull();
  expect(headerNames.map((name) => name.toLowerCase())).not.toContain("authorization");
  expect(headerNames).toEqual(["content-type"]);
  // The JSON body is the document and the loaded tag. It does not name a configuration id.
  expect(body.baseEtag).toBe(BASE_ETAG);
  expect(body.document).toEqual(document);
  expect(JSON.stringify(body)).not.toContain("cfg_demo");
}

/**
 * Asserts an in-flight or repeated fetcher snapshot does not acknowledge.
 *
 * Purpose: Saved is not implied by a success-shaped body while the request is still running, or by the same body twice.
 * Inputs: none.
 * Side effects: none.
 */
function expectAnInFlightFetcherNotToAcknowledge(): void {
  const success = {
    title: "Editor",
    configuration: storedConfiguration("Saved evening"),
    etag: '"9"',
  };
  // submitting still holds the sequence. The body, even a success body, is not an acknowledgement yet.
  expect(interpretSaveFetcherResult("submitting", success, undefined, 1)).toEqual({ kind: "wait" });
  expect(interpretSaveFetcherResult("loading", success, undefined, 1)).toEqual({ kind: "wait" });
  // Idle with the same object captured at click time means the response has not arrived.
  expect(interpretSaveFetcherResult("idle", success, success, 1)).toEqual({ kind: "wait" });
  // No waiting click means a leftover body is not a new acknowledgement.
  expect(interpretSaveFetcherResult("idle", success, undefined, null)).toEqual({ kind: "wait" });
}

/**
 * Asserts a failed action body is not an acknowledgement.
 *
 * Purpose: the draft must stay when the action returns an error, and the sequence must not be treated as saved.
 * Inputs: none.
 * Side effects: none.
 */
function expectAFailedActionNotToAcknowledge(): void {
  const failure = {
    title: "Editor",
    error: {
      code: "SERVICE_UNAVAILABLE",
      message: "The configuration service is unavailable.",
      requestId: "req-1",
    },
  };
  const interpretation = interpretSaveFetcherResult("idle", failure, undefined, 3);
  // The sentence is the action's message. The kind is not acknowledged. The request id stays with the failure.
  expect(interpretation).toEqual({
    kind: "failed",
    message: "The configuration service is unavailable.",
    requestId: "req-1",
  });
  expect(interpretation.kind).not.toBe("acknowledged");
  const internal = interpretSaveFetcherResult(
    "idle",
    {
      title: "Editor",
      error: {
        code: "INTERNAL",
        message: "The editor could not complete the request.",
        requestId: "req-internal",
      },
    },
    undefined,
    3,
  );
  const misconfigured = interpretSaveFetcherResult(
    "idle",
    {
      title: "Editor",
      error: {
        code: "INTERNAL",
        message: "The editor could not reach its configuration service.",
        requestId: "req-misconfigured",
      },
    },
    undefined,
    3,
  );
  const unreadable = interpretSaveFetcherResult("idle", { unexpected: true }, undefined, 3);
  // Internal, misconfigured, and an unreadable network body stay failures. None of them is a saved document.
  expect(internal).toEqual({
    kind: "failed",
    message: "The editor could not complete the request.",
    requestId: "req-internal",
  });
  expect(misconfigured).toEqual({
    kind: "failed",
    message: "The editor could not reach its configuration service.",
    requestId: "req-misconfigured",
  });
  expect(unreadable).toEqual({
    kind: "failed",
    message: SAVE_FAILED_MESSAGE,
    requestId: "",
  });
  expect(SAVE_FAILED_MESSAGE).toBe("The configuration could not be saved.");
}

/**
 * Asserts a matching success body returns the sequence captured at click time.
 *
 * Purpose: the reducer, not the fetcher, decides whether that sequence is still current.
 * Inputs: none.
 * Side effects: none.
 */
function expectAnAcknowledgementToKeepTheCapturedSequence(): void {
  const older = { title: "Editor", configuration: storedConfiguration("A"), etag: '"1"' };
  const success = { title: "Editor", configuration: storedConfiguration("B"), etag: '"9"' };
  const interpretation = interpretSaveFetcherResult("idle", success, older, 4);
  // The sequence is 4, the one passed in from saveStarted. It is not taken from the configuration.
  expect(interpretation).toEqual({
    kind: "acknowledged",
    configuration: success.configuration,
    etag: '"9"',
    sequence: 4,
  });
  expect(SAVED_MESSAGE).toBe("Saved.");
}

/**
 * Asserts a 412 body is a conflict and keeps the request id.
 *
 * Purpose: the fetcher can tell a stale If-Match from a generic failure. The draft is not acknowledged.
 * Inputs: none.
 * Side effects: none.
 */
function expectAPreconditionFailureToBeAConflict(): void {
  const failure = {
    title: "Editor",
    error: {
      code: "PRECONDITION_FAILED",
      message: "The configuration revision does not match.",
      requestId: "req-stale",
    },
  };
  const interpretation = interpretSaveFetcherResult("idle", failure, undefined, 2);
  // The request id is kept. The kind is not acknowledged and not the generic failure.
  expect(interpretation).toEqual({ kind: "conflict", requestId: "req-stale" });
  expect(interpretation.kind).not.toBe("acknowledged");
  expect(interpretation.kind).not.toBe("failed");
}

/**
 * Registers the save-helper cases.
 *
 * Purpose: the request shape and the acknowledgement rule can fail without rendering the shell.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerSaveDocumentCases(): void {
  // Disabled Save, the request headers, and the three fetcher outcomes.
  it("disables Save when the draft is clean or invalid", expectSaveToStayDisabledWhenCleanOrInvalid);
  it("omits Authorization and does not target port 4001", expectTheSaveRequestToOmitAuthorization);
  it("does not acknowledge an in-flight fetcher", expectAnInFlightFetcherNotToAcknowledge);
  it("does not acknowledge a failed action", expectAFailedActionNotToAcknowledge);
  it("reads a 412 as a conflict and keeps the request id", expectAPreconditionFailureToBeAConflict);
  it("returns the sequence captured when Save started", expectAnAcknowledgementToKeepTheCapturedSequence);
}

describe("save document", registerSaveDocumentCases);
