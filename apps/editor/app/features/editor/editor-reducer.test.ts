import { createElement, type JSX } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  LIMITS,
  configurationSchema,
  createSection,
  editableDocumentSchema,
  type Configuration,
  type EditableDocument,
  type ErrorIssue,
} from "@reactiv/contracts";
import { describe, expect, it } from "vitest";
import {
  validateDraft,
  type DraftCarouselSection,
  type DraftDocument,
  type DraftSection,
  type DraftTextSection,
  type DraftValidationResult,
} from "./draft-document.js";
import { EditorProvider, useEditorDispatch, useEditorState } from "./editor-context.js";
import {
  createEditorReducer,
  createInitialEditorState,
  type EditorCommand,
  type EditorState,
} from "./editor-reducer.js";

/**
 * A reducer plus the state it last returned.
 *
 * Purpose: each case starts from the empty editor and a fresh id sequence.
 */
type Harness = {
  dispatch: (command: EditorCommand) => EditorState;
  current: () => EditorState;
};

/**
 * Issues ids prefix-1, prefix-2, and so on.
 *
 * Purpose: section and image ids are deterministic and are not array indexes.
 * Inputs: prefix, the text placed before the count.
 * Side effects: none until the returned function is called.
 */
function sequentialIds(prefix: string): () => string {
  let count = 0;
  /**
   * Issues the next counted id.
   *
   * Purpose: one call advances the sequence by one.
   * Inputs: none.
   * Side effects: increments the closed-over counter.
   */
  function generateId(): string {
    // The suffix is the call count. Two adds of the same type get different ids.
    count += 1;
    return `${prefix}-${count}`;
  }
  return generateId;
}

/**
 * Returns one fixed id.
 *
 * Purpose: compare a reducer section with a factory section that uses the same id.
 * Inputs: id, the id every call returns.
 * Side effects: none.
 */
function fixedId(id: string): () => string {
  /**
   * Returns the closed-over id.
   *
   * Purpose: `createSection` still calls the generator once.
   * Inputs: none.
   * Side effects: none.
   */
  function generateId(): string {
    // The same id is enough for a factory comparison. The reducer test does not use this generator.
    return id;
  }
  return generateId;
}

/**
 * Returns the same id on every call.
 *
 * Purpose: a repeated id lets a removal test show that only the first match is removed.
 * Inputs: id, the id every call returns.
 * Side effects: none.
 */
function repeatedId(id: string): () => string {
  /**
   * Returns the closed-over id.
   *
   * Purpose: each add still asks for an id, and the answer can collide.
   * Inputs: none.
   * Side effects: none.
   */
  function generateId(): string {
    // The reducer must not rewrite this collision into a unique id.
    return id;
  }
  return generateId;
}

/**
 * Starts one editor at the empty initial state.
 *
 * Purpose: cases do not share ids or a dirty draft.
 * Inputs: generateId, the id source. When omitted, ids are id-1, id-2, and so on.
 * Side effects: none until `dispatch` runs.
 */
function createHarness(generateId: () => string = sequentialIds("id")): Harness {
  const reducer = createEditorReducer(generateId);
  let state = createInitialEditorState();
  /**
   * Applies one command and remembers the result.
   *
   * Purpose: the next command sees the updated editor.
   * Inputs: command, the reducer command.
   * Side effects: replaces the closed-over state.
   */
  function dispatch(command: EditorCommand): EditorState {
    // The reducer returns the same object when a command is a no-op.
    state = reducer(state, command);
    return state;
  }
  /**
   * Reads the editor without dispatching.
   *
   * Purpose: a test can hold the state from before a command.
   * Inputs: none.
   * Side effects: none.
   */
  function current(): EditorState {
    // This is the reducer state, not a copy of the sections.
    return state;
  }
  return { dispatch, current };
}

/**
 * Builds a text section value.
 *
 * Purpose: fixtures and update payloads share one shape.
 * Inputs: id, the section id. title, the title text. titleColor, the title color string.
 * Side effects: none.
 */
function textSection(id: string, title: string, titleColor = "#112233"): DraftTextSection {
  // Description and description color stay at the text-section defaults.
  return {
    id,
    type: "text",
    title,
    description: "",
    titleColor,
    descriptionColor: "#334455",
  };
}

/**
 * Parses a portable document from draft sections.
 *
 * Purpose: hydrate and import need an `EditableDocument`, not a draft.
 * Inputs: sections, the sections to validate.
 * Side effects: none. Throws when the sections are not a valid document.
 */
function documentFromSections(sections: DraftSection[]): EditableDocument {
  // The schema normalizes valid colors. Invalid fixtures should not use this helper.
  return editableDocumentSchema.parse({
    schemaVersion: 1,
    data: { sections },
  });
}

/**
 * Parses a one-section text document.
 *
 * Purpose: most reducer cases start from a single text block.
 * Inputs: id, the section id. title, the title text. titleColor, the title color string.
 * Side effects: none.
 */
function textDocument(id: string, title: string, titleColor = "#112233"): EditableDocument {
  // One section is enough to see a title change.
  return documentFromSections([textSection(id, title, titleColor)]);
}

/**
 * Wraps a portable document in a configuration body.
 *
 * Purpose: hydrate, acknowledgement, and reload take a server configuration. The ETag is separate from `revision`.
 * Inputs: document, the portable sections. revision, the service revision. It is not the ETag.
 * Side effects: none.
 */
