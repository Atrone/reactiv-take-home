import { assertNever, createSection, createStableId, SUPPORTED_SCHEMA_VERSION } from "@reactiv/contracts";
import type { Configuration, EditableDocument, Section } from "@reactiv/contracts";
import {
  draftFromEditable,
  draftSectionFromStored,
  type DraftCarouselSection,
  type DraftDocument,
  type DraftImage,
  type DraftSection,
} from "./draft-document.js";
import { addImageLimitMessage, addSectionLimitMessage, countDraftImages } from "./field-issues.js";

/** Save and load status. It is editor UI state, not a field of the portable document. */
export type EditorStatus = "idle" | "saving" | "saved" | "error" | "conflict";

/** The snapshot identity recorded when Save is clicked. The document itself is not stored here. */
export type PendingSave = {
  sequence: number;
  etag: string;
};

/**
 * Editor state.
 *
 * `draft` is the only copy of the sections. Selection, the saved baseline, the
 * ETag, dirty state, status, the local sequence, and the in-flight save stay
 * outside the portable document.
 */
export type EditorState = {
  draft: DraftDocument;
  selectedSectionId: string | null;
  savedBaseline: EditableDocument | null;
  baseEtag: string | null;
  dirty: boolean;
  status: EditorStatus;
  localSequence: number;
  pendingSave: PendingSave | null;
};

/** URL and alt text for one image edit. The image id stays on the draft. */
export type DraftImageFields = {
  url: string;
  alt: string;
};

/** Commands the editor dispatches. There is no setter that writes one field on its own. */
export type EditorCommand =
  | { type: "hydrate"; configuration: Configuration; etag: string | null }
  | { type: "addSection"; sectionType: Section["type"] }
  | { type: "removeSection"; sectionId: string }
  | { type: "moveSection"; sectionId: string; direction: "up" | "down" }
  | { type: "placeSection"; sectionId: string; toIndex: number }
  | { type: "selectSection"; sectionId: string }
  | { type: "updateSection"; sectionId: string; section: DraftSection }
  | { type: "addImage"; sectionId: string }
  | { type: "updateImage"; sectionId: string; imageId: string; image: DraftImageFields }
  | { type: "removeImage"; sectionId: string; imageId: string }
  | { type: "importDocument"; document: EditableDocument }
  | { type: "saveStarted" }
  | { type: "saveAcknowledged"; configuration: Configuration; etag: string; sequence: number }
  | { type: "saveFailed" }
  | { type: "conflictObserved" }
  | { type: "reloadFromServer"; configuration: Configuration; etag: string | null };

/** The reducer closed over one id generator. */
export type EditorReducer = (state: EditorState, command: EditorCommand) => EditorState;

/** Direction used by `moveSection`. */
type MoveDirection = "up" | "down";

/**
 * Builds the empty editor.
 *
 * Purpose: the provider and the tests start from one place, before any loader payload arrives.
 * Inputs: none.
 * Side effects: none.
 */
export function createInitialEditorState(): EditorState {
  // No baseline yet. That is the signal that hydrate may still run.
  return {
    draft: {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      data: { sections: [] },
    },
    selectedSectionId: null,
    savedBaseline: null,
    baseEtag: null,
    dirty: false,
    status: "idle",
    localSequence: 0,
    pendingSave: null,
  };
}

/**
 * Finds a section id.
 *
 * Purpose: commands address a section by id rather than by a stale index.
 * Inputs: sections, the current list. sectionId, the id to find.
 * Side effects: none. Returns -1 when the id is absent.
 */
function sectionIndex(sections: readonly DraftSection[], sectionId: string): number {
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    // A hole in the array has no id. The next entry is still checked.
    if (section !== undefined && section.id === sectionId) {
      return index;
    }
  }
  return -1;
}

/**
 * Finds an image id inside one carousel.
 *
 * Purpose: image commands address one slide without scanning other carousels.
 * Inputs: images, that carousel's slides. imageId, the id to find.
 * Side effects: none. Returns -1 when the id is absent.
 */
function imageIndex(images: readonly DraftImage[], imageId: string): number {
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    // The first match wins. A later duplicate is left for the validator.
    if (image !== undefined && image.id === imageId) {
      return index;
    }
  }
  return -1;
}

/**
 * Reads the first section id.
 *
 * Purpose: hydrate, import, and reload select the first section when the document is replaced.
 * Inputs: sections, the list in screen order.
 * Side effects: none.
 */
