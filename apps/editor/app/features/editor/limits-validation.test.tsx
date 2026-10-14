// @vitest-environment happy-dom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ALT_LIMIT_MESSAGE,
  CAROUSEL_IMAGE_LIMIT_MESSAGE,
  CTA_LABEL_LIMIT_MESSAGE,
  DESCRIPTION_LIMIT_MESSAGE,
  DOCUMENT_IMAGE_LIMIT_MESSAGE,
  LIMITS,
  SECTION_LIMIT_MESSAGE,
  SUPPORTED_SCHEMA_VERSION,
  TITLE_LIMIT_MESSAGE,
  URL_LIMIT_MESSAGE,
  configurationSchema,
  type Configuration,
  type Section,
} from "@reactiv/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LABEL_REQUIRED_ERROR } from "../sections/cta-fields.js";
import { EMPTY_CAROUSEL_MESSAGE, IMAGE_URL_ERROR } from "../sections/carousel-fields.js";
import { TITLE_COLOR_ERROR } from "../sections/text-contrast.js";
import { EditorProvider } from "./editor-context.js";
import { EMPTY_EDITOR_MESSAGE, EMPTY_PREVIEW_MESSAGE, EditorShell } from "./editor-shell.js";
import { EXPORT_BLOCKED_MESSAGE, jsonFileDownload } from "./json-export.js";

/** User-event session used by the limit cases. */
type EditorUser = ReturnType<typeof userEvent.setup>;

/**
 * Builds a text section.
 *
 * Purpose: fixtures can choose a title, a description, and valid colors.
 * Inputs: id, the section id. title, the title string. description, the body string.
 * Side effects: none.
 */
function textSection(id: string, title: string, description: string): Section {
  // The colors are valid so the configuration schema can hydrate the provider.
  return {
    id,
    type: "text",
    title,
    description,
    titleColor: "#112233",
    descriptionColor: "#334455",
  };
}

/**
 * Builds a CTA section.
 *
 * Purpose: the label and link can be changed after the shell mounts.
 * Inputs: id, the section id. label, the button label. url, the destination.
 * Side effects: none.
 */
function ctaSection(id: string, label: string, url: string): Section {
  // Both colors are valid. The label and the link are the fields these cases edit.
  return {
    id,
    type: "cta",
    label,
    url,
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  };
}

/**
 * Builds a carousel section.
 *
 * Purpose: image-limit cases can choose how many valid slides to start with.
 * Inputs: id, the section id. images, the slides. aspectRatio, the stored name.
 * Side effects: none.
 */
function carouselSection(
  id: string,
  images: { id: string; url: string; alt: string }[],
  aspectRatio: "portrait" | "landscape" | "square" = "square",
): Section {
  // Each address is absolute http(s) unless a later edit clears it.
  return {
    id,
    type: "carousel",
    aspectRatio,
    images,
  };
}

/**
 * Wraps fixture sections in a configuration.
 *
 * Purpose: the provider hydrates from the loader shape without a network call.
 * Inputs: sections, the ordered sections.
 * Side effects: none. Throws when the sections are not a valid configuration.
 */