function asConfiguration(document: EditableDocument, revision = 1): Configuration {
  // id, revision, and updatedAt are service-owned. The reducer stores only the portable part.
  return configurationSchema.parse({
    schemaVersion: document.schemaVersion,
    data: document.data,
    id: "cfg_demo",
    revision,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Reads a text section or throws.
 *
 * Purpose: a failed cast should fail the test with a clear message.
 * Inputs: section, the candidate. label, text for the error.
 * Side effects: none. Throws when the section is missing or not text.
 */
function requireText(section: DraftSection | undefined, label: string): DraftTextSection {
  if (section === undefined || section.type !== "text") {
    // The assertion never starts if the fixture is the wrong type.
    throw new Error(`Expected a text section (${label}).`);
  }
  return section;
}

/**
 * Reads a carousel section or throws.
 *
 * Purpose: image assertions can use carousel fields without a cast.
 * Inputs: section, the candidate. label, text for the error.
 * Side effects: none. Throws when the section is missing or not a carousel.
 */
function requireCarousel(section: DraftSection | undefined, label: string): DraftCarouselSection {
  if (section === undefined || section.type !== "carousel") {
    // A text row does not have images to compare.
    throw new Error(`Expected a carousel section (${label}).`);
  }
  return section;
}

/**
 * Reads a text section from the draft by index.
 *
 * Purpose: title checks name the row they mean.
 * Inputs: state, the editor. index, the screen index.
 * Side effects: none. Throws when that row is not text.
 */
function textAt(state: EditorState, index: number): DraftTextSection {
  // Index 0 is the first section in screen order.
  return requireText(state.draft.data.sections[index], `index ${index}`);
}

/**
 * Finds a carousel by id.
 *
 * Purpose: a move changes indexes, so image checks follow the id.
 * Inputs: state, the editor. id, the carousel id.
 * Side effects: none. Throws when that id is not a carousel.
 */
function findCarousel(state: EditorState, id: string): DraftCarouselSection {
  for (const section of state.draft.data.sections) {
    if (section.id === id && section.type === "carousel") {
      // The object is the draft's carousel, so a shared reference can be asserted.
      return section;
    }
  }
  throw new Error(`Expected carousel ${id}.`);
}

/**
 * Lists section ids in screen order.
 *
 * Purpose: reorder and remove assertions compare the whole order.
 * Inputs: state, the editor.
 * Side effects: none.
 */
function sectionIds(state: EditorState): string[] {
  const ids: string[] = [];
  for (const section of state.draft.data.sections) {
    // Screen order is array order. There is no position field.
    ids.push(section.id);
  }
  return ids;
}

/**
 * Reads the first baseline text section.
 *
 * Purpose: acknowledgement tests can see which title was stored as the baseline.
 * Inputs: state, the editor.
 * Side effects: none. Throws when the baseline is missing or not text.
 */
function baselineText(state: EditorState): DraftTextSection {
  const baseline = state.savedBaseline;
  if (baseline === null) {
    // A missing baseline means hydrate or reload did not keep the server document.
    throw new Error("Expected a saved baseline.");
  }
  const section = baseline.data.sections[0];
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected a text section on the baseline.");
  }
  // The baseline uses the stored section shape. The fields match a draft text section.
  return section;
}

/**
 * Returns the issue list from a failed validation.
 *
 * Purpose: color and duplicate-id cases can read paths without repeating the success check.
 * Inputs: result, the validation result.
 * Side effects: none. Throws when validation succeeded.
 */
function requireIssues(result: DraftValidationResult): ErrorIssue[] {
  if (result.ok) {
    // A success here means the draft was accepted when the case expected a failure.
    throw new Error("Expected validation to fail.");
  }
  return result.issues;
}

/**
 * Returns the portable document from a successful validation.
 *
 * Purpose: acknowledgement snapshots start from a draft that already parses.
 * Inputs: result, the validation result.
 * Side effects: none. Throws when validation failed.
 */
function requireValid(result: DraftValidationResult): EditableDocument {
  if (!result.ok) {
    // The snapshot is not useful when the draft is already invalid.
    throw new Error("Expected the draft to validate.");
  }
  return result.document;
}

/**
 * Reports whether any issue path contains the fragment.
 *
 * Purpose: color failures should point at the color field.
 * Inputs: issues, the validation issues. fragment, the path text to find.
 * Side effects: none.
 */
function pathsInclude(issues: readonly ErrorIssue[], fragment: string): boolean {
  for (const issue of issues) {
    // The shared formatter writes paths such as data.sections[0].titleColor.
    if (issue.path.includes(fragment)) {
      return true;
    }
  }
  return false;
}

/**
 * Reports whether any issue path ends with the suffix.
 *
 * Purpose: `.label` must not match `labelColor`.
 * Inputs: issues, the validation issues. suffix, the path ending to find.
 * Side effects: none.
 */
function pathEndsWith(issues: readonly ErrorIssue[], suffix: string): boolean {
  for (const issue of issues) {
    // The suffix is the field name, including the dot that separates it from its parent.
    if (issue.path.endsWith(suffix)) {
      return true;
    }
  }
  return false;
}

/**
 * Reports whether any issue message contains the fragment.
 *
 * Purpose: duplicate ids are reported by the schema rather than removed by the reducer.
 * Inputs: issues, the validation issues. fragment, the message text to find.
 * Side effects: none.
 */
function messagesInclude(issues: readonly ErrorIssue[], fragment: string): boolean {
  for (const issue of issues) {
    // Duplicate section ids use the shared uniqueness message.
    if (issue.message.includes(fragment)) {
      return true;
    }
  }
  return false;
}

/**
 * Collects an error message and its cause.
 *
 * Purpose: a render failure should still show the missing-provider sentence.
 * Inputs: error, the thrown value.
 * Side effects: none.
 */
function errorText(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause.message : "";
    // The renderer may wrap the hook error. Both messages are searched.
    return `${error.message}\n${cause}`;
  }
  return String(error);
}

/**
 * Asserts two factory sections differ and do not share identity.
 *
 * Purpose: adding the same type twice assigns two ids and two section objects.
 * Inputs: none.
 * Side effects: dispatches two add commands.
 */
function expectTwoSectionsOfTheSameTypeToDiffer(): void {
  const { dispatch } = createHarness();
  // Two text blocks use the same factory defaults and must still be different sections.
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  const first = requireText(state.draft.data.sections[0], "first");
  const second = requireText(state.draft.data.sections[1], "second");
  expect(sectionIds(state)).toEqual(["id-1", "id-2"]);
  expect(first).not.toBe(second);
  expect(first).not.toEqual(second);
  // Each row matches a fresh factory section for its own id.
  expect(first).toEqual(createSection("text", fixedId(first.id)));
  expect(second).toEqual(createSection("text", fixedId(second.id)));
  expect(state.selectedSectionId).toBe("id-2");
  expect(state.dirty).toBe(true);
  expect(state.localSequence).toBe(2);
}

/**
 * Asserts a title edit stays on the section that was edited.
 *
 * Purpose: the second text block keeps its own title, id, and object.
 * Inputs: none.
 * Side effects: dispatches add and update commands.
 */
function expectTextTitleUpdateToLeaveTheOtherTextAlone(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  const first = textAt(state, 0);
  const second = textAt(state, 1);
  const payload = textSection("wrong-id", "Renamed");
  // The command names the first id. The payload id is not applied.
  state = dispatch({ type: "updateSection", sectionId: first.id, section: payload });
  payload.title = "Changed after dispatch";
  expect(textAt(state, 0).title).toBe("Renamed");
  expect(textAt(state, 0).id).toBe(first.id);
  expect(textAt(state, 0).type).toBe("text");
  expect(textAt(state, 1)).toBe(second);
  expect(textAt(state, 1).title).toBe("Title");
  const parked = state;
  const cta: DraftSection = {
    id: "cta-payload",
    type: "cta",
    label: "Go",
    url: "https://example.com",
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  };
  // A different type does not replace the text row.
  expect(dispatch({ type: "updateSection", sectionId: first.id, section: cta })).toBe(parked);
}

/**
 * Asserts text, CTA, and carousel edits stay on their own rows.
 *
 * Purpose: the three section types can be edited, and an invalid CTA URL stays in the draft.
 * Inputs: none.
 * Side effects: dispatches add and update commands.
 */
function expectEachSectionTypeToKeepItsOwnFields(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "cta" });
  state = dispatch({ type: "addSection", sectionType: "carousel" });
  const carouselId = "id-3";
  state = dispatch({ type: "addImage", sectionId: carouselId });
  const text = textAt(state, 0);
  const cta = state.draft.data.sections[1];
  const carousel = requireCarousel(state.draft.data.sections[2], "carousel");
  if (cta === undefined || cta.type !== "cta") {
    throw new Error("Expected a CTA section.");
  }
  state = dispatch({
    type: "updateSection",
    sectionId: text.id,
    section: textSection(text.id, "Only text"),
  });
  const textAfter = textAt(state, 0);
  const ctaAfterText = state.draft.data.sections[1];
  const carouselAfterText = state.draft.data.sections[2];
  expect(ctaAfterText).toBe(cta);
  expect(carouselAfterText).toBe(carousel);
  state = dispatch({
    type: "updateSection",
    sectionId: cta.id,
    section: {
      id: "ignored",
      type: "cta",
      label: "Shop",
      url: "not-a-url",
      backgroundColor: cta.backgroundColor,
      labelColor: cta.labelColor,
    },
  });
  expect(textAt(state, 0)).toBe(textAfter);
  const ctaAfter = state.draft.data.sections[1];
  if (ctaAfter === undefined || ctaAfter.type !== "cta") {
    throw new Error("Expected the CTA to stay a CTA.");
  }
  expect(ctaAfter.id).toBe(cta.id);
  expect(ctaAfter.label).toBe("Shop");
  expect(ctaAfter.url).toBe("not-a-url");
  state = dispatch({
    type: "updateSection",
    sectionId: carousel.id,
    section: {
      id: "ignored",
      type: "carousel",
      aspectRatio: "portrait",
      images: carousel.images,
    },
  });
  expect(textAt(state, 0).title).toBe("Only text");
  expect(state.draft.data.sections[1]).toBe(ctaAfter);
  const updatedCarousel = requireCarousel(state.draft.data.sections[2], "updated carousel");
  expect(updatedCarousel.id).toBe(carousel.id);
  expect(updatedCarousel.aspectRatio).toBe("portrait");
  expect(updatedCarousel.images.map((image) => image.id)).toEqual(["id-4"]);
  const result = validateDraft(state.draft);
  if (result.ok) {
    throw new Error("Expected the invalid CTA URL to fail validation.");
  }
  // The draft keeps the typed URL. Validation does not clear it.
  expect(ctaAfter.url).toBe("not-a-url");
  expect(pathsInclude(result.issues, "url")).toBe(true);
}

/**
 * Asserts a carousel move keeps each image list with its section id.
 *
 * Purpose: reordering swaps the two carousel ids and does not swap their URLs.
 * Inputs: none.
 * Side effects: dispatches add, image, and move commands.
 */
function expectMovingTheSecondCarouselToKeepItsImages(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "carousel" });
  state = dispatch({ type: "addImage", sectionId: "id-2" });
  state = dispatch({
    type: "updateImage",
    sectionId: "id-2",
    imageId: "id-3",
    image: { url: "https://example.com/first.jpg", alt: "First slide" },
  });
  state = dispatch({ type: "addSection", sectionType: "carousel" });
  state = dispatch({ type: "addImage", sectionId: "id-4" });
  state = dispatch({
    type: "updateImage",
    sectionId: "id-4",
    imageId: "id-5",
    image: { url: "https://example.com/second.jpg", alt: "Second slide" },
  });
  const text = state.draft.data.sections[0];
  const firstCarousel = state.draft.data.sections[1];
  const secondCarousel = state.draft.data.sections[2];
  expect(sectionIds(state)).toEqual(["id-1", "id-2", "id-4"]);
  expect(state.selectedSectionId).toBe("id-4");
  const sequenceBeforeMove = state.localSequence;
  // The second carousel moves above the first. The text row stays first.
  state = dispatch({ type: "moveSection", sectionId: "id-4", direction: "up" });
  expect(state.localSequence).toBe(sequenceBeforeMove + 1);
  expect(state.dirty).toBe(true);
  expect(sectionIds(state)).toEqual(["id-1", "id-4", "id-2"]);
  expect(state.draft.data.sections[0]).toBe(text);
  expect(state.draft.data.sections[1]).toBe(secondCarousel);
  expect(state.draft.data.sections[2]).toBe(firstCarousel);
  expect(state.selectedSectionId).toBe("id-4");
  expect(findCarousel(state, "id-2").images).toEqual([
    { id: "id-3", url: "https://example.com/first.jpg", alt: "First slide" },
  ]);
  expect(findCarousel(state, "id-4").images).toEqual([
    { id: "id-5", url: "https://example.com/second.jpg", alt: "Second slide" },
  ]);
  expect(findCarousel(state, "id-2").images).not.toBe(findCarousel(state, "id-4").images);
}

/**
 * Asserts moves past the ends do not change the editor.
 *
 * Purpose: move up on the first section and move down on the last section are no-ops.
 * Inputs: none.
 * Side effects: dispatches add and move commands.
 */
function expectMoveAtTheEndsToDoNothing(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  const first = state.draft.data.sections[0];
  const last = state.draft.data.sections[1];
  if (first === undefined || last === undefined) {
    throw new Error("Expected two sections.");
  }
  // The first section has no previous neighbor.
  expect(dispatch({ type: "moveSection", sectionId: first.id, direction: "up" })).toBe(state);
  // The last section has no following neighbor.
  expect(dispatch({ type: "moveSection", sectionId: last.id, direction: "down" })).toBe(state);
  expect(sectionIds(state)).toEqual(["id-1", "id-2"]);
  expect(state.localSequence).toBe(2);
}

/**
 * Asserts removing the selected middle section selects the next section.
 *
 * Purpose: the following neighbor is selected when it exists, then the previous, then nothing.
 * Inputs: none.
 * Side effects: dispatches add, move, and remove commands.
 */
function expectRemovingTheSelectedMiddleSectionToSelectANeighbor(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  // The third add is selected. Moving it up places that selection in the middle.
  state = dispatch({ type: "moveSection", sectionId: "id-3", direction: "up" });
  expect(sectionIds(state)).toEqual(["id-1", "id-3", "id-2"]);
  expect(state.selectedSectionId).toBe("id-3");
  const first = state.draft.data.sections[0];
  const next = state.draft.data.sections[2];
  state = dispatch({ type: "removeSection", sectionId: "id-3" });
  // The next section was id-2, so that neighbor becomes selected.
  expect(sectionIds(state)).toEqual(["id-1", "id-2"]);
  expect(state.selectedSectionId).toBe("id-2");
  expect(state.draft.data.sections[0]).toBe(first);
  expect(state.draft.data.sections[1]).toBe(next);
  expect(state.dirty).toBe(true);
  state = dispatch({ type: "removeSection", sectionId: "id-2" });
  // The removed section was last, so the previous neighbor is selected.
  expect(sectionIds(state)).toEqual(["id-1"]);
  expect(state.selectedSectionId).toBe("id-1");
  state = dispatch({ type: "removeSection", sectionId: "id-1" });
  expect(state.draft.data.sections).toEqual([]);
  expect(state.selectedSectionId).toBeNull();
}

