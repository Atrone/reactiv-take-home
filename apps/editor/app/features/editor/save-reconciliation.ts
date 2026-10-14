import type { Configuration, EditableDocument, Section } from "@reactiv/contracts";
import type { DraftDocument, DraftSection } from "./draft-document.js";
import { sectionHint } from "./section-summary.js";
import type { EditorState } from "./editor-reducer.js";

/** Shown when a save acknowledgement is for an older sequence than the draft on screen. */
export const UNSAVED_CHANGES_MESSAGE = "Unsaved changes.";

/** Shown when a newer server document is observed and the local draft is kept. */
export const CONFLICT_MESSAGE = "Someone saved a newer version. Your unsaved changes are still on this page.";

/** Asked before Reload server version replaces the local draft. */
export const RELOAD_CONFIRMATION = "Discard your unsaved changes and load the server version?";

/** A loader success the editor can compare. It is not a command to hydrate. */
export type LoadedDocument = {
  configuration: Configuration;
  etag: string | null;
};

/** The document, sequence, and ETag captured when Save is clicked. */
export type SaveSnapshot = {
  document: EditableDocument;
  sequence: number;
  baseEtag: string;
};

/** What a later loader payload may do to a mounted editor. Hydrate is not one of the choices. */
export type LoaderReconciliation = "ignore" | "conflict";

/**
 * Copies the document Save will send.
 *
 * Purpose: the click keeps an immutable body and the sequence at that moment. Later keystrokes stay on the draft.
 * Inputs: document, the validated draft from this click. sequence, `localSequence` before `saveStarted`.
 * baseEtag, the tag the click will send as `If-Match`.
 * Side effects: none.
 */
export function captureSaveSnapshot(document: EditableDocument, sequence: number, baseEtag: string): SaveSnapshot {
  // The clone is not the draft object. Typing after this click cannot change the body already captured.
  const copied = structuredClone(document);
  return {
    document: copied,
    sequence,
    baseEtag,
  };
}

/**
 * Reports whether one draft section has the same fields as one stored section.
 *
 * Purpose: loader reconciliation can tell a real remote change from the same sections.
 * Inputs: draft, the working section. stored, the section on the loader configuration.
 * Side effects: none.
 */
function sectionMatches(draft: DraftSection, stored: Section): boolean {
  // A different id or type is a different row, even when the text happens to match.
  if (draft.id !== stored.id || draft.type !== stored.type) {
    return false;
  }
  if (draft.type === "text" && stored.type === "text") {
    // Title, body, and both colors are the text fields a reload would replace.
    return (
      draft.title === stored.title &&
      draft.description === stored.description &&
      draft.titleColor === stored.titleColor &&
      draft.descriptionColor === stored.descriptionColor
    );
  }
  if (draft.type === "cta" && stored.type === "cta") {
    // The label, the link, and both colors are the button fields.
    return (
      draft.label === stored.label &&
      draft.url === stored.url &&
      draft.backgroundColor === stored.backgroundColor &&
      draft.labelColor === stored.labelColor
    );
  }
  if (draft.type === "carousel" && stored.type === "carousel") {
    // The ratio and every slide must match, in the stored order.
    if (draft.aspectRatio !== stored.aspectRatio || draft.images.length !== stored.images.length) {
      return false;
    }
    for (let index = 0; index < draft.images.length; index += 1) {
      const draftImage = draft.images[index];
      const storedImage = stored.images[index];
      if (draftImage === undefined || storedImage === undefined) {
        return false;
      }
      if (draftImage.id !== storedImage.id || draftImage.url !== storedImage.url || draftImage.alt !== storedImage.alt) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Reports whether the draft's portable fields equal a loader configuration.
 *
 * Purpose: a different ETag is a conflict only when the sections differ. Service id, revision, and timestamp are not compared.
 * Inputs: draft, the working document. configuration, the loader configuration.
 * Side effects: none.
 */
export function draftMatchesConfiguration(draft: DraftDocument, configuration: Configuration): boolean {
  // schemaVersion is part of the portable document. A mismatch is not the same draft.
  if (draft.schemaVersion !== configuration.schemaVersion) {
    return false;
  }
  const storedSections = configuration.data.sections;
  // Order is the screen order. A shorter list is not the same document.
  if (draft.data.sections.length !== storedSections.length) {
    return false;
  }
  for (let index = 0; index < draft.data.sections.length; index += 1) {
    const draftSection = draft.data.sections[index];
    const storedSection = storedSections[index];
    if (draftSection === undefined || storedSection === undefined) {
      return false;
    }
    // The first differing row makes the documents unequal.
    if (!sectionMatches(draftSection, storedSection)) {
      return false;
    }
  }
  return true;
}

/**
 * Decides how a mounted editor treats one loader payload.
 *
 * Purpose: a revalidation must not hydrate over a dirty draft and must not adopt a newer ETag from someone else.
 * Our own in-flight save is not a conflict. `saveAcknowledged` is the only automatic ETag advance.
 * Inputs: state, the current editor. loaded, the latest successful loader document and ETag.
 * Side effects: none. This function does not dispatch.
 */
export function loaderReconciliationDecision(state: EditorState, loaded: LoadedDocument): LoaderReconciliation {
  // A clean editor has no local work to protect. A later payload still does not hydrate.
  if (!state.dirty) {
    return "ignore";
  }
  // A save is in flight. The acknowledgement or a 412 reconciles that request. The loader must not race it.
  if (state.status === "saving" || state.pendingSave !== null) {
    return "ignore";
  }
  // The same validator is the revision this editor already stored. Leave the draft alone.
  if (loaded.etag === state.baseEtag) {
    return "ignore";
  }
  // A different tag with the same sections is not adopted. Adopting it would let the next Save overwrite that revision.
  if (draftMatchesConfiguration(state.draft, loaded.configuration)) {
    return "ignore";
  }
  return "conflict";
}

/**
 * Decides whether the editor loader should run after an action.
 *
 * Purpose: a 412 still needs the current server document for Compare and Reload. Other statuses keep the router's choice.
 * Inputs: actionStatus, the action HTTP status, when the router has one. defaultShouldRevalidate, the router's own decision.
 * Side effects: none.
 */
export function editorLoaderShouldRevalidate(actionStatus: number | undefined, defaultShouldRevalidate: boolean): boolean {
  // The stale write did not commit. The loader is how Compare and Reload see the winner.
  if (actionStatus === 412) {
    return true;
  }
  // A successful save revalidates. A 503 and other error statuses stay on the router's default, which skips them.
  return defaultShouldRevalidate;
}

/**
 * Builds the plain section list used by Compare.
 *
 * Purpose: show screen order, the stored type, and a short label. There is no diff.
 * Inputs: sections, draft rows or copies of stored rows, in screen order.
 * Side effects: none.
 */
export function summarizeDraftSections(sections: readonly DraftSection[]): string[] {
  const lines: string[] = [];
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    if (section === undefined) {
      continue;
    }
    // The number is the screen position. The hint is the short label for that type.
    lines.push(`${index + 1}. ${section.type} — ${sectionHint(section)}`);
  }
  return lines;
}