function firstSectionId(sections: readonly DraftSection[]): string | null {
  const first = sections[0];
  // An empty document has nothing to select.
  if (first === undefined) {
    return null;
  }
  return first.id;
}

/**
 * Keeps the current selection when that id is still in the document.
 *
 * Purpose: a matching save acknowledgement should not jump the inspector when the section survived.
 * Inputs: sections, the document that will be shown. selectedSectionId, the current selection.
 * Side effects: none.
 */
function selectionStillPresent(sections: readonly DraftSection[], selectedSectionId: string | null): string | null {
  if (selectedSectionId === null) {
    // Nothing was selected. The first section is the inspector target.
    return firstSectionId(sections);
  }
  // The same id stays selected. A missing id falls back to the first section.
  if (sectionIndex(sections, selectedSectionId) < 0) {
    return firstSectionId(sections);
  }
  return selectedSectionId;
}

/**
 * Chooses the neighbor that becomes selected after a removal.
 *
 * Purpose: removing the selected block selects the next section, otherwise the previous, otherwise nothing.
 * Inputs: sections, the list before the removal. removedIndex, the index that will be removed.
 * selectedSectionId, the current selection. removedId, the id being removed.
 * Side effects: none.
 */
function selectionAfterRemove(
  sections: readonly DraftSection[],
  removedIndex: number,
  selectedSectionId: string | null,
  removedId: string,
): string | null {
  // Removing a different row leaves the current selection on its own id.
  if (selectedSectionId !== removedId) {
    return selectedSectionId;
  }
  const next = sections[removedIndex + 1];
  if (next !== undefined) {
    // The following section slides into this spot and becomes the selection.
    return next.id;
  }
  const previous = sections[removedIndex - 1];
  if (previous !== undefined) {
    // The removed section was the last one, so the previous neighbor is selected.
    return previous.id;
  }
  return null;
}

/**
 * Selects one section without editing the draft.
 *
 * Purpose: the row button chooses the inspector target. Selection is not a saved field.
 * Inputs: state, the current editor. sectionId, the id to select.
 * Side effects: none. A missing id or the current id leaves the editor unchanged.
 */
function applySelectSection(state: EditorState, sectionId: string): EditorState {
  if (state.selectedSectionId === sectionId) {
    // The row is already selected. The draft object stays the same object.
    return state;
  }
  if (sectionIndex(state.draft.data.sections, sectionId) < 0) {
    // An unknown id does not clear the current selection.
    return state;
  }
  return {
    ...state,
    selectedSectionId: sectionId,
  };
}

/**
 * Returns the index a move would land on.
 *
 * Purpose: up and down are the only directions, and a new direction fails typecheck here.
 * Inputs: index, the current index. direction, up or down.
 * Side effects: none.
 */
function targetIndexFor(index: number, direction: MoveDirection): number {
  switch (direction) {
    case "up":
      // The section trades places with the previous one.
      return index - 1;
    case "down":
      // The section trades places with the following one.
      return index + 1;
    default:
      // A third direction fails until this switch learns it.
      return assertNever(direction);
  }
}

/**
 * Builds a draft around a new section list.
 *
 * Purpose: section commands replace the array and leave `schemaVersion` alone.
 * Inputs: draft, the current draft. sections, the next list.
 * Side effects: none.
 */
function draftWithSections(draft: DraftDocument, sections: DraftSection[]): DraftDocument {
  // The version is the document format. A section edit does not change it.
  return {
    schemaVersion: draft.schemaVersion,
    data: { sections },
  };
}

/**
 * Records one user edit.
 *
 * Purpose: add, remove, move, and field edits share the dirty flag and the sequence increment.
 * Inputs: state, the current editor. draft, the next draft. selectedSectionId, the next selection.
 * Side effects: none.
 */
function withUserEdit(state: EditorState, draft: DraftDocument, selectedSectionId: string | null): EditorState {
  // A previous "saved" status would describe the baseline, not this newer draft.
  const status = state.status === "saved" ? "idle" : state.status;
  return {
    ...state,
    draft,
    selectedSectionId,
    dirty: true,
    status,
    localSequence: state.localSequence + 1,
  };
}

/**
 * Copies the portable part of a configuration.
 *
 * Purpose: the draft and the baseline store sections, not the service id, revision, or timestamp.
 * Inputs: configuration, a server success body.
 * Side effects: none.
 */
