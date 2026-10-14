import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type { Section } from "@reactiv/contracts";
import { ColorSwatchMemoryProvider } from "../sections/color-picker.js";
import { SectionInspectorBody, SectionPreview } from "../sections/section-ui-registry.js";
import type { DraftSection } from "./draft-document.js";
import { useEditorDispatch, useEditorState } from "./editor-context.js";
import { useSectionDrag } from "./section-drag.js";
import { jsonFileDownload, prepareJsonExport } from "./json-export.js";
import { IMPORTED_NOT_SAVED_MESSAGE, readPortableImport } from "./json-import.js";
import { ConflictNotice } from "./conflict-notice.js";
import { SaveController } from "./save-controls.js";
import { addSectionLimitMessage } from "./field-issues.js";
import {
  findSelectedSection,
  sectionControlName,
  sectionHint,
  sectionLabel,
} from "./section-summary.js";
import "./editor-shell.css";

/** Shown in the section list when every section has been removed. */
export const EMPTY_EDITOR_MESSAGE = "No sections yet. Add a carousel, a text block, or a button.";

/** Shown in the phone when every section has been removed. */
export const EMPTY_PREVIEW_MESSAGE = "Nothing to preview yet.";

/** Focus target used after Remove, once the next selection is known. */
const FOCUS_AFTER_REMOVE = "after-remove";

/** Focus target used after the last section is removed. */
const FOCUS_ADD_CAROUSEL = "add-carousel";

/** Which pane is visible below the 1024px split. Desktop shows both. */
type EditorPane = "editor" | "preview";

/** Props for the shell. The configuration is already in the reducer. */
export type EditorShellProps = {
  title: string;
};

/**
 * Moves focus to the element chosen by the last add, remove, or keyboard move.
 *
 * Purpose: a control that unmounts or becomes disabled does not leave focus on the document body.
 * Inputs: target, an element id or the after-remove marker. selectedSectionId, the selection after the command.
 * Side effects: calls focus on one element when it is in the document.
 */
function focusPendingTarget(target: string, selectedSectionId: string | null): void {
  if (target === FOCUS_AFTER_REMOVE) {
    if (selectedSectionId === null) {
      // The last row is gone. Add carousel is the first control that can replace it.
      document.getElementById(FOCUS_ADD_CAROUSEL)?.focus();
      return;
    }
    // The neighbor that the reducer selected is the next row button.
    document.getElementById(`section-select-${selectedSectionId}`)?.focus();
    return;
  }
  // Add focuses the inspector heading. A keyboard move focuses that section's drag handle.
  document.getElementById(target)?.focus();
}

/**
 * Renders Save, Export JSON, and Import JSON.
 *
 * Purpose: Export JSON downloads the current valid draft. Import JSON replaces that draft only after the file passes every check. Save posts a valid dirty draft.
 * Inputs: none. The draft comes from editor state.
 * Side effects: a successful export starts a file download. A successful import dispatches `importDocument` once. A failed import only sets the status text.
 */