function limitConfiguration(sections: Section[]): Configuration {
  // id, revision, and updatedAt are service-owned fields the hydrate command expects.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: "cfg_limits",
    revision: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Renders the shell with a fixture document.
 *
 * Purpose: Save can enable once the draft is dirty and valid. This does not call fetch.
 * Inputs: sections, the ordered sections.
 * Side effects: mounts the provider and the shell.
 */
function renderEditor(sections: Section[]): ReturnType<typeof render> {
  const configuration = limitConfiguration(sections);
  // The etag is present so a valid dirty draft can enable Save.
  return render(
    <EditorProvider initialConfiguration={configuration} initialEtag={'"1"'}>
      <EditorShell title="Editor" />
    </EditorProvider>,
  );
}

/**
 * Reads one phone block.
 *
 * Purpose: assertions can tell two sections apart.
 * Inputs: sectionId, the draft id.
 * Side effects: none. Throws when that block is missing.
 */
function previewBlock(sectionId: string): HTMLElement {
  const block = document.querySelector(`[data-section-id="${sectionId}"]`);
  if (!(block instanceof HTMLElement)) {
    throw new Error(`Missing preview for ${sectionId}.`);
  }
  return block;
}

/**
 * Reads the preview title element.
 *
 * Purpose: a color or title edit can be checked without opening the other inspector.
 * Inputs: sectionId, the draft id.
 * Side effects: none. Throws when the title element is missing.
 */
function previewTitle(sectionId: string): HTMLElement {
  const title = previewBlock(sectionId).querySelector(".preview-text-title");
  if (!(title instanceof HTMLElement)) {
    throw new Error(`Missing preview title for ${sectionId}.`);
  }
  return title;
}

/**
 * Reads the preview description element.
 *
 * Purpose: an edit in one section can be checked against the other section's body.
 * Inputs: sectionId, the draft id.
 * Side effects: none. Throws when the description element is missing.
 */
function previewDescription(sectionId: string): HTMLElement {
  const description = previewBlock(sectionId).querySelector(".preview-text-description");
  if (!(description instanceof HTMLElement)) {
    throw new Error(`Missing preview description for ${sectionId}.`);
  }
  return description;
}

/**
 * Replaces a control with a pasted string.
 *
 * Purpose: a long value is not typed one character at a time, and it is not shortened first.
 * Inputs: user, the user-event session. field, the control. value, the replacement string.
 * Side effects: clears the control and pastes the value.
 */
async function replaceField(user: EditorUser, field: HTMLElement, value: string): Promise<void> {
  // Clear removes the fixture text. Paste then writes the whole replacement.
  await user.clear(field);
  await user.click(field);
  await user.paste(value);
}

/**
 * Deletes the last character of a control.
 *
 * Purpose: the author can remove the one character that crossed a ceiling.
 * Inputs: user, the user-event session. field, the control that holds the long string.
 * Side effects: moves the cursor to the end and sends Backspace.
 */
async function deleteLastCharacter(user: EditorUser, field: HTMLElement): Promise<void> {
  await user.click(field);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    // The cursor is at the end, so Backspace removes the extra character.
    field.setSelectionRange(field.value.length, field.value.length);
  }
  await user.keyboard("{End}{Backspace}");
}

/**
 * Unmounts the shell after each case.
 *
 * Purpose: the next case does not see the previous document.
 * Inputs: none.
 * Side effects: unmounts React and restores mocks.
 */
function cleanupLimitCase(): void {
  cleanup();
  vi.restoreAllMocks();
}

afterEach(cleanupLimitCase);

/**
 * Asserts a bad color names that field and leaves the other section's title.
 *
 * Purpose: clearing the color removes the error, and completing it removes it as well.
 * Inputs: none.
 * Side effects: renders the shell and edits the title color.
 */
async function expectABadColorToNameTheFieldAndKeepTheOtherTitle(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("alpha", "Alpha", "Alpha body"),
    textSection("beta", "Beta", "Beta body"),
  ]);
  const titleColor = screen.getByLabelText("Title color");
  await replaceField(user, titleColor, "nope");
  // The error names the title color. Alpha's title and Beta's title both stay.
  expect(screen.getByRole("textbox", { name: "Title color", description: TITLE_COLOR_ERROR })).toBeTruthy();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Alpha");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Alpha body");
  expect(previewTitle("beta").textContent).toBe("Beta");
  expect(previewDescription("beta").textContent).toBe("Beta body");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  await user.clear(titleColor);
  // An empty color is unfinished. The field error is gone, and Beta is still Beta.
  expect(titleColor).toHaveProperty("value", "");
  expect(titleColor.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
  expect(previewTitle("beta").textContent).toBe("Beta");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  await user.type(titleColor, "#abc");
  // #abc is a complete color. The error stays gone, Save can run, and Beta is unchanged.
  expect(titleColor).toHaveProperty("value", "#abc");
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
  expect(previewTitle("alpha").textContent).toBe("Alpha");
  expect(previewTitle("beta").textContent).toBe("Beta");
  expect(previewDescription("beta").textContent).toBe("Beta body");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
}

/**
 * Asserts a title past the ceiling blocks Save and keeps the other description.
 *
 * Purpose: the extra character stays in the field until the author deletes it.
 * Inputs: none.
 * Side effects: renders the shell, pastes the title, exports, and deletes one character.
 */