/**
 * Asserts the last image can be removed without removing the carousel.
 *
 * Purpose: an empty image list stays on the carousel, and the other carousel keeps its slide.
 * Inputs: none.
 * Side effects: dispatches add and image commands.
 */
function expectRemovingTheLastImageToLeaveTheCarousel(): void {
  const { dispatch, current } = createHarness();
  const initial = current();
  // A missing carousel does not consume an id or mark the editor dirty.
  expect(dispatch({ type: "addImage", sectionId: "missing" })).toBe(initial);
  let state = dispatch({ type: "addSection", sectionType: "carousel" });
  state = dispatch({ type: "addImage", sectionId: "id-1" });
  expect(requireCarousel(state.draft.data.sections[0], "first").images).toEqual([
    { id: "id-2", url: "", alt: "" },
  ]);
  state = dispatch({ type: "addSection", sectionType: "carousel" });
  state = dispatch({ type: "addImage", sectionId: "id-3" });
  const second = requireCarousel(state.draft.data.sections[1], "second");
  state = dispatch({ type: "removeImage", sectionId: "id-1", imageId: "id-2" });
  const first = requireCarousel(state.draft.data.sections[0], "emptied");
  expect(state.draft.data.sections).toHaveLength(2);
  expect(first.id).toBe("id-1");
  expect(first.type).toBe("carousel");
  expect(first.images).toEqual([]);
  expect(state.draft.data.sections[1]).toBe(second);
  expect(second.images).toEqual([{ id: "id-4", url: "", alt: "" }]);
  // The slide is already gone. Removing it again does not drop the carousel.
  expect(dispatch({ type: "removeImage", sectionId: "id-1", imageId: "id-2" })).toBe(state);
}

/**
 * Asserts import changes the draft and keeps the previous ETag.
 *
 * Purpose: import does not move the saved baseline or the tag a later save will send.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, save, and import commands.
 */
function expectImportToKeepThePreviousEtag(): void {
  const { dispatch } = createHarness();
  const saved = textDocument("saved-text", "Saved");
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(saved),
    etag: '"4"',
  });
  const baseline = state.savedBaseline;
  state = dispatch({
    type: "updateSection",
    sectionId: "saved-text",
    section: textSection("saved-text", "Dirty"),
  });
  state = dispatch({ type: "saveStarted" });
  state = dispatch({ type: "saveFailed" });
  expect(state.status).toBe("error");
  const importedDoc = textDocument("imported-text", "Imported");
  state = dispatch({ type: "importDocument", document: importedDoc });
  const source = importedDoc.data.sections[0];
  if (source !== undefined && source.type === "text") {
    // Mutating the caller's document must not change the draft copy.
    source.title = "Mutated import";
  }
  expect(textAt(state, 0).title).toBe("Imported");
  expect(textAt(state, 0).id).toBe("imported-text");
  expect(state.baseEtag).toBe('"4"');
  expect(state.savedBaseline).toBe(baseline);
  expect(baselineText(state).title).toBe("Saved");
  expect(state.dirty).toBe(true);
  expect(state.status).toBe("idle");
  expect(state.selectedSectionId).toBe("imported-text");
  expect(state.localSequence).toBe(2);
}

/**
 * Asserts a stale acknowledgement keeps the newer draft.
 *
 * Purpose: sequence N is stored on the server, and a later edit stays on screen with the new ETag.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, save, and acknowledgement commands.
 */
function expectStaleSaveAcknowledgementToKeepTheNewerDraft(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Saved")),
    etag: '"1"',
  });
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "A"),
  });
  expect(state.localSequence).toBe(1);
  const started = dispatch({ type: "saveStarted" });
  expect(started.draft).toBe(state.draft);
  expect(started.localSequence).toBe(1);
  expect(started.status).toBe("saving");
  expect(started.pendingSave).toEqual({ sequence: 1, etag: '"1"' });
  // A second click does not move the recorded sequence.
  expect(dispatch({ type: "saveStarted" })).toBe(started);
  const snapshot = requireValid(validateDraft(started.draft));
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "B", "#"),
  });
  const newerDraft = state.draft;
  expect(state.localSequence).toBe(2);
  // The in-flight save still names sequence 1 while the draft shows the newer title.
  expect(state.status).toBe("saving");
  expect(state.pendingSave).toEqual({ sequence: 1, etag: '"1"' });
  expect(state.baseEtag).toBe('"1"');
  const acknowledged = asConfiguration(snapshot, 8);
  state = dispatch({
    type: "saveAcknowledged",
    configuration: acknowledged,
    etag: '"9"',
    sequence: 1,
  });
  const acknowledgedSection = acknowledged.data.sections[0];
  if (acknowledgedSection !== undefined && acknowledgedSection.type === "text") {
    // The server object is not the baseline. Changing it leaves the stored title alone.
    acknowledgedSection.title = "Mutated acknowledgement";
  }
  expect(state.draft).toBe(newerDraft);
  expect(textAt(state, 0).title).toBe("B");
  expect(textAt(state, 0).titleColor).toBe("#");
  expect(state.dirty).toBe(true);
  expect(state.status).toBe("idle");
  expect(state.baseEtag).toBe('"9"');
  expect(state.localSequence).toBe(2);
  expect(state.pendingSave).toBeNull();
  expect(baselineText(state).title).toBe("A");
  expect(baselineText(state).titleColor).toBe("#112233");
}

/**
 * Asserts a matching acknowledgement replaces the draft and clears dirty.
 *
 * Purpose: the server document becomes the draft only when the sequence is still the one that was saved.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, save, and acknowledgement commands.
 */
function expectMatchingSaveAcknowledgementToReplaceTheDraft(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Saved")),
    etag: '"1"',
  });
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "A"),
  });
  const beforeAck = dispatch({ type: "saveStarted" });
  const serverDocument = textDocument("text-1", "From server");
  const serverConfiguration = asConfiguration(serverDocument, 2);
  state = dispatch({
    type: "saveAcknowledged",
    configuration: serverConfiguration,
    etag: '"9"',
    sequence: 1,
  });
  expect(state.draft).not.toBe(beforeAck.draft);
  expect(textAt(state, 0).title).toBe("From server");
  expect(state.dirty).toBe(false);
  expect(state.status).toBe("saved");
  expect(state.baseEtag).toBe('"9"');
  expect(state.localSequence).toBe(1);
  expect(state.pendingSave).toBeNull();
  expect(state.selectedSectionId).toBe("text-1");
  expect(baselineText(state).title).toBe("From server");
  const serverSection = serverConfiguration.data.sections[0];
  if (serverSection !== undefined && serverSection.type === "text") {
    // Draft and baseline are copies. The acknowledgement payload can change without them.
    serverSection.title = "Mutated acknowledgement";
  }
  expect(textAt(state, 0).title).toBe("From server");
  expect(baselineText(state).title).toBe("From server");
  const baseline = state.savedBaseline;
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "After save"),
  });
  // A later edit is unsaved. It does not rewrite the baseline or the acknowledged tag.
  expect(textAt(state, 0).title).toBe("After save");
  expect(state.dirty).toBe(true);
  expect(state.status).toBe("idle");
  expect(state.savedBaseline).toBe(baseline);
  expect(baselineText(state).title).toBe("From server");
  expect(state.baseEtag).toBe('"9"');
  expect(state.localSequence).toBe(2);
}

/**
 * Asserts hydrate does not replace a draft that is already loaded or dirty.
 *
 * Purpose: the command runs from the initial empty editor only.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, and import commands.
 */
function expectHydrateToIgnoreADirtyDraft(): void {
  const emptyHarness = createHarness();
  const empty = emptyHarness.dispatch({
    type: "hydrate",
    configuration: asConfiguration(documentFromSections([])),
    etag: null,
  });
  expect(empty.draft.data.sections).toEqual([]);
  expect(empty.selectedSectionId).toBeNull();
  expect(empty.dirty).toBe(false);
  expect(empty.baseEtag).toBeNull();
  expect(empty.savedBaseline).not.toBeNull();
  // No tag was loaded, so Save cannot invent one.
  expect(emptyHarness.dispatch({ type: "saveStarted" })).toBe(empty);
  const later = asConfiguration(textDocument("later", "Later"));
  // The empty document was already hydrated. A second payload does not fill it.
  expect(
    emptyHarness.dispatch({
      type: "hydrate",
      configuration: later,
      etag: '"2"',
    }),
  ).toBe(empty);

  const dirtyHarness = createHarness();
  const source = asConfiguration(
    documentFromSections([textSection("first", "First"), textSection("second", "Second")]),
  );
  let state = dirtyHarness.dispatch({
    type: "hydrate",
    configuration: source,
    etag: '"1"',
  });
  const loadedSection = source.data.sections[0];
  if (loadedSection !== undefined && loadedSection.type === "text") {
    // The loader object is not the draft. Changing it leaves the editor alone.
    loadedSection.title = "Mutated source";
  }
  expect(textAt(state, 0).title).toBe("First");
  expect(baselineText(state).title).toBe("First");
  expect(state.selectedSectionId).toBe("first");
  expect(state.dirty).toBe(false);
  expect(state.localSequence).toBe(0);
  state = dirtyHarness.dispatch({
    type: "updateSection",
    sectionId: "first",
    section: textSection("first", "Local"),
  });
  const dirty = state;
  expect(
    dirtyHarness.dispatch({
      type: "hydrate",
      configuration: asConfiguration(textDocument("other", "Other")),
      etag: '"2"',
    }),
  ).toBe(dirty);
  expect(textAt(dirty, 0).title).toBe("Local");
  expect(dirty.baseEtag).toBe('"1"');
  expect(dirty.dirty).toBe(true);

  const importedHarness = createHarness();
  const imported = importedHarness.dispatch({
    type: "importDocument",
    document: textDocument("imported-text", "Imported"),
  });
  expect(imported.savedBaseline).toBeNull();
  expect(imported.dirty).toBe(true);
  // Import has no baseline yet. Hydrate still must not replace that draft.
  expect(
    importedHarness.dispatch({
      type: "hydrate",
      configuration: asConfiguration(textDocument("server-text", "Server")),
      etag: '"1"',
    }),
  ).toBe(imported);
  expect(textAt(imported, 0).title).toBe("Imported");
}