function editableFromConfiguration(configuration: Configuration): EditableDocument {
  // The clone does not share section objects with the loader payload or the caller.
  return {
    schemaVersion: configuration.schemaVersion,
    data: structuredClone(configuration.data),
  };
}

/**
 * Reports whether hydrate may fill the editor.
 *
 * Purpose: hydrate runs once from the initial empty editor. It does not merge a later payload over local work.
 * Inputs: state, the current editor.
 * Side effects: none.
 */
function canHydrate(state: EditorState): boolean {
  // A dirty draft wins, including an import that has not been saved and has no baseline yet.
  if (state.dirty) {
    return false;
  }
  // A baseline means a document was already loaded, imported over, or reloaded. Empty sections still count.
  if (state.savedBaseline !== null) {
    return false;
  }
  // A sequence above zero is local work even if a caller cleared the dirty flag.
  if (state.localSequence !== 0) {
    return false;
  }
  return true;
}

/**
 * Replaces one section's editable fields and keeps its id and type.
 *
 * Purpose: `updateSection` cannot retarget a row or turn a text block into a carousel.
 * Inputs: current, the section already in the draft. incoming, the fields from the command.
 * Side effects: none. Returns null when the types differ.
 */
function replaceSectionFields(current: DraftSection, incoming: DraftSection): DraftSection | null {
  switch (current.type) {
    case "text":
      if (incoming.type !== "text") {
        // A CTA or carousel payload does not change a text row.
        return null;
      }
      return {
        id: current.id,
        type: "text",
        title: incoming.title,
        description: incoming.description,
        titleColor: incoming.titleColor,
        descriptionColor: incoming.descriptionColor,
      };
    case "cta":
      if (incoming.type !== "cta") {
        // The stored discriminator stays `cta`.
        return null;
      }
      return {
        id: current.id,
        type: "cta",
        label: incoming.label,
        url: incoming.url,
        backgroundColor: incoming.backgroundColor,
        labelColor: incoming.labelColor,
      };
    case "carousel": {
      if (incoming.type !== "carousel") {
        // Aspect ratio and slides stay on the carousel.
        return null;
      }
      const images: DraftImage[] = [];
      for (const image of incoming.images) {
        // Slides are copied so a later edit of the command object does not change the draft.
        images.push({
          id: image.id,
          url: image.url,
          alt: image.alt,
        });
      }
      return {
        id: current.id,
        type: "carousel",
        aspectRatio: incoming.aspectRatio,
        images,
      };
    }
    default:
      // A fourth section type fails here until field replacement learns a branch for it.
      return assertNever(current);
  }
}

/**
 * Loads the first server document into an empty editor.
 *
 * Purpose: the route hydrates once from loader data. A later dispatch does not clobber local work.
 * Inputs: state, the current editor. configuration, the loader configuration. etag, the strong validator, or null.
 * Side effects: none.
 */
function applyHydrate(state: EditorState, configuration: Configuration, etag: string | null): EditorState {
  if (!canHydrate(state)) {
    // The existing draft stays, including a dirty one. There is no silent merge command.
    return state;
  }
  const savedBaseline = editableFromConfiguration(configuration);
  // The draft and the baseline are separate copies of the same sections.
  const draft = draftFromEditable(savedBaseline);
  return {
    draft,
    selectedSectionId: firstSectionId(draft.data.sections),
    savedBaseline,
    baseEtag: etag,
    dirty: false,
    status: "idle",
    localSequence: 0,
    pendingSave: null,
  };
}

/**
 * Appends a factory section and selects it.
 *
 * Purpose: Add carousel, Add text, and Add button share one command.
 * Inputs: state, the current editor. sectionType, the registry key. generateId, the id source.
 * Side effects: calls generateId once through `createSection`.
 */
function applyAddSection(state: EditorState, sectionType: Section["type"], generateId: () => string): EditorState {
  if (addSectionLimitMessage(state.draft.data.sections.length) !== null) {
    // The shared ceiling is inclusive. One more section is refused, and no id is consumed.
    return state;
  }
  // The factory stores the id. It does not ask for another one.
  const created = createSection(sectionType, generateId);
  const section = draftSectionFromStored(created);
  const sections = state.draft.data.sections.slice();
  // The new section is last. Earlier rows keep their objects and their order.
  sections.push(section);
  return withUserEdit(state, draftWithSections(state.draft, sections), section.id);
}