async function expectAnOverlongTitleToBlockSaveUntilOneCharacterIsDeleted(): Promise<void> {
  const user = userEvent.setup();
  const download = vi.spyOn(jsonFileDownload, "save").mockImplementation(() => {
    // A blocked export must not reach the download helper.
  });
  renderEditor([
    textSection("alpha", "Alpha", "Alpha body"),
    textSection("beta", "Beta", "Beta body"),
  ]);
  const longTitle = "T".repeat(LIMITS.maxTitleCharacters + 1);
  const title = screen.getByLabelText("Title");
  await replaceField(user, title, longTitle);
  // The pasted title is whole. The ceiling sentence names Title, and Save stays off.
  expect(title.getAttribute("maxlength")).toBeNull();
  expect(title).toHaveProperty("value", longTitle);
  expect(screen.getByRole("textbox", { name: "Title", description: TITLE_LIMIT_MESSAGE })).toBeTruthy();
  expect(screen.getByText(TITLE_LIMIT_MESSAGE).textContent).toBe("Title must be 200 characters or fewer.");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Alpha body");
  expect(previewDescription("beta").textContent).toBe("Beta body");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  // Export does not download the over-long draft. Beta's body is still in its own field.
  expect(download).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toBe(EXPORT_BLOCKED_MESSAGE);
  await user.click(screen.getByRole("button", { name: "Select Text, Beta" }));
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Beta body");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Beta");
  await user.click(screen.getByRole("button", { name: `Select Text, ${longTitle}` }));
  const restored = screen.getByLabelText("Title");
  await deleteLastCharacter(user, restored);
  const accepted = "T".repeat(LIMITS.maxTitleCharacters);
  // One character under the ceiling clears the error and lets Save run. Beta stays.
  expect(restored).toHaveProperty("value", accepted);
  expect(screen.queryByText(TITLE_LIMIT_MESSAGE)).toBeNull();
  expect(previewDescription("beta").textContent).toBe("Beta body");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
}

/**
 * Asserts a description past the ceiling names that field.
 *
 * Purpose: the description string stays whole, and the title beside it stays.
 * Inputs: none.
 * Side effects: renders the shell and pastes the description.
 */
async function expectAnOverlongDescriptionToNameTheField(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("alpha", "Alpha", "Alpha body"), textSection("beta", "Beta", "Beta body")]);
  const longDescription = "D".repeat(LIMITS.maxDescriptionCharacters + 1);
  const description = screen.getByLabelText("Description");
  await replaceField(user, description, longDescription);
  // The textarea has no max length. The schema sentence names Description.
  expect(description.getAttribute("maxlength")).toBeNull();
  expect(description).toHaveProperty("value", longDescription);
  expect(screen.getByRole("textbox", { name: "Description", description: DESCRIPTION_LIMIT_MESSAGE })).toBeTruthy();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Alpha");
  expect(previewDescription("beta").textContent).toBe("Beta body");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
}

/**
 * Asserts a blank CTA label disables Save and names the label.
 *
 * Purpose: the other section's title stays while the label is blank.
 * Inputs: none.
 * Side effects: renders the shell and clears the label.
 */
async function expectABlankCtaLabelToDisableSaveAndNameTheField(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("copy", "Kept title", "Kept body"),
    ctaSection("go", "Shop", "https://example.com/shop"),
  ]);
  await user.click(screen.getByRole("button", { name: "Select Button, Shop" }));
  const label = screen.getByLabelText("Label");
  await user.clear(label);
  // The label error names the field. Save stays off, and the text section stays.
  expect(label).toHaveProperty("value", "");
  expect(screen.getByRole("textbox", { name: "Label", description: LABEL_REQUIRED_ERROR })).toBeTruthy();
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/shop");
  expect(previewTitle("copy").textContent).toBe("Kept title");
  expect(previewDescription("copy").textContent).toBe("Kept body");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  await user.click(screen.getByRole("button", { name: "Select Text, Kept title" }));
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kept title");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Kept body");
}

/**
 * Asserts a CTA label past the ceiling names that field.
 *
 * Purpose: deleting the extra character allows Save, and the link stays.
 * Inputs: none.
 * Side effects: renders the shell, pastes the label, and deletes one character.
 */