/**
 * Asserts an invalid color fails validation and stays in the draft.
 *
 * Purpose: typing "#" does not clear the field or get repaired by the reducer.
 * Inputs: none.
 * Side effects: dispatches add and update commands.
 */
function expectInvalidColorToStayInTheDraft(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({
    type: "updateSection",
    sectionId: "id-1",
    section: textSection("id-1", "Title", "#"),
  });
  const draft = state.draft;
  const result = validateDraft(draft);
  if (result.ok) {
    throw new Error("Expected the invalid color to fail validation.");
  }
  expect(textAt(state, 0).titleColor).toBe("#");
  expect(draft).toBe(state.draft);
  expect(pathsInclude(result.issues, "titleColor")).toBe(true);
}

/**
 * Asserts a valid shorthand color is normalized only on the validation result.
 *
 * Purpose: the draft keeps the typed characters, and the portable document stores lowercase #rrggbb.
 * Inputs: none.
 * Side effects: dispatches add and update commands.
 */
function expectValidColorToNormalizeWithoutChangingTheDraft(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({
    type: "updateSection",
    sectionId: "id-1",
    section: textSection("id-1", "Title", "#ABC"),
  });
  const result = validateDraft(state.draft);
  const document = requireValid(result);
  const stored = document.data.sections[0];
  if (stored === undefined || stored.type !== "text") {
    throw new Error("Expected the validated text section.");
  }
  expect(stored.titleColor).toBe("#aabbcc");
  expect(textAt(state, 0).titleColor).toBe("#ABC");
}

/**
 * Asserts duplicate section ids fail validation and stay in the draft.
 *
 * Purpose: the validator reports the constraint. The draft is not rewritten to remove the copy.
 * Inputs: none.
 * Side effects: none.
 */
function expectDuplicateSectionIdsToFailValidation(): void {
  const draft: DraftDocument = {
    schemaVersion: 1,
    data: {
      sections: [textSection("same", "One"), textSection("same", "Two")],
    },
  };
  const result = validateDraft(draft);
  if (result.ok) {
    throw new Error("Expected duplicate section ids to fail validation.");
  }
  expect(messagesInclude(result.issues, "unique")).toBe(true);
  expect(draft.data.sections.map((section) => section.id)).toEqual(["same", "same"]);
}

/**
 * Asserts a failed save and a conflict leave the draft in place.
 *
 * Purpose: neither command clears the title or the dirty flag.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, save, and conflict commands.
 */
function expectSaveFailureAndConflictToKeepTheDraft(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Saved")),
    etag: '"1"',
  });
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "Local"),
  });
  const sequence = state.localSequence;
  state = dispatch({ type: "saveStarted" });
  const draft = state.draft;
  state = dispatch({ type: "saveFailed" });
  expect(state.status).toBe("error");
  expect(state.pendingSave).toBeNull();
  expect(state.draft).toBe(draft);
  expect(textAt(state, 0).title).toBe("Local");
  expect(state.dirty).toBe(true);
  expect(state.localSequence).toBe(sequence);
  expect(state.baseEtag).toBe('"1"');
  state = dispatch({ type: "conflictObserved" });
  expect(state.status).toBe("conflict");
  expect(state.dirty).toBe(true);
  expect(textAt(state, 0).title).toBe("Local");
  expect(state.baseEtag).toBe('"1"');
}

/**
 * Asserts reload replaces the draft and a late acknowledgement does not dirty it.
 *
 * Purpose: reload is an explicit replacement. An older sequence must not wipe that replacement or mark it unsaved.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, conflict, reload, and acknowledgement commands.
 */
function expectReloadToReplaceTheDraft(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Server")),
    etag: '"1"',
  });
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "Local"),
  });
  state = dispatch({ type: "conflictObserved" });
  expect(state.status).toBe("conflict");
  expect(state.localSequence).toBe(1);
  const reloadConfiguration = asConfiguration(textDocument("reloaded-text", "Reloaded"), 3);
  const reloaded = dispatch({
    type: "reloadFromServer",
    configuration: reloadConfiguration,
    etag: '"2"',
  });
  expect(textAt(reloaded, 0).title).toBe("Reloaded");
  expect(textAt(reloaded, 0).id).toBe("reloaded-text");
  expect(reloaded.dirty).toBe(false);
  expect(reloaded.status).toBe("idle");
  expect(reloaded.baseEtag).toBe('"2"');
  expect(reloaded.localSequence).toBe(0);
  expect(reloaded.pendingSave).toBeNull();
  expect(reloaded.selectedSectionId).toBe("reloaded-text");
  expect(baselineText(reloaded).title).toBe("Reloaded");
  const reloadedSection = reloadConfiguration.data.sections[0];
  if (reloadedSection !== undefined && reloadedSection.type === "text") {
    // The reload payload is not the draft. Changing it leaves the loaded title alone.
    reloadedSection.title = "Mutated reload";
  }
  expect(textAt(reloaded, 0).title).toBe("Reloaded");
  expect(baselineText(reloaded).title).toBe("Reloaded");
  // Sequence 1 is from before the reload. It is not a newer local edit.
  expect(
    dispatch({
      type: "saveAcknowledged",
      configuration: asConfiguration(textDocument("old-ack", "Old ack")),
      etag: '"3"',
      sequence: 1,
    }),
  ).toBe(reloaded);
  expect(textAt(reloaded, 0).title).toBe("Reloaded");
  expect(reloaded.dirty).toBe(false);
  expect(reloaded.baseEtag).toBe('"2"');
}

/**
 * Renders the provider's initial editor.
 *
 * Purpose: the test can see both contexts without a presentational editor.
 * Inputs: none.
 * Side effects: none.
 */
function EditorProbe(): JSX.Element {
  const state = useEditorState();
  const dispatch = useEditorDispatch();
  // The text is the initial draft size, dirty flag, status, sequence, and dispatch type.
  return createElement(
    "p",
    null,
    `${state.draft.data.sections.length}:${state.dirty ? "dirty" : "clean"}:${state.status}:${state.localSequence}:${typeof dispatch}`,
  );
}

/**
 * Renders a child that only reads dispatch.
 *
 * Purpose: the missing-provider check for dispatch can fail on its own.
 * Inputs: none.
 * Side effects: none. Throws when the provider is missing.
 */
function EditorDispatchProbe(): JSX.Element {
  // The hook throws before this element can render.
  useEditorDispatch();
  return createElement("p", null, "dispatch");
}

/**
 * Asserts the provider exposes the initial state and dispatch.
 *
 * Purpose: a child can read the reducer without a second copy of the sections.
 * Inputs: none.
 * Side effects: renders the provider.
 */
function expectProviderToExposeStateAndDispatch(): void {
  const html = renderToStaticMarkup(createElement(EditorProvider, null, createElement(EditorProbe)));
  // No sections, not dirty, idle, sequence 0, and a dispatch function.
  expect(html).toContain("0:clean:idle:0:function");
}

/**
 * Asserts the hooks throw outside the provider.
 *
 * Purpose: the default context value is not an empty document a child might edit.
 * Inputs: none.
 * Side effects: renders a probe that throws.
 */
function expectHooksOutsideTheProviderToThrow(): void {
  let stateError = "";
  try {
    renderToStaticMarkup(createElement(EditorProbe));
  } catch (error) {
    stateError = errorText(error);
  }
  expect(stateError).toContain("useEditorState must be used within EditorProvider.");
  let dispatchError = "";
  try {
    renderToStaticMarkup(createElement(EditorDispatchProbe));
  } catch (error) {
    dispatchError = errorText(error);
  }
  expect(dispatchError).toContain("useEditorDispatch must be used within EditorProvider.");
}

/**
 * Asserts commands for a missing row do not edit the draft or skip an id.
 *
 * Purpose: a text row has no images, and an unknown id does not append a section or a slide.
 * Inputs: none.
 * Side effects: dispatches add, image, and update commands.
 */
function expectUnknownTargetsToLeaveTheEditorUnchanged(): void {
  const { dispatch, current } = createHarness();
  const initial = current();
  // An empty editor has nothing to remove, move, or update.
  expect(dispatch({ type: "removeSection", sectionId: "missing" })).toBe(initial);
  expect(dispatch({ type: "moveSection", sectionId: "missing", direction: "down" })).toBe(initial);
  expect(dispatch({ type: "placeSection", sectionId: "missing", toIndex: 0 })).toBe(initial);
  expect(dispatch({ type: "selectSection", sectionId: "missing" })).toBe(initial);
  expect(dispatch({ type: "updateSection", sectionId: "missing", section: textSection("missing", "Nope") })).toBe(initial);
  const text = dispatch({ type: "addSection", sectionType: "text" });
  // Image commands do not apply to text, and they do not take the next id.
  expect(dispatch({ type: "addImage", sectionId: "id-1" })).toBe(text);
  expect(
    dispatch({
      type: "updateImage",
      sectionId: "id-1",
      imageId: "none",
      image: { url: "https://example.com/a.jpg", alt: "" },
    }),
  ).toBe(text);
  expect(dispatch({ type: "removeImage", sectionId: "id-1", imageId: "none" })).toBe(text);
  const carousel = dispatch({ type: "addSection", sectionType: "carousel" });
  expect(sectionIds(carousel)).toEqual(["id-1", "id-2"]);
  // A text payload does not change a carousel's type.
  expect(dispatch({ type: "updateSection", sectionId: "id-2", section: textSection("id-2", "Not a carousel") })).toBe(
    carousel,
  );
  const withImage = dispatch({ type: "addImage", sectionId: "id-2" });
  expect(requireCarousel(withImage.draft.data.sections[1], "carousel").images).toEqual([
    { id: "id-3", url: "", alt: "" },
  ]);
  // An unknown slide is not appended and is not treated as a removal.
  expect(
    dispatch({
      type: "updateImage",
      sectionId: "id-2",
      imageId: "missing-slide",
      image: { url: "https://example.com/a.jpg", alt: "x" },
    }),
  ).toBe(withImage);
  expect(dispatch({ type: "removeImage", sectionId: "id-2", imageId: "missing-slide" })).toBe(withImage);
}