/**
 * Removes one section by id.
 *
 * Purpose: the row goes away, and the selection moves to a neighbor when that row was selected.
 * Inputs: state, the current editor. sectionId, the id to remove.
 * Side effects: none. A missing id leaves the editor unchanged.
 */
function applyRemoveSection(state: EditorState, sectionId: string): EditorState {
  const index = sectionIndex(state.draft.data.sections, sectionId);
  if (index < 0) {
    // Nothing was removed, so the sequence does not move.
    return state;
  }
  const selectedSectionId = selectionAfterRemove(
    state.draft.data.sections,
    index,
    state.selectedSectionId,
    sectionId,
  );
  const sections = state.draft.data.sections.slice();
  // Only this index is removed. A duplicate id later in the list is left for the validator.
  sections.splice(index, 1);
  return withUserEdit(state, draftWithSections(state.draft, sections), selectedSectionId);
}

/**
 * Swaps one section with its neighbor.
 *
 * Purpose: move up and move down reorder the array without changing any other section's fields.
 * Inputs: state, the current editor. sectionId, the section to move. direction, up or down.
 * Side effects: none. A move past either end leaves the editor unchanged.
 */
function applyMoveSection(state: EditorState, sectionId: string, direction: MoveDirection): EditorState {
  const index = sectionIndex(state.draft.data.sections, sectionId);
  if (index < 0) {
    // An unknown id is not a reorder.
    return state;
  }
  const targetIndex = targetIndexFor(index, direction);
  if (targetIndex < 0 || targetIndex >= state.draft.data.sections.length) {
    // The first section cannot move up, and the last cannot move down.
    return state;
  }
  const current = state.draft.data.sections[index];
  const neighbor = state.draft.data.sections[targetIndex];
  if (current === undefined || neighbor === undefined) {
    // A sparse hole is not a section we can swap.
    return state;
  }
  const sections = state.draft.data.sections.slice();
  // The two objects trade places. Their ids, images, and other fields stay on the same objects.
  sections[index] = neighbor;
  sections[targetIndex] = current;
  // Selection stays on the same id. Moving the selected row does not clear it.
  return withUserEdit(state, draftWithSections(state.draft, sections), state.selectedSectionId);
}

/**
 * Moves one section to an index in a single edit.
 *
 * Purpose: a drag drops the section on any row. The other section objects stay the same objects.
 * Inputs: state, the current editor. sectionId, the section to move. toIndex, the index it should occupy after the move.
 * Side effects: none. A missing id, the current index, or an index outside the list leaves the editor unchanged.
 */
function applyPlaceSection(state: EditorState, sectionId: string, toIndex: number): EditorState {
  const index = sectionIndex(state.draft.data.sections, sectionId);
  if (index < 0) {
    // An unknown id is not a reorder.
    return state;
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= state.draft.data.sections.length) {
    // The destination has to be an existing row.
    return state;
  }
  if (toIndex === index) {
    // Dropping a section on its current row does not count as an edit.
    return state;
  }
  const sections = state.draft.data.sections.slice();
  const moved = sections[index];
  if (moved === undefined) {
    // A sparse hole is not a section we can move.
    return state;
  }
  // Remove first so toIndex is the slot in the list after this section leaves.
  sections.splice(index, 1);
  sections.splice(toIndex, 0, moved);
  // Selection stays on the same id. Placing the selected row does not clear it.
  return withUserEdit(state, draftWithSections(state.draft, sections), state.selectedSectionId);
}

/**
 * Replaces the editable fields of one section.
 *
 * Purpose: typing in one block does not change another block's title, colors, or slides.
 * Inputs: state, the current editor. sectionId, the row to edit. section, the next fields.
 * Side effects: none. A missing id or a different type leaves the editor unchanged.
 */
function applyUpdateSection(state: EditorState, sectionId: string, section: DraftSection): EditorState {
  const index = sectionIndex(state.draft.data.sections, sectionId);
  if (index < 0) {
    // The command does not append a section when the id is unknown.
    return state;
  }
  const current = state.draft.data.sections[index];
  if (current === undefined) {
    // The index was in range. A hole still is not an edit.
    return state;
  }
  const replacement = replaceSectionFields(current, section);
  if (replacement === null) {
    // The id and type stay. A mismatched payload is ignored.
    return state;
  }
  const sections = state.draft.data.sections.slice();
  // The other indexes keep the same objects, so an untouched section is not copied.
  sections[index] = replacement;
  return withUserEdit(state, draftWithSections(state.draft, sections), state.selectedSectionId);
}