async function expectAnOverlongCtaLabelToNameTheField(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([ctaSection("go", "Shop", "https://example.com/shop")]);
  const longLabel = "L".repeat(LIMITS.maxCtaLabelCharacters + 1);
  const label = screen.getByLabelText("Label");
  await replaceField(user, label, longLabel);
  // The schema sentence names the ceiling. The link is untouched, and Save stays off.
  expect(label.getAttribute("maxlength")).toBeNull();
  expect(label).toHaveProperty("value", longLabel);
  expect(screen.getByRole("textbox", { name: "Label", description: CTA_LABEL_LIMIT_MESSAGE })).toBeTruthy();
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/shop");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  await deleteLastCharacter(user, label);
  // A label at the ceiling is valid. Save can run.
  expect(label).toHaveProperty("value", "L".repeat(LIMITS.maxCtaLabelCharacters));
  expect(screen.queryByText(CTA_LABEL_LIMIT_MESSAGE)).toBeNull();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
}

/**
 * Asserts empty optional text can be saved.
 *
 * Purpose: clearing the title and the description does not throw, and the other section stays.
 * Inputs: none.
 * Side effects: renders the shell and clears both text fields.
 */
async function expectAnEmptyTitleAndDescriptionToAllowSave(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("alpha", "Alpha", "Alpha body"),
    textSection("beta", "Beta", "Beta body"),
  ]);
  await user.clear(screen.getByLabelText("Title"));
  await user.clear(screen.getByLabelText("Description"));
  // Both fields are empty. Save is allowed, and Beta's body is still Beta's body.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "");
  expect(previewTitle("alpha").textContent).toBe("");
  expect(previewDescription("alpha").textContent).toBe("");
  expect(previewTitle("beta").textContent).toBe("Beta");
  expect(previewDescription("beta").textContent).toBe("Beta body");
  expect(screen.queryByText(TITLE_LIMIT_MESSAGE)).toBeNull();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
}

/**
 * Asserts an empty carousel can be saved and still shows its empty state.
 *
 * Purpose: removing the last slide does not throw, and Add image stays available.
 * Inputs: none.
 * Side effects: renders the shell and removes the only slide.
 */
async function expectAnEmptyCarouselToAllowSave(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", [{ id: "only", url: "https://example.com/only.jpg", alt: "Only slide" }]),
  ]);
  await user.click(screen.getByRole("button", { name: "Remove image 1" }));
  const preview = previewBlock("slides");
  // The empty state is the prompt 15 sentence. Save is allowed because the list may be empty.
  expect(within(preview).getByText(EMPTY_CAROUSEL_MESSAGE)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add image" })).toHaveProperty("disabled", false);
  expect(screen.queryByText(CAROUSEL_IMAGE_LIMIT_MESSAGE)).toBeNull();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
}

/**
 * Asserts an empty image URL cannot be saved.
 *
 * Purpose: clearing the address does not throw, and the alt text stays.
 * Inputs: none.
 * Side effects: renders the shell and clears the image URL.
 */
async function expectAnEmptyImageUrlToBlockSave(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", [{ id: "only", url: "https://example.com/only.jpg", alt: "Only slide" }]),
    textSection("copy", "Kept title", "Kept body"),
  ]);
  const url = screen.getByLabelText("Image URL");
  await user.clear(url);
  // The empty address is kept. Save stays off, and the text section stays.
  expect(url).toHaveProperty("value", "");
  expect(url.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(IMAGE_URL_ERROR)).toBeNull();
  expect(screen.getByLabelText("Alt text")).toHaveProperty("value", "Only slide");
  expect(previewTitle("copy").textContent).toBe("Kept title");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
}

/**
 * Asserts an empty section list can be saved.
 *
 * Purpose: removing the last section shows the empty states and does not throw.
 * Inputs: none.
 * Side effects: renders the shell and removes the only section.
 */
async function expectAnEmptySectionListToAllowSave(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("only", "Only title", "Only body")]);
  await user.click(screen.getByRole("button", { name: "Remove Text, Only title" }));
  // Both empty states are visible. Save is allowed because a document may have no sections.
  expect(screen.getByText(EMPTY_EDITOR_MESSAGE)).toBeTruthy();
  expect(screen.getByText(EMPTY_PREVIEW_MESSAGE)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
}

/**
 * Asserts alt text past the ceiling names that field.
 *
 * Purpose: the address beside the alt text stays, and the alt string is not sliced.
 * Inputs: none.
 * Side effects: renders the shell and pastes the alt text.
 */
