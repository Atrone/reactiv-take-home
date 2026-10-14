import { useState, type JSX } from "react";
import { draftSectionFromStored } from "./draft-document.js";
import { useEditorDispatch, useEditorState } from "./editor-context.js";
import { EXPORT_BLOCKED_MESSAGE, jsonFileDownload, prepareJsonExport } from "./json-export.js";
import { useServerPage } from "./loader-reconciliation.js";
import {
  CONFLICT_MESSAGE,
  RELOAD_CONFIRMATION,
  summarizeDraftSections,
} from "./save-reconciliation.js";

/**
 * Renders one side of the plain comparison.
 *
 * Purpose: list section order, type, and a short label. There is no diff view.
 * Inputs: name, the heading. lines, the summary lines in screen order.
 * Side effects: none.
 */
function SectionSummary({ name, lines }: { name: string; lines: readonly string[] }): JSX.Element {
  return (
    <section aria-label={name}>
      <h3>{name}</h3>
      {lines.length === 0 ? (
        // An empty document is still a side of the comparison.
        <p>No sections.</p>
      ) : (
        <ol>
          {lines.map((line, index) => (
            // The index keeps two identical labels distinct. The text already includes the position.
            <li key={`${index}-${line}`}>{line}</li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Renders the conflict message and the three ways to leave it.
 *
 * Purpose: the author can compare, reload the server document on purpose, or export the local draft.
 * Nothing here writes the local draft over the server.
 * Inputs: none. The draft comes from editor state. The server document comes from the latest loader payload.
 * Side effects: Reload may dispatch `reloadFromServer` after confirmation. Export may download a file.
 */
export function ConflictNotice(): JSX.Element | null {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const loaded = useServerPage();
  const [compareOpen, setCompareOpen] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const showingConflict = state.status === "conflict";

  if (!showingConflict && (compareOpen || exportMessage !== null)) {
    // The next conflict starts with the lists closed and no leftover export sentence.
    setCompareOpen(false);
    setExportMessage(null);
  }
  if (!showingConflict) {
    return null;
  }

  const localLines = summarizeDraftSections(state.draft.data.sections);
  const serverLines =
    loaded === null ? [] : summarizeDraftSections(loaded.configuration.data.sections.map(draftSectionFromStored));

  /**
   * Opens or closes the local-versus-server list.
   *
   * Purpose: Compare is a summary, not a second editor.
   * Inputs: none.
   * Side effects: toggles the list. Does not change the draft or the ETag.
   */
  function onCompare(): void {
    // The lists read the current draft and the current loader payload.
    setCompareOpen((open) => !open);
  }

  /**
   * Replaces the draft with the loader document after the author confirms.
   *
   * Purpose: Reload is the explicit discard. It does not PUT the local draft.
   * Inputs: none. The document is the latest loader payload.
   * Side effects: may dispatch `reloadFromServer`. Does not call the configuration service.
   */
  function onReload(): void {
    if (loaded === null) {
      // There is no server document to load. The draft stays.
      return;
    }
    // The confirmation names the discard. Cancelling leaves both copies as they are.
    const confirmed = window.confirm(RELOAD_CONFIRMATION);
    if (!confirmed) {
      return;
    }
    dispatch({
      type: "reloadFromServer",
      configuration: loaded.configuration,
      etag: loaded.etag,
    });
  }

  /**
   * Downloads the current draft when it validates.
   *
   * Purpose: the author can keep the local work without writing it to the server.
   * Inputs: none. The draft is the one in editor state.
   * Side effects: may start a download, or set the invalid-draft sentence. Does not dispatch.
   */
  function onExportLocal(): void {
    // Validation reads a copy. An invalid field stays in the draft.
    const plan = prepareJsonExport(state.draft);
    if (!plan.ok) {
      // Say why there is no file. Do not download a partial document.
      setExportMessage(plan.message || EXPORT_BLOCKED_MESSAGE);
      return;
    }
    setExportMessage(null);
    // The prompt 18 exporter writes the portable file. This click does not call the service.
    jsonFileDownload.save(plan.filename, plan.contents);
  }

  return (
    <section className="conflict-panel" aria-label="Save conflict">
      <p id="conflict-message" className="conflict-message" role="alert">
        {CONFLICT_MESSAGE}
      </p>
      <div className="conflict-actions">
        <button type="button" aria-expanded={compareOpen} onClick={onCompare}>
          Compare
        </button>
        <button type="button" onClick={onReload} disabled={loaded === null}>
          Reload server version
        </button>
        <button type="button" onClick={onExportLocal}>
          Export local work
        </button>
      </div>
      {exportMessage !== null ? <p className="save-error">{exportMessage}</p> : null}
      {compareOpen ? (
        <div className="conflict-compare">
          <SectionSummary name="On this page" lines={localLines} />
          {loaded === null ? (
            <section aria-label="On the server">
              <h3>On the server</h3>
              <p>The latest server document is not available.</p>
            </section>
          ) : (
            <SectionSummary name="On the server" lines={serverLines} />
          )}
        </div>
      ) : null}
    </section>
  );
}