/**
 * Asserts removing a row that is not selected leaves the selection on its id.
 *
 * Purpose: only the selected row moves the inspector to a neighbor.
 * Inputs: none.
 * Side effects: dispatches add and remove commands.
 */
function expectRemovingAnUnselectedSectionToKeepTheSelection(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  const second = state.draft.data.sections[1];
  const third = state.draft.data.sections[2];
  expect(state.selectedSectionId).toBe("id-3");
  state = dispatch({ type: "removeSection", sectionId: "id-1" });
  // The selected id is still in the list, so it stays selected.
  expect(sectionIds(state)).toEqual(["id-2", "id-3"]);
  expect(state.selectedSectionId).toBe("id-3");
  expect(state.draft.data.sections[0]).toBe(second);
  expect(state.draft.data.sections[1]).toBe(third);
  expect(state.localSequence).toBe(4);
}

/**
 * Asserts one removal of a repeated section id leaves the later copies.
 *
 * Purpose: the reducer does not repair duplicate ids. The validator still sees the ones that remain.
 * Inputs: none.
 * Side effects: dispatches add and remove commands.
 */
function expectRemovingOneDuplicateSectionIdToLeaveTheLaterCopy(): void {
  const { dispatch } = createHarness(repeatedId("dup"));
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  const second = state.draft.data.sections[1];
  const third = state.draft.data.sections[2];
  expect(sectionIds(state)).toEqual(["dup", "dup", "dup"]);
  state = dispatch({ type: "removeSection", sectionId: "dup" });
  // The first match is gone. The later two objects stay, still sharing an id.
  expect(state.draft.data.sections).toHaveLength(2);
  expect(state.draft.data.sections[0]).toBe(second);
  expect(state.draft.data.sections[1]).toBe(third);
  expect(sectionIds(state)).toEqual(["dup", "dup"]);
  const issues = requireIssues(validateDraft(state.draft));
  expect(messagesInclude(issues, "unique")).toBe(true);
}

/**
 * Asserts move down swaps one neighbor and keeps the selection.
 *
 * Purpose: moving a row that is not selected does not change which section is selected.
 * Inputs: none.
 * Side effects: dispatches add and move commands.
 */
function expectMoveDownToKeepTheOtherSectionsAndTheSelection(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  const first = state.draft.data.sections[0];
  const second = state.draft.data.sections[1];
  const third = state.draft.data.sections[2];
  state = dispatch({ type: "moveSection", sectionId: "id-1", direction: "down" });
  // id-1 trades with id-2. id-3 stays last and stays selected.
  expect(sectionIds(state)).toEqual(["id-2", "id-1", "id-3"]);
  expect(state.draft.data.sections[0]).toBe(second);
  expect(state.draft.data.sections[1]).toBe(first);
  expect(state.draft.data.sections[2]).toBe(third);
  expect(state.selectedSectionId).toBe("id-3");
  expect(state.localSequence).toBe(4);
  expect(state.dirty).toBe(true);
}

/**
 * Asserts placing a section moves it once and leaves the other objects in place.
 *
 * Purpose: a drag is one edit, and dropping on the current index or an invalid index is not.
 * Inputs: none.
 * Side effects: dispatches add and place commands.
 */
function expectPlacingASectionToMoveItOnce(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "text" });
  state = dispatch({ type: "addSection", sectionType: "cta" });
  const first = state.draft.data.sections[0];
  const second = state.draft.data.sections[1];
  const third = state.draft.data.sections[2];
  const fourth = state.draft.data.sections[3];
  const sequence = state.localSequence;
  // The current index, a fraction, and an index past the list are not edits.
  expect(dispatch({ type: "placeSection", sectionId: "id-1", toIndex: 0 })).toBe(state);
  expect(dispatch({ type: "placeSection", sectionId: "id-1", toIndex: 1.5 })).toBe(state);
  expect(dispatch({ type: "placeSection", sectionId: "id-1", toIndex: 4 })).toBe(state);
  expect(dispatch({ type: "placeSection", sectionId: "id-1", toIndex: -1 })).toBe(state);
  state = dispatch({ type: "placeSection", sectionId: "id-1", toIndex: 2 });
  // id-1 lands at index 2. The other objects stay, and the CTA stays selected.
  expect(sectionIds(state)).toEqual(["id-2", "id-3", "id-1", "id-4"]);
  expect(state.draft.data.sections[0]).toBe(second);
  expect(state.draft.data.sections[1]).toBe(third);
  expect(state.draft.data.sections[2]).toBe(first);
  expect(state.draft.data.sections[3]).toBe(fourth);
  expect(state.selectedSectionId).toBe("id-4");
  expect(state.localSequence).toBe(sequence + 1);
  expect(state.dirty).toBe(true);
}

/**
 * Asserts an image edit stays on that slide and that carousel.
 *
 * Purpose: adding or editing one carousel does not change the other, and an invalid URL stays typed.
 * Inputs: none.
 * Side effects: dispatches add and image commands.
 */
function expectImageEditsToStayOnOneSlide(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "carousel" });
  state = dispatch({ type: "addSection", sectionType: "carousel" });
  const second = state.draft.data.sections[1];
  const firstImages = requireCarousel(state.draft.data.sections[0], "first").images;
  const secondImages = requireCarousel(second, "second").images;
  expect(firstImages).toEqual([]);
  expect(secondImages).toEqual([]);
  expect(firstImages).not.toBe(secondImages);
  state = dispatch({ type: "addImage", sectionId: "id-1" });
  state = dispatch({ type: "addImage", sectionId: "id-1" });
  expect(state.draft.data.sections[1]).toBe(second);
  expect(requireCarousel(second, "second still empty").images).toEqual([]);
  const image = { url: "not-a-url", alt: "Second" };
  state = dispatch({
    type: "updateImage",
    sectionId: "id-1",
    imageId: "id-4",
    image,
  });
  image.url = "https://example.com/changed-later.jpg";
  const carousel = requireCarousel(state.draft.data.sections[0], "edited");
  expect(carousel.aspectRatio).toBe("landscape");
  expect(carousel.images).toEqual([
    { id: "id-3", url: "", alt: "" },
    { id: "id-4", url: "not-a-url", alt: "Second" },
  ]);
  const issues = requireIssues(validateDraft(state.draft));
  expect(pathsInclude(issues, "url")).toBe(true);
  expect(carousel.images[1]?.url).toBe("not-a-url");
  state = dispatch({ type: "removeImage", sectionId: "id-1", imageId: "id-3" });
  // The other slide stays on the same carousel. The second carousel is untouched.
  expect(requireCarousel(state.draft.data.sections[0], "after removal").images).toEqual([
    { id: "id-4", url: "not-a-url", alt: "Second" },
  ]);
  expect(state.draft.data.sections[1]).toBe(second);
  expect(state.draft.data.sections).toHaveLength(2);
}

/**
 * Asserts one removal of a repeated image id leaves the later slides.
 *
 * Purpose: image ids are not deduped by the reducer. A repeated id inside one carousel still fails validation.
 * Inputs: none.
 * Side effects: dispatches add, update, and remove commands.
 */
function expectDuplicateImageIdsToStayUntilEachCopyIsAddressed(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "carousel" });
  const carousel = requireCarousel(state.draft.data.sections[0], "carousel");
  state = dispatch({
    type: "updateSection",
    sectionId: carousel.id,
    section: {
      id: carousel.id,
      type: "carousel",
      aspectRatio: "landscape",
      images: [
        { id: "slide", url: "https://example.com/a.jpg", alt: "A" },
        { id: "slide", url: "https://example.com/b.jpg", alt: "B" },
        { id: "slide", url: "https://example.com/c.jpg", alt: "C" },
      ],
    },
  });
  state = dispatch({ type: "removeImage", sectionId: "id-1", imageId: "slide" });
  // The first slide is gone. The later two still share an id, so validation fails.
  expect(requireCarousel(state.draft.data.sections[0], "remaining").images).toEqual([
    { id: "slide", url: "https://example.com/b.jpg", alt: "B" },
    { id: "slide", url: "https://example.com/c.jpg", alt: "C" },
  ]);
  expect(messagesInclude(requireIssues(validateDraft(state.draft)), "unique")).toBe(true);

  const shared = createHarness();
  let sharedState = shared.dispatch({ type: "addSection", sectionType: "carousel" });
  sharedState = shared.dispatch({ type: "addSection", sectionType: "carousel" });
  sharedState = shared.dispatch({
    type: "updateSection",
    sectionId: "id-1",
    section: {
      id: "id-1",
      type: "carousel",
      aspectRatio: "landscape",
      images: [{ id: "shared", url: "https://example.com/a.jpg", alt: "A" }],
    },
  });
  sharedState = shared.dispatch({
    type: "updateSection",
    sectionId: "id-2",
    section: {
      id: "id-2",
      type: "carousel",
      aspectRatio: "portrait",
      images: [{ id: "shared", url: "https://example.com/b.jpg", alt: "B" }],
    },
  });
  // The same image id is allowed in the other carousel, and each URL stays with its section.
  expect(requireValid(validateDraft(sharedState.draft)).data.sections).toHaveLength(2);
  expect(findCarousel(sharedState, "id-1").images).toEqual([
    { id: "shared", url: "https://example.com/a.jpg", alt: "A" },
  ]);
  expect(findCarousel(sharedState, "id-2").images).toEqual([
    { id: "shared", url: "https://example.com/b.jpg", alt: "B" },
  ]);
  expect(findCarousel(sharedState, "id-2").aspectRatio).toBe("portrait");
}

