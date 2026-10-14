import type { EditableDocument } from "@reactiv/contracts";
import { validateDraft, type DraftDocument } from "./draft-document.js";

/** Downloaded file name. It is the portable document, not a service record. */
export const EXPORT_FILENAME = "home-screen.json";

/** Shown when Export JSON is clicked and the draft does not validate. */
export const EXPORT_BLOCKED_MESSAGE = "Fix the highlighted fields before exporting.";

/** A file the browser should save, or the status sentence when the draft is invalid. */
export type JsonExportPlan =
  | { ok: true; filename: string; contents: string }
  | { ok: false; message: string };

/**
 * Copies the portable fields from a validated document.
 *
 * Purpose: the file can contain `schemaVersion` and `data` and nothing the service owns.
 * Inputs: document, the document returned by a successful `validateDraft`.
 * Side effects: none.
 */
function portableDocument(document: EditableDocument): Pick<EditableDocument, "schemaVersion" | "data"> {
  // Section order is the validated array order. Colors on that array are already lowercase #rrggbb.
  return {
    schemaVersion: document.schemaVersion,
    data: {
      sections: document.data.sections,
    },
  };
}

/**
 * Pretty-prints a validated document as UTF-8 JSON text.
 *
 * Purpose: Export JSON can hand one string to the download helper.
 * Inputs: document, the document returned by a successful `validateDraft`.
 * Side effects: none.
 */
export function serializePortableDocument(document: EditableDocument): string {
  // Two spaces is the file indent. The string is Unicode text; the download encodes it as UTF-8.
  return JSON.stringify(portableDocument(document), null, 2);
}

/**
 * Plans an export of the current draft.
 *
 * Purpose: a failed validation produces a status message and no file text.
 * Inputs: draft, the working document, including unsaved edits. This function does not change it.
 * Side effects: none. It does not download and it does not call the configuration service.
 */
export function prepareJsonExport(draft: DraftDocument): JsonExportPlan {
  // Colors that already parse are normalized on the validation copy. The draft keeps the typed text.
  const validity = validateDraft(draft);
  if (!validity.ok) {
    // No file contents. The caller must not start a download.
    return { ok: false, message: EXPORT_BLOCKED_MESSAGE };
  }
  // The validated document is the file. Service id, revision, and timestamp are not on it.
  return {
    ok: true,
    filename: EXPORT_FILENAME,
    contents: serializePortableDocument(validity.document),
  };
}

/**
 * Browser download used by Export JSON.
 *
 * Tests replace `save` and read the filename and the file text. The real method stays in place for the browser.
 */
export const jsonFileDownload = {
  /**
   * Saves UTF-8 JSON with the browser's file download.
   *
   * Purpose: a valid draft becomes `home-screen.json` without a service request.
   * Inputs: filename, the download name. contents, the pretty-printed JSON text.
   * Side effects: clicks a temporary anchor and then revokes the object URL.
   */
  save(filename: string, contents: string): void {
    // The blob encodes this string as UTF-8. The type names the file as JSON.
    const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
    // The object URL exists only long enough for the browser to start the download.
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    // The anchor is not a control the author tabs to. It only carries the download.
    anchor.tabIndex = -1;
    anchor.rel = "noopener";
    const parent = document.body;
    if (parent === null) {
      // There is no document to click. Drop the URL instead of leaving it allocated.
      URL.revokeObjectURL(url);
      return;
    }
    parent.append(anchor);
    anchor.click();
    /**
     * Drops the temporary anchor and its object URL.
     *
     * Purpose: the click has been dispatched, so the blob URL does not have to stay.
     * Inputs: none. It closes over the anchor and the URL from this download.
     * Side effects: removes the anchor and revokes the URL.
     */
    function releaseDownloadUrl(): void {
      // The next turn is enough for the browser to read the blob.
      anchor.remove();
      URL.revokeObjectURL(url);
    }
    // Revoke after the click. A synchronous revoke can cancel the download.
    window.setTimeout(releaseDownloadUrl, 0);
  },
};