/**
 * Appends a blank image to one carousel.
 *
 * Purpose: Add image creates an id once and leaves the URL empty for the author to type.
 * Inputs: state, the current editor. sectionId, the carousel. generateId, the id source.
 * Side effects: calls generateId once when the section is a carousel. Otherwise none.
 */
function applyAddImage(state: EditorState, sectionId: string, generateId: () => string): EditorState {
  const index = sectionIndex(state.draft.data.sections, sectionId);
  if (index < 0) {
    // A missing section does not consume an id.
    return state;
  }
  const section = state.draft.data.sections[index];
  if (section === undefined || section.type !== "carousel") {
    // Text and CTA rows have no image list.
    return state;
  }
  if (addImageLimitMessage(section.images.length, countDraftImages(state.draft.data.sections)) !== null) {
    // The 21st slide in this carousel, or the 101st slide in the document, is refused. The list is not sliced.
    return state;
  }
  const image: DraftImage = {
    // One id for the new slide. Rendering this list does not call the generator.
    id: createStableId(generateId),
    url: "",
    alt: "",
  };
  const images = section.images.slice();
  // The new slide is last. Existing slides keep their objects.
  images.push(image);
  const nextSection: DraftCarouselSection = {
    id: section.id,
    type: "carousel",
    aspectRatio: section.aspectRatio,
    images,
  };
  const sections = state.draft.data.sections.slice();
  sections[index] = nextSection;
  return withUserEdit(state, draftWithSections(state.draft, sections), state.selectedSectionId);
}

/**
 * Replaces the URL and alt text of one image.
 *
 * Purpose: editing one slide does not change another slide or another carousel.
 * Inputs: state, the current editor. sectionId, the carousel. imageId, the slide. image, the next URL and alt.
 * Side effects: none. A missing section, a non-carousel, or a missing image leaves the editor unchanged.
 */
function applyUpdateImage(
  state: EditorState,
  sectionId: string,
  imageId: string,
  image: DraftImageFields,
): EditorState {
  const index = sectionIndex(state.draft.data.sections, sectionId);
  if (index < 0) {
    // The image id is only looked up inside the named carousel.
    return state;
  }
  const section = state.draft.data.sections[index];
  if (section === undefined || section.type !== "carousel") {
    // A text or CTA id is not an image edit.
    return state;
  }
  const slideIndex = imageIndex(section.images, imageId);
  if (slideIndex < 0) {
    // An unknown slide does not append a new one.
    return state;
  }
  const current = section.images[slideIndex];
  if (current === undefined) {
    // The index was in range. A hole still is not an edit.
    return state;
  }
  const images = section.images.slice();
  // The id stays. The URL may be invalid while the author is typing.
  images[slideIndex] = {
    id: current.id,
    url: image.url,
    alt: image.alt,
  };
  const nextSection: DraftCarouselSection = {
    id: section.id,
    type: "carousel",
    aspectRatio: section.aspectRatio,
    images,
  };
  const sections = state.draft.data.sections.slice();
  sections[index] = nextSection;
  return withUserEdit(state, draftWithSections(state.draft, sections), state.selectedSectionId);
}

/**
 * Removes one image from one carousel.
 *
 * Purpose: the last slide can be removed without deleting the carousel.
 * Inputs: state, the current editor. sectionId, the carousel. imageId, the slide to remove.
 * Side effects: none. A missing image leaves the editor unchanged.
 */
function applyRemoveImage(state: EditorState, sectionId: string, imageId: string): EditorState {
  const index = sectionIndex(state.draft.data.sections, sectionId);
  if (index < 0) {
    // No carousel was found, so the section list stays.
    return state;
  }
  const section = state.draft.data.sections[index];
  if (section === undefined || section.type !== "carousel") {
    // Only a carousel has slides to remove.
    return state;
  }
  const slideIndex = imageIndex(section.images, imageId);
  if (slideIndex < 0) {
    // The id is already gone. Removing it again is not an edit.
    return state;
  }
  const images = section.images.slice();
  // One slide is removed. An empty list stays on the carousel.
  images.splice(slideIndex, 1);
  const nextSection: DraftCarouselSection = {
    id: section.id,
    type: "carousel",
    aspectRatio: section.aspectRatio,
    images,
  };
  const sections = state.draft.data.sections.slice();
  sections[index] = nextSection;
  return withUserEdit(state, draftWithSections(state.draft, sections), state.selectedSectionId);
}

