import {
  configurationSchema,
  editableDocumentSchema,
  SUPPORTED_SCHEMA_VERSION,
  type Configuration,
} from "@reactiv/contracts";
import { describe, expect, it } from "vitest";
import type { DraftDocument, DraftSection } from "./draft-document.js";
import { createInitialEditorState, type EditorState } from "./editor-reducer.js";
import {
  captureSaveSnapshot,
  draftMatchesConfiguration,
  editorLoaderShouldRevalidate,
  loaderReconciliationDecision,
  summarizeDraftSections,
  type LoadedDocument,
} from "./save-reconciliation.js";

/**
 * Builds one text section.
 *
 * Purpose: the equality cases can change a title without rebuilding the other fields.
 * Inputs: title, the text title.
 * Side effects: none.
 */
function textSection(title: string): DraftSection {
  // The colors are already normalized. The id stays on this row.
  return {
    id: "text-1",
    type: "text",
    title,
    description: "Body",
    titleColor: "#112233",
    descriptionColor: "#334455",
  };
}

/**
 * Builds a draft that contains one text section.
 *
 * Purpose: reconciliation compares this draft with a loader configuration.
 * Inputs: title, the text title.
 * Side effects: none.
 */
function draftWithTitle(title: string): DraftDocument {
  // One text section is enough for the equality cases.
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections: [textSection(title)] },
  };
}

/**
 * Builds a stored configuration for one title.
 *
 * Purpose: the loader payload needs service fields that the draft does not have.
 * Inputs: title, the text title.
 * Side effects: none.
 */
function configurationWithTitle(title: string): Configuration {
  // id, revision, and updatedAt stay off the comparison. The section title is the difference under test.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections: [textSection(title)] },
    id: "cfg_demo",
    revision: 2,
    updatedAt: "2026-10-13T18:00:00.000Z",
  });
}

/**
 * Builds an editor around one draft.
 *
 * Purpose: the decision reads dirty, the ETag, and whether a save is in flight.
 * Inputs: title, the draft title. dirty, whether the draft has local edits. etag, the known validator.
 * Side effects: none.
 */
function editorAt(title: string, dirty: boolean, etag: string): EditorState {
  // The sequence is nonzero only when the draft is dirty, matching a real edit.
  return {
    ...createInitialEditorState(),
    draft: draftWithTitle(title),
    dirty,
    baseEtag: etag,
    localSequence: dirty ? 2 : 0,
    status: dirty ? "idle" : "idle",
  };
}

/**
 * Builds a loader payload.
 *
 * Purpose: the decision compares this ETag and document with the editor.
 * Inputs: title, the stored title. etag, the validator on the payload.
 * Side effects: none.
 */
function loaded(title: string, etag: string): LoadedDocument {
  return {
    configuration: configurationWithTitle(title),
    etag,
  };
}

/**
 * Asserts the save snapshot does not follow later edits to the source document.
 *
 * Purpose: the click keeps the sequence and a separate document.
 * Inputs: none.
 * Side effects: none.
 */
function expectTheSnapshotToStayImmutable(): void {
  const document = editableDocumentSchema.parse(draftWithTitle("A"));
  const snapshot = captureSaveSnapshot(document, 4, '"1"');
  const section = document.data.sections[0];
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected a text section.");
  }
  // The source changes after the click. The captured body does not.
  section.title = "B";
  expect(snapshot.sequence).toBe(4);
  expect(snapshot.baseEtag).toBe('"1"');
  expect(snapshot.document.data.sections[0]).toMatchObject({ title: "A" });
}

/**
 * Asserts a dirty draft and a different loader document are a conflict, without adopting the tag.
 *
 * Purpose: the decision does not return an ETag and does not change the editor.
 * Inputs: none.
 * Side effects: none.
 */