function DocumentActions(): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const [documentNotice, setDocumentNotice] = useState<string | null>(null);
  const importRequest = useRef(0);

  /**
   * Downloads the current draft when it validates.
   *
   * Purpose: an invalid draft keeps its fields and does not produce a partial file.
   * Inputs: none. The draft is the one in editor state.
   * Side effects: may start a download, or set the status message. Does not dispatch.
   */
  function exportDraft(): void {
    // Validation reads a copy. The draft, the dirty flag, and the selection stay.
    const plan = prepareJsonExport(state.draft);
    if (!plan.ok) {
      // The inspectors already mark the bad fields. This sentence points at them.
      setDocumentNotice(plan.message);
      return;
    }
    // A failed export or a failed import is stale once a file is downloaded. The imported-draft sentence stays until Save.
    if (documentNotice !== IMPORTED_NOT_SAVED_MESSAGE) {
      setDocumentNotice(null);
    }
    // The helper writes the file. This click does not call the configuration service.
    jsonFileDownload.save(plan.filename, plan.contents);
  }

  /**
   * Starts an import from the file the author chose.
   *
   * Purpose: the control accepts one `.json` file, and choosing it again still fires a change.
   * Inputs: event, the file input's change event.
   * Side effects: may read the file. Does not dispatch until `applyChosenImport` accepts it.
   */
  function onImportFile(event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget;
    const files = input.files;
    // One file. The size check happens before this object is read.
    const file = files === null ? null : files.item(0);
    // Clearing the control lets the same path be chosen after a failure.
    input.value = "";
    if (file === null) {
      // The dialog was cancelled. The draft and the current status stay.
      return;
    }
    void applyChosenImport(file);
  }

  /**
   * Replaces the draft when the chosen file is a valid portable document.
   *
   * Purpose: size, parse, and schema checks finish before `importDocument`.
   * Inputs: file, the file captured from the input.
   * Side effects: on success, dispatches `importDocument` once and sets the status text. On failure, sets the status text only.
   */
  async function applyChosenImport(file: File): Promise<void> {
    // A newer choice invalidates this request so a slow read cannot replace a later file.
    importRequest.current += 1;
    const request = importRequest.current;
    // Size is checked inside this call. A rejected file does not return a document.
    const plan = await readPortableImport(file);
    if (request !== importRequest.current) {
      // This file is no longer the latest choice. Leave the newer result in place.
      return;
    }
    if (!plan.ok) {
      // The draft, the baseline, and the base ETag stay. The configuration service is not called.
      setDocumentNotice(plan.message);
      return;
    }
    // The status names an unsaved import. The dispatch is the only draft replacement.
    setDocumentNotice(IMPORTED_NOT_SAVED_MESSAGE);
    dispatch({ type: "importDocument", document: plan.document });
  }

  // A successful save retires the import sentence. The next paint must not still call the draft unsaved.
  const importWasSaved =
    state.status === "saved" && state.dirty === false && documentNotice === IMPORTED_NOT_SAVED_MESSAGE;
  if (importWasSaved) {
    setDocumentNotice(null);
  }
  const visibleNotice = importWasSaved ? null : documentNotice;
  const noticeId = visibleNotice === null ? undefined : "document-status";
  const noticeClass = visibleNotice === IMPORTED_NOT_SAVED_MESSAGE ? "import-status" : "export-status";

  return (
    <div className="editor-actions">
      {/* Save posts through the editor action. Export and Import read the draft already on screen. */}
      <SaveController />
      <button type="button" onClick={exportDraft} aria-describedby={noticeId}>
        Export JSON
      </button>
      <label className="import-control">
        Import JSON
        <input type="file" accept=".json" aria-label="Import JSON" onChange={onImportFile} aria-describedby={noticeId} />
      </label>
      {visibleNotice !== null ? (
        <p id="document-status" className={noticeClass} role="status" aria-live="polite">
          {visibleNotice}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Renders the page heading and the document actions.
 *
 * Purpose: the shell has one h1, and the actions stay available on both panes.
 * Inputs: title, the safe page title from the loader.
 * Side effects: none.
 */
function EditorHeader({ title }: { title: string }): JSX.Element {
  // The actions sit with the title so they stay reachable on both panes.
  return (
    <header className="editor-header">
      <h1>{title}</h1>
      <DocumentActions />
      <ConflictNotice />
    </header>
  );
}

/**
 * Renders the narrow-layout pane switch.
 *
 * Purpose: below 1024px the author shows either the editor or the preview. Both buttons stay tabbable.
 * Inputs: pane, the visible pane. onChange, the setter for that pane.
 * Side effects: none until a button is activated.
 */
function PaneSwitch({ pane, onChange }: { pane: EditorPane; onChange: (pane: EditorPane) => void }): JSX.Element {
  return (
    <div className="pane-switch">
      {/* Neither button is disabled, so both remain in the tab order. */}
      <button type="button" aria-pressed={pane === "editor"} aria-controls="editor-pane" onClick={() => onChange("editor")}>
        Editor
      </button>
      <button
        type="button"
        aria-pressed={pane === "preview"}
        aria-controls="preview-pane"
        onClick={() => onChange("preview")}
      >
        Preview
      </button>
    </div>
  );
}

/**
 * Renders Add carousel, Add text, and Add button.
 *
 * Purpose: the three registry types can be appended, including when the list is empty.
 * Inputs: onAdd, the handler that dispatches addSection and moves focus.
 * Side effects: none until a button is activated.
 */
function AddControls({
  onAdd,
  limitMessage,
}: {
  onAdd: (sectionType: Section["type"]) => void;
  limitMessage: string | null;
}): JSX.Element {
  // The three buttons share one explanation when the document is already at the section ceiling.
  const blocked = limitMessage !== null;
  const limitId = "section-limit-message";
  // The stored type for Add button is cta. The visible name is Button.
  return (
    <div className="add-controls">
      <button
        type="button"
        id={FOCUS_ADD_CAROUSEL}
        disabled={blocked}
        aria-describedby={blocked ? limitId : undefined}
        onClick={() => onAdd("carousel")}
      >
        Add carousel
      </button>
      <button
        type="button"
        disabled={blocked}
        aria-describedby={blocked ? limitId : undefined}
        onClick={() => onAdd("text")}
      >
        Add text
      </button>
      <button
        type="button"
        disabled={blocked}
        aria-describedby={blocked ? limitId : undefined}
        onClick={() => onAdd("cta")}
      >
        Add button
      </button>
      {limitMessage !== null ? (
        <p id={limitId} className="limit-message">
          {limitMessage}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Props for one section row.
 *
 * The callbacks close over dispatch. The row itself does not copy the draft.
 */
type SectionRowProps = {
  section: DraftSection;
  index: number;
  count: number;
  selected: boolean;
  dragging: boolean;
  drop: "before" | "after" | null;
  onSelect: (sectionId: string) => void;
  onMove: (sectionId: string, direction: "up" | "down", index: number, count: number) => void;
  onRemove: (sectionId: string) => void;
  onPointerDown: (event: PointerEvent<HTMLLIElement>, sectionId: string, index: number) => void;
  onClickCapture: (event: MouseEvent<HTMLLIElement>) => void;
  onDragStart: (event: DragEvent<HTMLLIElement>, sectionId: string, index: number) => void;
  onDragOver: (event: DragEvent<HTMLLIElement>, index: number) => void;
  onDrop: (event: DragEvent<HTMLLIElement>, index: number) => void;
  onDragEnd: () => void;
};

/**
 * Moves the focused section one row when an arrow key is pressed.
 *
 * Purpose: the drag handle stays in the tab order, and the arrows reorder without a pointer.
 * Inputs: event, the keydown on the handle. sectionId, the row. index and count, the position before the move.
 * onMove, the keyboard reorder callback.
 * Side effects: prevents the default arrow action and may call onMove.
 */
function onReorderKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  sectionId: string,
  index: number,
  count: number,
  onMove: (sectionId: string, direction: "up" | "down", index: number, count: number) => void,
): void {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
    // Enter and Space do not reorder. The pointer drag and the arrows do.
    return;
  }
  // The arrow would otherwise scroll the editor pane.
  event.preventDefault();
  const direction = event.key === "ArrowUp" ? "up" : "down";
  onMove(sectionId, direction, index, count);
}

/**
 * Renders one section row.
 *
 * Purpose: the row selects the section, the handle drags it, and Remove deletes it.
 * Inputs: props, the section, its index, the drop indicator, and the row callbacks.
 * Side effects: none until a pointer, key, or button is used.
 */
function SectionRow({
  section,
  index,
  count,
  selected,
  dragging,
  drop,
  onSelect,
  onMove,
  onRemove,
  onPointerDown,
  onClickCapture,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: SectionRowProps): JSX.Element {
  const label = sectionLabel(section);
  const hint = sectionHint(section);
  return (
    <li
      className="section-row"
      data-selected={selected ? "true" : "false"}
      data-dragging={dragging ? "true" : undefined}
      data-drop={drop ?? undefined}
      onPointerDown={(event) => onPointerDown(event, section.id, index)}
      onClickCapture={onClickCapture}
      onDragStart={(event) => onDragStart(event, section.id, index)}
      onDragOver={(event) => onDragOver(event, index)}
      onDrop={(event) => onDrop(event, index)}
      onDragEnd={onDragEnd}
    >
      <button
        type="button"
        id={`section-drag-${section.id}`}
        className="section-drag"
        aria-label={sectionControlName("Reorder", section)}
        aria-describedby="section-reorder-hint"
        aria-keyshortcuts="ArrowUp ArrowDown"
        onKeyDown={(event) => onReorderKeyDown(event, section.id, index, count, onMove)}
      >
        <span className="section-drag-grip" aria-hidden="true" />
      </button>
      <button
        type="button"
        id={`section-select-${section.id}`}
        className="section-select"
        aria-pressed={selected}
        aria-label={sectionControlName("Select", section)}
        onClick={() => onSelect(section.id)}
      >
        <span className="section-row-label">{label}</span>
        <span className="section-row-hint">{hint}</span>
      </button>
      <div className="section-controls">
        <button
          type="button"
          id={`section-remove-${section.id}`}
          className="remove-section"
          aria-label={sectionControlName("Remove", section)}
          onClick={() => onRemove(section.id)}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/**
 * Props for the section list.
 */
type SectionListProps = {
  sections: readonly DraftSection[];
  selectedSectionId: string | null;
  onAdd: (sectionType: Section["type"]) => void;
  onSelect: (sectionId: string) => void;
  onMove: (sectionId: string, direction: "up" | "down", index: number, count: number) => void;
  onPlace: (sectionId: string, toIndex: number) => void;
  onRemove: (sectionId: string) => void;
};

/**
 * Renders the labelled Sections region.
 *
 * Purpose: the author sees one row per section, drags a row to reorder it, and can add a section when the list is empty.
 * Inputs: props, the draft rows and the row callbacks.
 * Side effects: a drag may call onPlace. Other controls wait until they are activated.
 */
function SectionList({
  sections,
  selectedSectionId,
  onAdd,
  onSelect,
  onMove,
  onPlace,
  onRemove,
}: SectionListProps): JSX.Element {
  // The add controls stay outside the list so an empty document can still use them.
  const limitMessage = addSectionLimitMessage(sections.length);
  const drag = useSectionDrag(sections.length, onPlace);
  return (
    <section className="editor-region" aria-label="Sections">
      <h2>Sections</h2>
      <AddControls onAdd={onAdd} limitMessage={limitMessage} />
      {sections.length === 0 ? (
        <p id="empty-editor-message" className="empty-editor-message" tabIndex={-1}>
          {EMPTY_EDITOR_MESSAGE}
        </p>
      ) : (
        <>
          <p id="section-reorder-hint" className="reorder-hint">
            Drag a handle to reorder. Arrow keys move the focused handle.
          </p>
          <ul className="section-list">
            {sections.map((section, index) => {
              // The line is drawn on the row under the pointer. The dragged row is marked separately.
              const drop =
                drag.indicator !== null && drag.indicator.overIndex === index
                  ? drag.indicator.placeAfter
                    ? "after"
                    : "before"
                  : null;
              return (
                <SectionRow
                  key={section.id}
                  section={section}
                  index={index}
                  count={sections.length}
                  selected={section.id === selectedSectionId}
                  dragging={drag.indicator !== null && drag.indicator.sectionId === section.id}
                  drop={drop}
                  onSelect={onSelect}
                  onMove={onMove}
                  onRemove={onRemove}
                  onPointerDown={drag.onRowPointerDown}
                  onClickCapture={drag.onRowClickCapture}
                  onDragStart={drag.onRowDragStart}
                  onDragOver={drag.onRowDragOver}
                  onDrop={drag.onRowDrop}
                  onDragEnd={drag.onRowDragEnd}
                />
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Renders the selected section's type, id, and registry inspector.
 *
 * Purpose: the registry inspector edits the selected row. The type and the id stay above it.
 * Inputs: section, the selected row, or undefined when nothing is selected.
 * Side effects: none until an inspector dispatches a command.
 */
function SectionInspector({ section }: { section: DraftSection | undefined }): JSX.Element {
  // The heading is the focus target after Add. The registry body sits under the type and id.
  return (
    <ColorSwatchMemoryProvider>
      <section className="inspector" aria-label="Section settings">
        <h2 id="section-settings-heading" className="inspector-heading" tabIndex={-1}>
          Section settings
        </h2>
        {section === undefined ? (
          <p>No section is selected.</p>
        ) : (
          <div className="inspector-body">
            <p className="inspector-meta">Type: {section.type}</p>
            <p className="inspector-meta">Id: {section.id}</p>
            <SectionInspectorBody section={section} />
          </div>
        )}
      </section>
    </ColorSwatchMemoryProvider>
  );
}

/**
 * Renders the phone preview.
 *
 * Purpose: carousel, text, and button blocks show their draft. A move updates the phone without a request.
 * Inputs: sections, the draft list in screen order.
 * Side effects: none until a carousel control scrolls its own region.
 */
function PhonePreview({ sections }: { sections: readonly DraftSection[] }): JSX.Element {
  return (
    <section id="preview-pane" className="preview-pane" aria-label="Phone preview">
      <h2>Phone preview</h2>
      <div className="phone-frame">
        <div className="phone-notch" aria-hidden="true" />
        <div className="phone-screen">
          {sections.length === 0 ? (
            <p className="empty-preview-message">{EMPTY_PREVIEW_MESSAGE}</p>
          ) : (
            <ol className="preview-list">
              {sections.map((section) => (
                <SectionPreview key={section.id} section={section} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Renders the editor shell from the reducer draft.
 *
 * Purpose: the list, the inspector, and the phone read one draft. This component does not fetch.
 * Inputs: props.title, the safe page title.
 * Side effects: add, remove, and some moves move focus after the next paint.
 */
export function EditorShell({ title }: EditorShellProps): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  const sections = state.draft.data.sections;
  const selected = findSelectedSection(sections, state.selectedSectionId);
  const [pane, setPane] = useState<EditorPane>("editor");
  const pendingFocus = useRef<string | null>(null);
  const [focusGeneration, setFocusGeneration] = useState(0);

  /**
   * Applies the focus request recorded by the last command.
   *
   * Purpose: focus runs after the row or the heading from that command is in the document.
   * Inputs: none. It reads the pending id and the current selection.
   * Side effects: may call focus.
   */
  function applyPendingFocus(): void {
    const target = pendingFocus.current;
    if (target === null) {
      // A selection click keeps focus on the button that was activated.
      return;
    }
    // Clear the request before focusing so a later render does not move focus again.
    pendingFocus.current = null;
    focusPendingTarget(target, state.selectedSectionId);
  }

  useEffect(applyPendingFocus, [focusGeneration, state.selectedSectionId]);

  /**
   * Records the element that should receive focus after this command.
   *
   * Purpose: the click handler can name the target before dispatch updates the draft.
   * Inputs: target, an element id or the after-remove marker.
   * Side effects: schedules a focus effect.
   */
  function requestFocus(target: string): void {
    // The ref is read after the draft render, so the new heading or row exists.
    pendingFocus.current = target;
    setFocusGeneration((current) => current + 1);
  }

  /**
   * Appends one section and focuses the inspector heading.
   *
   * Purpose: Add carousel, Add text, and Add button share one command.
   * Inputs: sectionType, the registry key.
   * Side effects: dispatches addSection.
   */
  function addSection(sectionType: Section["type"]): void {
    if (addSectionLimitMessage(sections.length) !== null) {
      // The buttons are already disabled. A click that still arrives does not append a section.
      return;
    }
    // The heading is stable. The new section becomes the selection underneath it.
    requestFocus("section-settings-heading");
    dispatch({ type: "addSection", sectionType });
  }

  /**
   * Selects one section.
   *
   * Purpose: the row button chooses which id the inspector shows.
   * Inputs: sectionId, the row to select.
   * Side effects: dispatches selectSection. The draft is unchanged.
   */
  function selectSection(sectionId: string): void {
    // Focus stays on the button that was clicked.
    dispatch({ type: "selectSection", sectionId });
  }

  /**
   * Moves one section up or down by one row.
   *
   * Purpose: the drag handle's arrow keys reorder the draft array. The preview reads that same array.
   * Inputs: sectionId, the row to move. direction, up or down. index and count, the position before the move.
   * Side effects: dispatches moveSection when a neighbor exists. Restores focus on this section's drag handle.
   */
  function moveSection(sectionId: string, direction: "up" | "down", index: number, count: number): void {
    const nextIndex = direction === "up" ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= count) {
      // The first row has no previous neighbor, and the last row has no next neighbor.
      return;
    }
    // The handle stays in the document, so focus returns to this section after the rows swap.
    requestFocus(`section-drag-${sectionId}`);
    dispatch({ type: "moveSection", sectionId, direction });
  }

  /**
   * Moves one section to the index chosen by a drag.
   *
   * Purpose: releasing a drag reorders the draft once. The preview reads that same array.
   * Inputs: sectionId, the row that was dragged. toIndex, the index it should occupy.
   * Side effects: dispatches placeSection. Focus stays where the pointer left it.
   */
  function placeSection(sectionId: string, toIndex: number): void {
    // One drop is one edit. The reducer ignores a drop on the section's current index.
    dispatch({ type: "placeSection", sectionId, toIndex });
  }

  /**
   * Removes one section.
   *
   * Purpose: the row leaves the list and the preview, and focus moves to the next selection.
   * Inputs: sectionId, the row to remove.
   * Side effects: dispatches removeSection.
   */
  function removeSection(sectionId: string): void {
    // The neighbor is chosen by the reducer. Focus runs after that selection is rendered.
    requestFocus(FOCUS_AFTER_REMOVE);
    dispatch({ type: "removeSection", sectionId });
  }

  return (
    <main className="editor-page" data-dirty={state.dirty ? "true" : "false"}>
      <EditorHeader title={title} />
      <PaneSwitch pane={pane} onChange={setPane} />
      <div className="editor-layout" data-pane={pane}>
        <div className="editor-pane" id="editor-pane">
          <SectionList
            sections={sections}
            selectedSectionId={state.selectedSectionId}
            onAdd={addSection}
            onSelect={selectSection}
            onMove={moveSection}
            onPlace={placeSection}
            onRemove={removeSection}
          />
          <SectionInspector section={selected} />
        </div>
        <PhonePreview sections={sections} />
      </div>
    </main>
  );
}