/**
 * Replaces the draft with a document the caller already validated.
 *
 * Purpose: import changes the working copy and leaves the saved baseline and ETag alone.
 * Inputs: state, the current editor. document, a portable document.
 * Side effects: none. This command does not validate and does not call the configuration service.
 */
function applyImportDocument(state: EditorState, document: EditableDocument): EditorState {
  // The imported sections are copied. The caller's object is not stored.
  const draft = draftFromEditable(document);
  return {
    ...state,
    draft,
    selectedSectionId: firstSectionId(draft.data.sections),
    dirty: true,
    status: "idle",
    localSequence: state.localSequence + 1,
  };
}

/**
 * Records the sequence and ETag for a save that is about to be sent.
 *
 * Purpose: the acknowledgement can tell whether the author edited after this click.
 * Inputs: state, the current editor.
 * Side effects: none. The draft is not changed. A second click while saving is ignored.
 */
function applySaveStarted(state: EditorState): EditorState {
  if (state.status === "saving") {
    // One save is in flight. A second click must not move the recorded sequence.
    return state;
  }
  if (state.baseEtag === null) {
    // The pending-save record needs a string tag. This command does not invent one.
    return state;
  }
  return {
    ...state,
    status: "saving",
    pendingSave: {
      sequence: state.localSequence,
      etag: state.baseEtag,
    },
  };
}

/**
 * Keeps a newer draft when an older save is acknowledged.
 *
 * Purpose: the server stored the snapshot from sequence N, and the author has since typed something else.
 * Inputs: state, the current editor. configuration, the document the server stored. etag, the acknowledged tag.
 * Side effects: none. The draft object is the same object the editor already held.
 */
function acknowledgeStaleSave(state: EditorState, configuration: Configuration, etag: string): EditorState {
  // The baseline becomes the document the server stored. The newer draft is not replaced.
  return {
    ...state,
    savedBaseline: editableFromConfiguration(configuration),
    baseEtag: etag,
    pendingSave: null,
    dirty: true,
    status: "idle",
  };
}

/**
 * Replaces the draft when the acknowledgement matches the current sequence.
 *
 * Purpose: no newer local edit exists, so the normalized server document becomes the draft.
 * Inputs: state, the current editor. configuration, the document the server stored. etag, the acknowledged tag.
 * Side effects: none.
 */
function acknowledgeCurrentSave(state: EditorState, configuration: Configuration, etag: string): EditorState {
  const savedBaseline = editableFromConfiguration(configuration);
  // The draft is a second copy, so a later keystroke does not mutate the baseline.
  const draft = draftFromEditable(savedBaseline);
  return {
    ...state,
    draft,
    savedBaseline,
    baseEtag: etag,
    selectedSectionId: selectionStillPresent(draft.data.sections, state.selectedSectionId),
    pendingSave: null,
    dirty: false,
    status: "saved",
  };
}

/**
 * Applies a save acknowledgement without dropping a newer draft.
 *
 * Purpose: sequence N updates the baseline, and it replaces the draft only when the editor is still on N.
 * Inputs: state, the current editor. configuration, the server body. etag, the acknowledged tag. sequence, the sequence that was saved.
 * Side effects: none. `localSequence` is not incremented.
 */
function applySaveAcknowledged(
  state: EditorState,
  configuration: Configuration,
  etag: string,
  sequence: number,
): EditorState {
  if (state.localSequence > sequence) {
    // The author edited after Save. Show that edit, and remember the tag the server just issued.
    return acknowledgeStaleSave(state, configuration, etag);
  }
  if (state.localSequence === sequence) {
    // This acknowledgement is for the draft that is on screen.
    return acknowledgeCurrentSave(state, configuration, etag);
  }
  // The sequence is newer than this editor. A reload resets the counter, so a late ack must not dirty that draft.
  return state;
}

/**
 * Records a failed save.
 *
 * Purpose: the author can retry from the same draft.
 * Inputs: state, the current editor.
 * Side effects: none. The draft, dirty flag, and sequence stay as they were.
 */