async function expectAnOverlongAltToNameTheField(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", [{ id: "only", url: "https://example.com/only.jpg", alt: "Only slide" }]),
  ]);
  const longAlt = "A".repeat(LIMITS.maxAltCharacters + 1);
  const alt = screen.getByLabelText("Alt text");
  await replaceField(user, alt, longAlt);
  // The schema sentence names Alt text. The address is untouched, and Save stays off.
  expect(alt.getAttribute("maxlength")).toBeNull();
  expect(alt).toHaveProperty("value", longAlt);
  expect(screen.getByRole("textbox", { name: "Alt text", description: ALT_LIMIT_MESSAGE })).toBeTruthy();
  expect(screen.getByLabelText("Image URL")).toHaveProperty("value", "https://example.com/only.jpg");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
}

/**
 * Asserts a URL past the ceiling names that field with the length sentence.
 *
 * Purpose: the over-long address stays typed, and the alt text stays.
 * Inputs: none.
 * Side effects: renders the shell and pastes the address.
 */
async function expectAnOverlongImageUrlToNameTheField(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", [{ id: "only", url: "https://example.com/only.jpg", alt: "Only slide" }]),
  ]);
  const longUrl = `https://example.com/${"a".repeat(LIMITS.maxUrlCharacters)}`;
  const url = screen.getByLabelText("Image URL");
  await replaceField(user, url, longUrl);
  // The length sentence replaces the generic URL sentence. The alt text stays.
  expect(url).toHaveProperty("value", longUrl);
  expect(screen.getByRole("textbox", { name: "Image URL", description: URL_LIMIT_MESSAGE })).toBeTruthy();
  expect(screen.queryByText(IMAGE_URL_ERROR)).toBeNull();
  expect(screen.getByLabelText("Alt text")).toHaveProperty("value", "Only slide");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
}

/**
 * Builds one full carousel.
 *
 * Purpose: the 20-slide and 100-slide cases share one slide shape.
 * Inputs: id, the carousel id. label, the first slide's alt text, used as the row hint.
 * Side effects: none.
 */
function fullCarousel(id: string, label: string): Section {
  const images = [];
  for (let index = 0; index < LIMITS.maxImagesPerCarousel; index += 1) {
    // The first alt text is the row hint. Later slides can be blank.
    images.push({
      id: `${id}-${index}`,
      url: "https://example.com/slide.jpg",
      alt: index === 0 ? label : "",
    });
  }
  return carouselSection(id, images);
}

/**
 * Asserts Add image stops at 20 slides and explains why.
 *
 * Purpose: the click does not append a 21st slide. Removing one slide allows another.
 * Inputs: none.
 * Side effects: renders the shell, clicks Add image, and removes one slide.
 */
async function expectAddImageToStopAtTwenty(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([fullCarousel("slides", "Full carousel")]);
  const add = screen.getByRole("button", { name: "Add image" });
  // The button is off, and the sentence is the carousel ceiling.
  expect(add).toHaveProperty("disabled", true);
  expect(screen.getByText(CAROUSEL_IMAGE_LIMIT_MESSAGE)).toBeTruthy();
  expect(screen.getAllByLabelText("Image URL")).toHaveLength(LIMITS.maxImagesPerCarousel);
  await user.click(add);
  // A click on the disabled button does not add a slide.
  expect(screen.getAllByLabelText("Image URL")).toHaveLength(LIMITS.maxImagesPerCarousel);
  await user.click(screen.getByRole("button", { name: "Remove image 1" }));
  const reopened = screen.getByRole("button", { name: "Add image" });
  // One free slot enables the button and removes the ceiling sentence.
  expect(reopened).toHaveProperty("disabled", false);
  expect(screen.queryByText(CAROUSEL_IMAGE_LIMIT_MESSAGE)).toBeNull();
  await user.click(reopened);
  expect(screen.getAllByLabelText("Image URL")).toHaveLength(LIMITS.maxImagesPerCarousel);
  expect(screen.getByRole("button", { name: "Add image" })).toHaveProperty("disabled", true);
}

/**
 * Asserts Add image stops when the document already holds 100 slides.
 *
 * Purpose: an empty carousel still cannot add the 101st image, and a ratio edit can be saved.
 * Inputs: none.
 * Side effects: renders the shell, selects the empty carousel, and changes its ratio.
 */