/**
 * Asserts an import during a save keeps the imported draft when that save is acknowledged.
 *
 * Purpose: the in-flight sequence is older than the import, so the acknowledgement updates the tag and not the draft.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, save, import, and acknowledgement commands.
 */
function expectImportDuringSaveToKeepTheImportedDraft(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("saved-text", "Saved")),
    etag: '"4"',
  });
  state = dispatch({
    type: "updateSection",
    sectionId: "saved-text",
    section: textSection("saved-text", "A"),
  });
  const snapshot = requireValid(validateDraft(state.draft));
  state = dispatch({ type: "saveStarted" });
  expect(state.pendingSave).toEqual({ sequence: 1, etag: '"4"' });
  state = dispatch({ type: "importDocument", document: textDocument("imported-text", "Imported") });
  // Import changes the draft and the status. The in-flight save record stays.
  expect(textAt(state, 0).title).toBe("Imported");
  expect(state.status).toBe("idle");
  expect(state.dirty).toBe(true);
  expect(state.localSequence).toBe(2);
  expect(state.baseEtag).toBe('"4"');
  expect(state.pendingSave).toEqual({ sequence: 1, etag: '"4"' });
  expect(baselineText(state).title).toBe("Saved");
  state = dispatch({
    type: "saveAcknowledged",
    configuration: asConfiguration(snapshot, 5),
    etag: '"9"',
    sequence: 1,
  });
  expect(textAt(state, 0).title).toBe("Imported");
  expect(textAt(state, 0).id).toBe("imported-text");
  expect(state.dirty).toBe(true);
  expect(state.status).toBe("idle");
  expect(state.baseEtag).toBe('"9"');
  expect(state.localSequence).toBe(2);
  expect(state.pendingSave).toBeNull();
  expect(baselineText(state).title).toBe("A");
}

/**
 * Asserts import selects the first imported section, including when the file is empty.
 *
 * Purpose: the previous selection is not kept once the draft is replaced.
 * Inputs: none.
 * Side effects: dispatches hydrate and import commands.
 */
function expectImportToSelectTheFirstSection(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(documentFromSections([textSection("first", "First"), textSection("second", "Second")])),
    etag: '"4"',
  });
  expect(state.selectedSectionId).toBe("first");
  state = dispatch({
    type: "importDocument",
    document: documentFromSections([textSection("alpha", "Alpha"), textSection("beta", "Beta")]),
  });
  expect(sectionIds(state)).toEqual(["alpha", "beta"]);
  expect(state.selectedSectionId).toBe("alpha");
  expect(textAt(state, 1).title).toBe("Beta");
  expect(state.baseEtag).toBe('"4"');
  expect(baselineText(state).title).toBe("First");
  state = dispatch({ type: "importDocument", document: documentFromSections([]) });
  // An empty file clears the selection. The saved tag and baseline stay.
  expect(state.draft.data.sections).toEqual([]);
  expect(state.selectedSectionId).toBeNull();
  expect(state.baseEtag).toBe('"4"');
  expect(baselineText(state).title).toBe("First");
  expect(state.dirty).toBe(true);
  expect(state.status).toBe("idle");
  expect(state.localSequence).toBe(2);
}

/**
 * Asserts an acknowledgement for a sequence this editor has not reached is ignored.
 *
 * Purpose: a sequence ahead of `localSequence` must not replace the draft or move the ETag.
 * Inputs: none.
 * Side effects: dispatches hydrate and acknowledgement commands.
 */
function expectAFutureAcknowledgementToLeaveTheEditorUnchanged(): void {
  const { dispatch } = createHarness();
  const hydrated = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Server"), 4),
    etag: '"1"',
  });
  expect(hydrated.localSequence).toBe(0);
  // Sequence 4 was never produced here. Revision 9 is not a reason to apply the document.
  expect(
    dispatch({
      type: "saveAcknowledged",
      configuration: asConfiguration(textDocument("other", "Other"), 9),
      etag: '"9"',
      sequence: 4,
    }),
  ).toBe(hydrated);
  expect(textAt(hydrated, 0).title).toBe("Server");
  expect(hydrated.baseEtag).toBe('"1"');
  expect(hydrated.dirty).toBe(false);
  expect(hydrated.status).toBe("idle");
}

/**
 * Asserts a conflict keeps the in-flight save, and a later edit keeps the conflict.
 *
 * Purpose: conflict does not adopt a new tag, and typing does not clear the conflict status.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, save, and conflict commands.
 */
function expectConflictToKeepTheInFlightSave(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Saved")),
    etag: '"1"',
  });
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "Local"),
  });
  state = dispatch({ type: "saveStarted" });
  const pending = state.pendingSave;
  state = dispatch({ type: "conflictObserved" });
  expect(state.status).toBe("conflict");
  expect(state.pendingSave).toEqual(pending);
  expect(state.pendingSave).toEqual({ sequence: 1, etag: '"1"' });
  expect(textAt(state, 0).title).toBe("Local");
  expect(state.dirty).toBe(true);
  expect(state.baseEtag).toBe('"1"');
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "Still local"),
  });
  // The conflict stays on screen. The pending sequence is still the one from the click.
  expect(state.status).toBe("conflict");
  expect(state.pendingSave).toEqual({ sequence: 1, etag: '"1"' });
  expect(textAt(state, 0).title).toBe("Still local");
  expect(state.dirty).toBe(true);
  expect(state.localSequence).toBe(2);
  expect(baselineText(state).title).toBe("Saved");
}

/**
 * Asserts a failed save can be retried at the newer sequence, and an edit keeps the error.
 *
 * Purpose: retry records the current sequence and the loaded ETag. It does not invent a tag from the revision.
 * Inputs: none.
 * Side effects: dispatches hydrate, update, and save commands.
 */
function expectRetryAfterFailureToRecordTheNewerSequence(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Saved"), 6),
    etag: '"1"',
  });
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "A"),
  });
  state = dispatch({ type: "saveStarted" });
  expect(state.pendingSave).toEqual({ sequence: 1, etag: '"1"' });
  state = dispatch({ type: "saveFailed" });
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "B"),
  });
  // The error stays until the next save click. The title is the newer one.
  expect(state.status).toBe("error");
  expect(textAt(state, 0).title).toBe("B");
  expect(state.localSequence).toBe(2);
  expect(state.pendingSave).toBeNull();
  state = dispatch({ type: "saveStarted" });
  expect(state.status).toBe("saving");
  expect(state.pendingSave).toEqual({ sequence: 2, etag: '"1"' });
  expect(textAt(state, 0).title).toBe("B");
  expect(state.baseEtag).toBe('"1"');
}

/**
 * Asserts hydrate stores the ETag it was given and omits service fields.
 *
 * Purpose: revision 7 is not the strong tag, and it is not copied onto the draft or the baseline.
 * Inputs: none.
 * Side effects: dispatches hydrate and update commands.
 */
function expectHydrateToStoreTheEtagRatherThanTheRevision(): void {
  const { dispatch } = createHarness();
  let state = dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Server"), 7),
    etag: '"etag-not-revision"',
  });
  const draftSection = state.draft.data.sections[0];
  const baseline = state.savedBaseline;
  if (baseline === null) {
    throw new Error("Expected a saved baseline.");
  }
  // The portable document has schemaVersion and data. id, revision, and updatedAt stay on the configuration.
  expect(Object.keys(state.draft).sort()).toEqual(["data", "schemaVersion"]);
  expect(Object.keys(baseline).sort()).toEqual(["data", "schemaVersion"]);
  expect(state.draft.schemaVersion).toBe(1);
  expect(state.baseEtag).toBe('"etag-not-revision"');
  expect(draftSection).not.toBe(baseline.data.sections[0]);
  state = dispatch({
    type: "updateSection",
    sectionId: "text-1",
    section: textSection("text-1", "Local"),
  });
  expect(textAt(state, 0).title).toBe("Local");
  expect(baselineText(state).title).toBe("Server");
  expect(state.baseEtag).toBe('"etag-not-revision"');
}

/**
 * Asserts each color field normalizes only on the validation result.
 *
 * Purpose: shorthand colors expand in the portable document, and invalid colors and a blank CTA label stay in the draft.
 * Inputs: none.
 * Side effects: dispatches add and update commands.
 */