function applySaveFailed(state: EditorState): EditorState {
  // The in-flight record is cleared. The draft object stays the one the author was editing.
  return {
    ...state,
    status: "error",
    pendingSave: null,
  };
}

/**
 * Records a revision conflict.
 *
 * Purpose: the local draft stays until the author reloads or keeps editing. The ETag is not moved forward.
 * Inputs: state, the current editor.
 * Side effects: none.
 */
function applyConflictObserved(state: EditorState): EditorState {
  // Draft, dirty, baseline, and ETag stay. Only the status changes.
  return {
    ...state,
    status: "conflict",
  };
}

/**
 * Replaces the editor with a server document the author asked to load.
 *
 * Purpose: Reload discards local edits on purpose. It is not a background revalidation.
 * Inputs: state, the current editor. configuration, the server body. etag, the validator from that response.
 * Side effects: none.
 */
function applyReloadFromServer(state: EditorState, configuration: Configuration, etag: string | null): EditorState {
  const savedBaseline = editableFromConfiguration(configuration);
  const draft = draftFromEditable(savedBaseline);
  return {
    draft,
    selectedSectionId: firstSectionId(draft.data.sections),
    savedBaseline,
    baseEtag: etag,
    dirty: false,
    status: "idle",
    // The counter restarts so a late acknowledgement of a pre-reload sequence is not treated as a newer edit.
    localSequence: 0,
    pendingSave: null,
  };
}

/**
 * Builds the editor reducer around one id generator.
 *
 * Purpose: tests pass a deterministic generator, and the provider passes the browser generator.
 * Inputs: generateId, the id source used when a section or an image is added.
 * Side effects: none until the returned reducer handles an add command.
 */
export function createEditorReducer(generateId: () => string): EditorReducer {
  /**
   * Applies one editor command.
   *
   * Purpose: every draft change goes through a named command. There is no merge of loader data over a dirty draft.
   * Inputs: state, the current editor. command, the next command.
   * Side effects: add commands call generateId. Other commands do not.
   */
  function editorReducer(state: EditorState, command: EditorCommand): EditorState {
    switch (command.type) {
      case "hydrate":
        // First load only. A dirty draft is ignored.
        return applyHydrate(state, command.configuration, command.etag);
      case "addSection":
        // The new id comes from the generator, then the factory fills the default fields.
        return applyAddSection(state, command.sectionType, generateId);
      case "removeSection":
        // The id is removed. A selected row hands the selection to a neighbor.
        return applyRemoveSection(state, command.sectionId);
      case "moveSection":
        // Up or down swaps two neighbors. The ends are unchanged.
        return applyMoveSection(state, command.sectionId, command.direction);
      case "placeSection":
        // A drag lands on one index. The section object and the selection stay.
        return applyPlaceSection(state, command.sectionId, command.toIndex);
      case "selectSection":
        // The inspector follows this id. The draft, dirty flag, and sequence stay.
        return applySelectSection(state, command.sectionId);
      case "updateSection":
        // One row's fields change. Its id and type do not.
        return applyUpdateSection(state, command.sectionId, command.section);
      case "addImage":
        // A blank slide is appended to one carousel.
        return applyAddImage(state, command.sectionId, generateId);
      case "updateImage":
        // One slide's URL and alt change. The image id stays.
        return applyUpdateImage(state, command.sectionId, command.imageId, command.image);
      case "removeImage":
        // One slide is removed. The carousel remains when the list is empty.
        return applyRemoveImage(state, command.sectionId, command.imageId);
      case "importDocument":
        // The caller already validated this document. The baseline and ETag stay.
        return applyImportDocument(state, command.document);
      case "saveStarted":
        // Record the sequence and the current ETag. The draft stays.
        return applySaveStarted(state);
      case "saveAcknowledged":
        // Replace the draft only when no newer local sequence exists.
        return applySaveAcknowledged(state, command.configuration, command.etag, command.sequence);
      case "saveFailed":
        // The draft stays. The in-flight record is cleared.
        return applySaveFailed(state);
      case "conflictObserved":
        // The draft and the dirty flag stay. The ETag is not adopted.
        return applyConflictObserved(state);
      case "reloadFromServer":
        // The author chose the server document. Local edits are discarded.
        return applyReloadFromServer(state, command.configuration, command.etag);
      default:
        // A new command fails typecheck until this switch handles it.
        return assertNever(command);
    }
  }
  return editorReducer;
}