async function expectAddImageToStopAtTheDocumentCeiling(): Promise<void> {
  const user = userEvent.setup();
  const sections = [
    fullCarousel("group-0", "Group 0"),
    fullCarousel("group-1", "Group 1"),
    fullCarousel("group-2", "Group 2"),
    fullCarousel("group-3", "Group 3"),
    fullCarousel("group-4", "Group 4"),
    carouselSection("extra", []),
  ];
  renderEditor(sections);
  await user.click(screen.getByRole("button", { name: "Select Carousel, Empty carousel" }));
  const add = screen.getByRole("button", { name: "Add image" });
  // This carousel is empty. The document ceiling is the reason Add image is off.
  expect(add).toHaveProperty("disabled", true);
  expect(screen.getByText(DOCUMENT_IMAGE_LIMIT_MESSAGE)).toBeTruthy();
  expect(screen.queryByText(CAROUSEL_IMAGE_LIMIT_MESSAGE)).toBeNull();
  await user.click(add);
  expect(screen.queryAllByLabelText("Image URL")).toHaveLength(0);
  await user.click(screen.getByRole("radio", { name: "Landscape" }));
  // The ratio edit is valid. Save can run while Add image stays off.
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Add image" })).toHaveProperty("disabled", true);
}

/**
 * Asserts the add-section buttons stop at 100 sections.
 *
 * Purpose: the click does not append a 101st section. Removing one section allows another.
 * Inputs: none.
 * Side effects: renders the shell, clicks Add text, and removes one section.
 */
async function expectAddSectionToStopAtOneHundred(): Promise<void> {
  const user = userEvent.setup();
  const sections = [];
  for (let index = 0; index < LIMITS.maxSections; index += 1) {
    // The title is the row hint, so Remove can name Row 0.
    sections.push(textSection(`text-${index}`, `Row ${index}`, ""));
  }
  renderEditor(sections);
  const add = screen.getByRole("button", { name: "Add text" });
  // Every add control is off, and the sentence is the section ceiling.
  expect(add).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Add carousel" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "Add button" })).toHaveProperty("disabled", true);
  expect(screen.getByText(SECTION_LIMIT_MESSAGE)).toBeTruthy();
  await user.click(add);
  expect(document.querySelectorAll(".section-row")).toHaveLength(LIMITS.maxSections);
  await user.click(screen.getByRole("button", { name: "Remove Text, Row 0" }));
  const reopened = screen.getByRole("button", { name: "Add text" });
  // One free slot enables Add text and removes the ceiling sentence.
  expect(reopened).toHaveProperty("disabled", false);
  expect(screen.queryByText(SECTION_LIMIT_MESSAGE)).toBeNull();
  await user.click(reopened);
  expect(document.querySelectorAll(".section-row")).toHaveLength(LIMITS.maxSections);
  expect(screen.getByRole("button", { name: "Add text" })).toHaveProperty("disabled", true);
}

/**
 * Registers the limit and inline-validation cases.
 *
 * Purpose: F12 and the editor half of R07 have one component-test list.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerLimitValidationCases(): void {
  it("names a bad color and keeps the other section title", expectABadColorToNameTheFieldAndKeepTheOtherTitle);
  it("blocks save for a 201-character title until one character is deleted", expectAnOverlongTitleToBlockSaveUntilOneCharacterIsDeleted);
  it("names a description past the ceiling", expectAnOverlongDescriptionToNameTheField);
  it("disables save for a blank CTA label and names the field", expectABlankCtaLabelToDisableSaveAndNameTheField);
  it("names a CTA label past the ceiling", expectAnOverlongCtaLabelToNameTheField);
  it("allows save for an empty title and an empty description", expectAnEmptyTitleAndDescriptionToAllowSave);
  it("allows save for an empty carousel and shows the empty state", expectAnEmptyCarouselToAllowSave);
  it("blocks save for an empty image URL", expectAnEmptyImageUrlToBlockSave);
  it("allows save for an empty section list", expectAnEmptySectionListToAllowSave);
  it("names alt text past the ceiling", expectAnOverlongAltToNameTheField);
  it("names an image URL past the ceiling", expectAnOverlongImageUrlToNameTheField);
  it("stops Add image at 20 slides and explains why", expectAddImageToStopAtTwenty);
  it("stops Add image at 100 slides in the document", expectAddImageToStopAtTheDocumentCeiling);
  it("stops Add section at 100 sections", expectAddSectionToStopAtOneHundred);
}

describe("limits and inline validation", registerLimitValidationCases);