function expectValidationToNormalizeEachColorWithoutChangingTheDraft(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  const text = textAt(state, 0);
  state = dispatch({
    type: "updateSection",
    sectionId: text.id,
    section: { ...text, descriptionColor: "#ABC" },
  });
  const normalized = requireValid(validateDraft(state.draft));
  const storedText = normalized.data.sections[0];
  if (storedText === undefined || storedText.type !== "text") {
    throw new Error("Expected the validated text section.");
  }
  expect(storedText.descriptionColor).toBe("#aabbcc");
  expect(storedText.titleColor).toBe("#112233");
  expect(textAt(state, 0).descriptionColor).toBe("#ABC");
  state = dispatch({
    type: "updateSection",
    sectionId: text.id,
    section: { ...textAt(state, 0), descriptionColor: "nope" },
  });
  expect(pathsInclude(requireIssues(validateDraft(state.draft)), "descriptionColor")).toBe(true);
  expect(textAt(state, 0).descriptionColor).toBe("nope");
  // The CTA checks below need the text block to be valid again.
  state = dispatch({
    type: "updateSection",
    sectionId: text.id,
    section: { ...textAt(state, 0), descriptionColor: "#334455" },
  });

  state = dispatch({ type: "addSection", sectionType: "cta" });
  const cta = state.draft.data.sections[1];
  if (cta === undefined || cta.type !== "cta") {
    throw new Error("Expected a CTA section.");
  }
  state = dispatch({
    type: "updateSection",
    sectionId: cta.id,
    section: { ...cta, backgroundColor: "#AbC", labelColor: "#fff" },
  });
  const withCta = requireValid(validateDraft(state.draft));
  const storedCta = withCta.data.sections[1];
  if (storedCta === undefined || storedCta.type !== "cta") {
    throw new Error("Expected the validated CTA.");
  }
  expect(storedCta.backgroundColor).toBe("#aabbcc");
  expect(storedCta.labelColor).toBe("#ffffff");
  const editedCta = state.draft.data.sections[1];
  if (editedCta === undefined || editedCta.type !== "cta") {
    throw new Error("Expected the draft CTA.");
  }
  expect(editedCta.backgroundColor).toBe("#AbC");
  expect(editedCta.labelColor).toBe("#fff");
  state = dispatch({
    type: "updateSection",
    sectionId: cta.id,
    section: { ...editedCta, backgroundColor: "red" },
  });
  expect(pathsInclude(requireIssues(validateDraft(state.draft)), "backgroundColor")).toBe(true);
  const invalidBackground = state.draft.data.sections[1];
  if (invalidBackground === undefined || invalidBackground.type !== "cta") {
    throw new Error("Expected the CTA with the invalid background.");
  }
  expect(invalidBackground.backgroundColor).toBe("red");
  expect(invalidBackground.labelColor).toBe("#fff");
  state = dispatch({
    type: "updateSection",
    sectionId: cta.id,
    section: {
      ...invalidBackground,
      backgroundColor: "#112233",
      labelColor: "#ffffff",
      label: "   ",
    },
  });
  // The schema trims a CTA label when it checks it. The draft keeps the spaces.
  expect(pathEndsWith(requireIssues(validateDraft(state.draft)), ".label")).toBe(true);
  const blankLabel = state.draft.data.sections[1];
  if (blankLabel === undefined || blankLabel.type !== "cta") {
    throw new Error("Expected the CTA with the blank label.");
  }
  expect(blankLabel.label).toBe("   ");
}

/**
 * Asserts a matching acknowledgement keeps a selection that survives and moves when it does not.
 *
 * Purpose: the selected id stays when the server document still has it, and otherwise the first section is selected.
 * Inputs: none.
 * Side effects: dispatches hydrate, add, save, and acknowledgement commands.
 */
function expectMatchingAcknowledgementToFollowTheSelectedSection(): void {
  const keep = createHarness();
  let state = keep.dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("anchor", "Anchor")),
    etag: '"1"',
  });
  state = keep.dispatch({ type: "addSection", sectionType: "text" });
  expect(state.selectedSectionId).toBe("id-1");
  expect(state.localSequence).toBe(1);
  state = keep.dispatch({ type: "saveStarted" });
  state = keep.dispatch({
    type: "saveAcknowledged",
    configuration: asConfiguration(
      documentFromSections([textSection("anchor", "Anchor"), textSection("id-1", "From server")]),
      3,
    ),
    etag: '"9"',
    sequence: 1,
  });
  // id-1 is still in the server document, and it is not the first section.
  expect(state.selectedSectionId).toBe("id-1");
  expect(textAt(state, 0).title).toBe("Anchor");
  expect(textAt(state, 1).title).toBe("From server");
  expect(state.dirty).toBe(false);
  expect(state.localSequence).toBe(1);
  expect(Object.keys(state.draft).sort()).toEqual(["data", "schemaVersion"]);

  const drop = createHarness();
  let dropped = drop.dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("anchor", "Anchor")),
    etag: '"1"',
  });
  dropped = drop.dispatch({ type: "addSection", sectionType: "text" });
  dropped = drop.dispatch({ type: "saveStarted" });
  dropped = drop.dispatch({
    type: "saveAcknowledged",
    configuration: asConfiguration(textDocument("anchor", "Only anchor"), 4),
    etag: '"9"',
    sequence: 1,
  });
  // The selected id was the added section. The server document does not have it.
  expect(dropped.selectedSectionId).toBe("anchor");
  expect(sectionIds(dropped)).toEqual(["anchor"]);
  expect(textAt(dropped, 0).title).toBe("Only anchor");
  expect(dropped.dirty).toBe(false);
  expect(dropped.status).toBe("saved");
  expect(dropped.localSequence).toBe(1);
}

/**
 * Asserts reload can clear the ETag and the selection.
 *
 * Purpose: a missing tag is stored as null, and an empty server document selects nothing.
 * Inputs: none.
 * Side effects: dispatches hydrate, reload, and save commands.
 */
function expectReloadToStoreAMissingEtagAndAnEmptySelection(): void {
  const missingTag = createHarness();
  let state = missingTag.dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Server")),
    etag: '"1"',
  });
  const reloadConfiguration = asConfiguration(textDocument("reloaded-text", "Reloaded"), 4);
  state = missingTag.dispatch({
    type: "reloadFromServer",
    configuration: reloadConfiguration,
    etag: null,
  });
  expect(textAt(state, 0).title).toBe("Reloaded");
  expect(state.baseEtag).toBeNull();
  expect(state.dirty).toBe(false);
  expect(state.status).toBe("idle");
  expect(state.localSequence).toBe(0);
  // The tag is gone, so a save click cannot invent one from revision 4.
  expect(missingTag.dispatch({ type: "saveStarted" })).toBe(state);
  const reloadedSection = reloadConfiguration.data.sections[0];
  if (reloadedSection !== undefined && reloadedSection.type === "text") {
    // The reload payload is not the draft. Changing it leaves the loaded title alone.
    reloadedSection.title = "Mutated reload";
  }
  expect(textAt(state, 0).title).toBe("Reloaded");
  expect(baselineText(state).title).toBe("Reloaded");

  const empty = createHarness();
  empty.dispatch({
    type: "hydrate",
    configuration: asConfiguration(textDocument("text-1", "Server")),
    etag: '"1"',
  });
  const cleared = empty.dispatch({
    type: "reloadFromServer",
    configuration: asConfiguration(documentFromSections([]), 2),
    etag: '"2"',
  });
  expect(cleared.draft.data.sections).toEqual([]);
  expect(cleared.selectedSectionId).toBeNull();
  expect(cleared.baseEtag).toBe('"2"');
  expect(cleared.dirty).toBe(false);
  expect(cleared.savedBaseline?.data.sections).toEqual([]);
}

/**
 * Asserts selecting a section leaves the draft alone.
 *
 * Purpose: the row button changes the inspector target without a document edit.
 * Inputs: none.
 * Side effects: dispatches hydrate and selectSection.
 */
function expectSelectSectionToChangeOnlyTheSelection(): void {
  const { dispatch } = createHarness();
  const loaded = dispatch({
    type: "hydrate",
    configuration: asConfiguration(
      documentFromSections([textSection("text-a", "Alpha"), textSection("text-b", "Beta")]),
    ),
    etag: '"1"',
  });
  const selected = dispatch({ type: "selectSection", sectionId: "text-b" });
  // The second row is selected. The draft object and the baseline stay the ones hydrate stored.
  expect(selected.selectedSectionId).toBe("text-b");
  expect(selected.draft).toBe(loaded.draft);
  expect(selected.savedBaseline).toBe(loaded.savedBaseline);
  expect(selected.dirty).toBe(false);
  expect(selected.localSequence).toBe(0);
  expect(selected.baseEtag).toBe('"1"');
  expect(selected.status).toBe("idle");
  // Selecting the current row, or a missing row, does not allocate a new state object.
  expect(dispatch({ type: "selectSection", sectionId: "text-b" })).toBe(selected);
  expect(dispatch({ type: "selectSection", sectionId: "missing" })).toBe(selected);
}

/**
 * Asserts selecting a section leaves save bookkeeping alone.
 *
 * Purpose: choosing a row is not an edit, a retry, or an acknowledgement.
 * Inputs: none.
 * Side effects: dispatches hydrate, save, and selectSection commands.
 */
function expectSelectSectionToLeaveSaveStateAlone(): void {
  const { dispatch } = createHarness();
  const configuration = asConfiguration(
    documentFromSections([textSection("text-a", "Alpha"), textSection("text-b", "Beta")]),
  );
  const loaded = dispatch({
    type: "hydrate",
    configuration,
    etag: '"1"',
  });
  const saving = dispatch({ type: "saveStarted" });
  const pending = saving.pendingSave;
  const duringSave = dispatch({ type: "selectSection", sectionId: "text-b" });
  // The in-flight save stays recorded. The draft object is still the hydrated one.
  expect(duringSave.selectedSectionId).toBe("text-b");
  expect(duringSave.status).toBe("saving");
  expect(duringSave.pendingSave).toBe(pending);
  expect(duringSave.dirty).toBe(false);
  expect(duringSave.localSequence).toBe(0);
  expect(duringSave.baseEtag).toBe('"1"');
  expect(duringSave.draft).toBe(loaded.draft);

  const failed = dispatch({ type: "saveFailed" });
  const duringError = dispatch({ type: "selectSection", sectionId: "text-a" });
  // A failed save stays failed. Selecting the other row does not clear it.
  expect(duringError.status).toBe("error");
  expect(duringError.pendingSave).toBeNull();
  expect(duringError.selectedSectionId).toBe("text-a");
  expect(duringError.draft).toBe(failed.draft);
  expect(duringError.dirty).toBe(false);

  const conflicted = dispatch({ type: "conflictObserved" });
  const duringConflict = dispatch({ type: "selectSection", sectionId: "text-b" });
  // Conflict keeps the loaded tag. Selection does not adopt a new one.
  expect(duringConflict.status).toBe("conflict");
  expect(duringConflict.baseEtag).toBe('"1"');
  expect(duringConflict.selectedSectionId).toBe("text-b");
  expect(duringConflict.draft).toBe(conflicted.draft);
  expect(duringConflict.dirty).toBe(false);
  expect(duringConflict.localSequence).toBe(0);

  const acknowledged = dispatch({
    type: "saveAcknowledged",
    configuration,
    etag: '"2"',
    sequence: 0,
  });
  const duringSaved = dispatch({ type: "selectSection", sectionId: "text-a" });
  // The matching acknowledgement stays saved. The draft it stored is not copied again.
  expect(acknowledged.status).toBe("saved");
  expect(duringSaved.status).toBe("saved");
  expect(duringSaved.selectedSectionId).toBe("text-a");
  expect(duringSaved.pendingSave).toBeNull();
  expect(duringSaved.dirty).toBe(false);
  expect(duringSaved.localSequence).toBe(0);
  expect(duringSaved.baseEtag).toBe('"2"');
  expect(duringSaved.draft).toBe(acknowledged.draft);
  expect(duringSaved.savedBaseline).toBe(acknowledged.savedBaseline);
}