function expectADifferentLoaderToBeAConflict(): void {
  const state = editorAt("B", true, '"1"');
  const decision = loaderReconciliationDecision(state, loaded("A", '"2"'));
  // The newer tag stays on the payload. The editor's tag is unchanged.
  expect(decision).toBe("conflict");
  expect(state.baseEtag).toBe('"1"');
  expect(state.draft.data.sections[0]).toMatchObject({ title: "B" });
}

/**
 * Asserts the same ETag, a clean draft, an in-flight save, and equal sections are ignored.
 *
 * Purpose: those payloads must not be treated as someone else's update.
 * Inputs: none.
 * Side effects: none.
 */
function expectHarmlessLoaderPayloadsToBeIgnored(): void {
  const dirty = editorAt("B", true, '"1"');
  const clean = editorAt("A", false, '"1"');
  const saving = { ...editorAt("B", true, '"1"'), status: "saving" as const, pendingSave: { sequence: 2, etag: '"1"' } };
  const acknowledged = editorAt("B", true, '"2"');
  // The same validator is the revision we already have, even when the title text differs.
  expect(loaderReconciliationDecision(dirty, loaded("A", '"1"'))).toBe("ignore");
  // A clean editor is not a conflict, and it is not hydrated by this decision.
  expect(loaderReconciliationDecision(clean, loaded("Other", '"9"'))).toBe("ignore");
  // Our own request is still running. The acknowledgement will advance the tag.
  expect(loaderReconciliationDecision(saving, loaded("A", '"2"'))).toBe("ignore");
  // The tag already matches the acknowledgement. The newer title stays local.
  expect(loaderReconciliationDecision(acknowledged, loaded("A", '"2"'))).toBe("ignore");
  // The same sections with a different tag are not adopted.
  expect(draftMatchesConfiguration(dirty.draft, configurationWithTitle("B"))).toBe(true);
  expect(loaderReconciliationDecision(dirty, loaded("B", '"9"'))).toBe("ignore");
}

/**
 * Asserts 412 revalidates and other statuses keep the router default.
 *
 * Purpose: Compare needs the current server document after a stale write. A 503 does not.
 * Inputs: none.
 * Side effects: none.
 */
function expectOnlyAConflictStatusToForceRevalidation(): void {
  // The router would skip a 4xx. A 412 still loads the winner.
  expect(editorLoaderShouldRevalidate(412, false)).toBe(true);
  // A successful save keeps the default, which revalidates.
  expect(editorLoaderShouldRevalidate(200, true)).toBe(true);
  // A service failure keeps the default, which does not revalidate.
  expect(editorLoaderShouldRevalidate(503, false)).toBe(false);
  expect(editorLoaderShouldRevalidate(undefined, true)).toBe(true);
}

/**
 * Asserts the comparison lines name position, type, and the short label.
 *
 * Purpose: Compare can render this list without a diff library.
 * Inputs: none.
 * Side effects: none.
 */
function expectTheSummaryToNameOrderTypeAndLabel(): void {
  const lines = summarizeDraftSections([
    textSection("Dirty title"),
    {
      id: "cta-1",
      type: "cta",
      label: "Go",
      url: "https://example.com/go",
      backgroundColor: "#112233",
      labelColor: "#ffffff",
    },
  ]);
  // The number is the screen order. The word after it is the stored type.
  expect(lines).toEqual(["1. text — Dirty title", "2. cta — Go"]);
}

/**
 * Registers the reconciliation decisions.
 *
 * Purpose: the pure rules can fail without rendering the editor.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerReconciliationCases(): void {
  it("keeps the save snapshot independent of later edits", expectTheSnapshotToStayImmutable);
  it("treats a different dirty loader document as a conflict", expectADifferentLoaderToBeAConflict);
  it("ignores a loader payload that must not replace the draft", expectHarmlessLoaderPayloadsToBeIgnored);
  it("revalidates after 412 and keeps the default otherwise", expectOnlyAConflictStatusToForceRevalidation);
  it("summarizes section order, type, and label", expectTheSummaryToNameOrderTypeAndLabel);
}

describe("save reconciliation", registerReconciliationCases);