/**
 * Asserts Add image stops at the carousel ceiling and does not consume another id.
 *
 * Purpose: the 21st slide is refused. The existing slides stay, and the title string is not sliced elsewhere.
 * Inputs: none.
 * Side effects: dispatches add commands.
 */
function expectAddImageToStopAtTheCarouselCeiling(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "carousel" });
  const carouselId = state.selectedSectionId;
  if (carouselId === null) {
    throw new Error("Expected the new carousel to be selected.");
  }
  for (let index = 0; index < LIMITS.maxImagesPerCarousel; index += 1) {
    // Each slide is a new id. The list grows until the shared ceiling.
    state = dispatch({ type: "addImage", sectionId: carouselId });
  }
  const atCap = state;
  expect(requireCarousel(atCap.draft.data.sections[0], "full").images).toHaveLength(LIMITS.maxImagesPerCarousel);
  const blocked = dispatch({ type: "addImage", sectionId: carouselId });
  // The 21st command is a no-op. The full list object stays.
  expect(blocked).toBe(atCap);
  expect(requireCarousel(blocked.draft.data.sections[0], "full").images).toHaveLength(LIMITS.maxImagesPerCarousel);
  const text = dispatch({ type: "addSection", sectionType: "text" });
  // The refused slide did not take the next id. The text section is id-22.
  expect(text.selectedSectionId).toBe("id-22");
}

/**
 * Asserts Add image stops when the document already holds the image ceiling.
 *
 * Purpose: a carousel under 20 slides still cannot add the 101st image in the document.
 * Inputs: none.
 * Side effects: dispatches add commands.
 */
function expectAddImageToStopAtTheDocumentCeiling(): void {
  const { dispatch } = createHarness();
  for (let carousel = 0; carousel < 5; carousel += 1) {
    const state = dispatch({ type: "addSection", sectionType: "carousel" });
    const carouselId = state.selectedSectionId;
    if (carouselId === null) {
      throw new Error("Expected the new carousel to be selected.");
    }
    for (let image = 0; image < LIMITS.maxImagesPerCarousel; image += 1) {
      // Five carousels of 20 slides reach the document ceiling.
      dispatch({ type: "addImage", sectionId: carouselId });
    }
  }
  const extra = dispatch({ type: "addSection", sectionType: "carousel" });
  const extraId = extra.selectedSectionId;
  if (extraId === null) {
    throw new Error("Expected the extra carousel to be selected.");
  }
  const blocked = dispatch({ type: "addImage", sectionId: extraId });
  const extraSection = blocked.draft.data.sections[5];
  // The empty carousel stays empty. The document still has 100 slides.
  expect(blocked).toBe(extra);
  if (extraSection === undefined || extraSection.type !== "carousel") {
    throw new Error("Expected the extra carousel.");
  }
  expect(extraSection.images).toHaveLength(0);
}

/**
 * Asserts Add section stops at the section ceiling.
 *
 * Purpose: the 101st section is refused and the existing rows stay.
 * Inputs: none.
 * Side effects: dispatches add commands.
 */
function expectAddSectionToStopAtTheSectionCeiling(): void {
  const { dispatch } = createHarness();
  let state = dispatch({ type: "addSection", sectionType: "text" });
  for (let index = 1; index < LIMITS.maxSections; index += 1) {
    // Each add selects the new row. The list grows until the shared ceiling.
    state = dispatch({ type: "addSection", sectionType: "text" });
  }
  const atCap = state;
  expect(atCap.draft.data.sections).toHaveLength(LIMITS.maxSections);
  const blocked = dispatch({ type: "addSection", sectionType: "text" });
  // The 101st command is a no-op. The selected row stays the last accepted section.
  expect(blocked).toBe(atCap);
  expect(blocked.selectedSectionId).toBe(`id-${LIMITS.maxSections}`);
}

/**
 * Asserts an over-long title is stored whole.
 *
 * Purpose: the reducer does not slice a string that is past the title ceiling.
 * Inputs: none.
 * Side effects: dispatches add and update commands.
 */
function expectAnOverlongTitleToStayWhole(): void {
  const { dispatch } = createHarness();
  const added = dispatch({ type: "addSection", sectionType: "text" });
  const current = added.draft.data.sections[0];
  if (current === undefined || current.type !== "text") {
    throw new Error("Expected a text section.");
  }
  const longTitle = "T".repeat(LIMITS.maxTitleCharacters + 1);
  const updated = dispatch({
    type: "updateSection",
    sectionId: current.id,
    section: {
      id: current.id,
      type: "text",
      title: longTitle,
      description: current.description,
      titleColor: current.titleColor,
      descriptionColor: current.descriptionColor,
    },
  });
  const title = updated.draft.data.sections[0];
  // The draft holds every typed character. Validation can reject it later.
  if (title === undefined || title.type !== "text") {
    throw new Error("Expected the updated text section.");
  }
  expect(title.title).toBe(longTitle);
  expect(title.title).toHaveLength(LIMITS.maxTitleCharacters + 1);
  expect(title.description).toBe(current.description);
}

/**
 * Registers the reducer cases.
 *
 * Purpose: each case names one behavior from the editor command list.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerReducerCases(): void {
  // Ids, field edits, order, images, import, save, hydrate, and validation.
  it("gives two sections of the same type different ids", expectTwoSectionsOfTheSameTypeToDiffer);
  it("keeps a text title edit on the first text section", expectTextTitleUpdateToLeaveTheOtherTextAlone);
  it("edits text, CTA, and carousel sections independently", expectEachSectionTypeToKeepItsOwnFields);
  it("keeps carousel image URLs with their section ids when moved", expectMovingTheSecondCarouselToKeepItsImages);
  it("ignores move up on the first section and move down on the last", expectMoveAtTheEndsToDoNothing);
  it("selects the next neighbor when the selected middle section is removed", expectRemovingTheSelectedMiddleSectionToSelectANeighbor);
  it("leaves an empty image list on the carousel", expectRemovingTheLastImageToLeaveTheCarousel);
  it("imports a document without changing the previous ETag", expectImportToKeepThePreviousEtag);
  it("keeps a newer draft when an older save is acknowledged", expectStaleSaveAcknowledgementToKeepTheNewerDraft);
  it("replaces the draft when the acknowledged sequence matches", expectMatchingSaveAcknowledgementToReplaceTheDraft);
  it("ignores hydrate once the editor is loaded or dirty", expectHydrateToIgnoreADirtyDraft);
  it("keeps an invalid color in the draft when validation fails", expectInvalidColorToStayInTheDraft);
  it("normalizes a valid color on the validation result only", expectValidColorToNormalizeWithoutChangingTheDraft);
  it("reports duplicate section ids without changing the draft", expectDuplicateSectionIdsToFailValidation);
  it("keeps the draft when save fails or a conflict is observed", expectSaveFailureAndConflictToKeepTheDraft);
  it("reloads the server document and ignores a late acknowledgement", expectReloadToReplaceTheDraft);
  it("ignores commands that do not address an editable row", expectUnknownTargetsToLeaveTheEditorUnchanged);
  it("keeps the selection when a different section is removed", expectRemovingAnUnselectedSectionToKeepTheSelection);
  it("leaves later copies when one duplicate section id is removed", expectRemovingOneDuplicateSectionIdToLeaveTheLaterCopy);
  it("moves a section down without changing the selection", expectMoveDownToKeepTheOtherSectionsAndTheSelection);
  it("places a section at a new index in one edit", expectPlacingASectionToMoveItOnce);
  it("selects a section without editing the draft", expectSelectSectionToChangeOnlyTheSelection);
  it("keeps save state when a section is selected", expectSelectSectionToLeaveSaveStateAlone);
  it("keeps an image edit on that slide and that carousel", expectImageEditsToStayOnOneSlide);
  it("leaves later slides when one duplicate image id is removed", expectDuplicateImageIdsToStayUntilEachCopyIsAddressed);
  it("keeps an imported draft when the in-flight save is acknowledged", expectImportDuringSaveToKeepTheImportedDraft);
  it("selects the first imported section", expectImportToSelectTheFirstSection);
  it("ignores an acknowledgement for a sequence the editor has not reached", expectAFutureAcknowledgementToLeaveTheEditorUnchanged);
  it("keeps the in-flight save when a conflict is observed", expectConflictToKeepTheInFlightSave);
  it("records the newer sequence when a failed save is retried", expectRetryAfterFailureToRecordTheNewerSequence);
  it("stores the loaded ETag instead of the revision", expectHydrateToStoreTheEtagRatherThanTheRevision);
  it("normalizes each color field only on the validation result", expectValidationToNormalizeEachColorWithoutChangingTheDraft);
  it("keeps or clears the selection when a matching save is acknowledged", expectMatchingAcknowledgementToFollowTheSelectedSection);
  it("stores a missing reload ETag and an empty selection", expectReloadToStoreAMissingEtagAndAnEmptySelection);
  it("refuses a 21st image in one carousel", expectAddImageToStopAtTheCarouselCeiling);
  it("refuses an image past the document ceiling", expectAddImageToStopAtTheDocumentCeiling);
  it("refuses a section past the section ceiling", expectAddSectionToStopAtTheSectionCeiling);
  it("keeps an over-long title without slicing it", expectAnOverlongTitleToStayWhole);
}

/**
 * Registers the provider cases.
 *
 * Purpose: the contexts can be rendered without a polished editor page.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerProviderCases(): void {
  // The shell tests mount the page. These cases only mount the provider.
  it("renders the initial editor through context", expectProviderToExposeStateAndDispatch);
  it("throws when the editor hooks are used outside the provider", expectHooksOutsideTheProviderToThrow);
}

describe("editor reducer", registerReducerCases);
describe("editor provider", registerProviderCases);
