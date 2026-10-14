// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configurationSchema, SUPPORTED_SCHEMA_VERSION, type Configuration, type Section } from "@reactiv/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorShell } from "../editor/editor-shell.js";
import { EditorProvider } from "../editor/editor-context.js";
import type { DraftTextSection } from "../editor/draft-document.js";
import { sectionUiRegistry } from "./section-ui-registry.js";
import {
  DESCRIPTION_COLOR_ERROR,
  TITLE_COLOR_ERROR,
} from "./text-contrast.js";
import { TextInspector } from "./text-inspector.js";
import { TextPreview } from "./text-preview.js";

/**
 * Builds a text section for a fixture.
 *
 * Purpose: each test can choose its own copy and colors.
 * Inputs: id, the section id. title, the title string. description, the body string.
 * titleColor and descriptionColor, schema hex colors.
 * Side effects: none.
 */
function textSection(
  id: string,
  title: string,
  description: string,
  titleColor = "#112233",
  descriptionColor = "#334455",
): Section {
  // The colors are valid so the configuration schema can hydrate the provider.
  return {
    id,
    type: "text",
    title,
    description,
    titleColor,
    descriptionColor,
  };
}

/**
 * Wraps fixture sections in a configuration.
 *
 * Purpose: the provider hydrates from the same shape the loader returns, without a network call.
 * Inputs: sections, the ordered sections.
 * Side effects: none. Throws when the sections are not a valid configuration.
 */
function textConfiguration(sections: Section[]): Configuration {
  // id, revision, and updatedAt are service-owned fields the hydrate command expects.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: "cfg_text",
    revision: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Renders the shell with a fixture document.
 *
 * Purpose: the inspector and the phone read one hydrated draft. This does not call fetch.
 * Inputs: sections, the ordered sections.
 * Side effects: mounts the provider and the shell.
 */
function renderEditor(sections: Section[]): ReturnType<typeof render> {
  const configuration = textConfiguration(sections);
  // The provider copies the fixture into the draft once. The shell does not load it again.
  return render(
    <EditorProvider initialConfiguration={configuration} initialEtag={'"1"'}>
      <EditorShell title="Editor" />
    </EditorProvider>,
  );
}

/**
 * Reads one phone block.
 *
 * Purpose: assertions can tell two text sections apart.
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
 * Purpose: title assertions stay on that section's text node.
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
 * Purpose: line-break assertions stay on that section's description.
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
 * Reads a painted color as lowercase #rrggbb.
 *
 * Purpose: happy-dom may report the style as hex or as rgb().
 * Inputs: element, the preview title or description.
 * Side effects: none.
 */
function paintColor(element: HTMLElement): string {
  // Drop spaces so rgb(1, 2, 3) and rgb(1,2,3) share one pattern.
  const color = element.style.color.replaceAll(" ", "").toLowerCase();
  const match = /^rgb\((\d+),(\d+),(\d+)\)$/.exec(color);
  if (match === null) {
    return color;
  }
  const red = match[1];
  const green = match[2];
  const blue = match[3];
  if (red === undefined || green === undefined || blue === undefined) {
    return color;
  }
  // Each channel becomes two hex digits so the result matches the normalized draft color.
  const channels = [red, green, blue].map((channel) => Number.parseInt(channel, 10).toString(16).padStart(2, "0"));
  return `#${channels.join("")}`;
}

/**
 * Asserts typing a title updates the preview and does not fetch.
 *
 * Purpose: the draft is the preview source. A title edit does not call the network.
 * Inputs: none.
 * Side effects: renders the shell and types into the title.
 */
async function expectTypingTheTitleToUpdateThePreviewWithoutAFetch(): Promise<void> {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  try {
    renderEditor([textSection("live", "Before", "Body")]);
    const title = screen.getByLabelText("Title");
    await user.clear(title);
    await user.type(title, "After typing");
    // The preview text is the draft title. The request spy stays idle.
    expect(title.tagName).toBe("INPUT");
    expect(title).toHaveProperty("value", "After typing");
    expect(previewTitle("live").textContent).toBe("After typing");
    expect(screen.getByLabelText("Description")).toHaveProperty("value", "Body");
    expect(previewDescription("live").textContent).toBe("Body");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
}

/**
 * Asserts a multiline description keeps its newline.
 *
 * Purpose: the preview shows the textarea value, including the line break.
 * Inputs: none.
 * Side effects: renders the shell and types a newline into the description.
 */
async function expectAMultilineDescriptionToKeepItsNewline(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("lines", "Title", "")]);
  const description = screen.getByLabelText("Description");
  await user.type(description, "Line one{Enter}Line two");
  const body = previewDescription("lines");
  // The draft value and the preview text both contain the newline, and the line can wrap.
  expect(description.tagName).toBe("TEXTAREA");
  expect(description).toHaveProperty("value", "Line one\nLine two");
  expect(body.textContent).toBe("Line one\nLine two");
  expect(body.style.whiteSpace).toBe("pre-wrap");
  expect(body.style.overflowWrap).toBe("anywhere");
  expect(previewTitle("lines").textContent).toBe("Title");
  expect(previewTitle("lines").style.overflowWrap).toBe("anywhere");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Title");
}

/**
 * Asserts markup in a title is visible text and not an element.
 *
 * Purpose: the preview uses a React text node, so an image tag cannot run.
 * Inputs: none.
 * Side effects: renders the shell and types the markup into the title.
 */
async function expectMarkupInTheTitleToStayText(): Promise<void> {
  const user = userEvent.setup();
  const markup = "<img src=x onerror=alert(1)>";
  renderEditor([textSection("html", "Before", "Body")]);
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, markup);
  const preview = previewTitle("html");
  const phone = document.querySelector(".phone-screen");
  // The characters are the text. The phone does not gain an image or a script.
  expect(title).toHaveProperty("value", markup);
  expect(preview.textContent).toBe(markup);
  expect(preview.childNodes).toHaveLength(1);
  expect(preview.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
  expect(preview.querySelector("img")).toBeNull();
  expect(phone?.querySelector("img")).toBeNull();
  expect(phone?.querySelector("script")).toBeNull();
}

/**
 * Asserts a title color edit leaves the description color alone.
 *
 * Purpose: the two color fields are independent on the same section.
 * Inputs: none.
 * Side effects: renders the shell and replaces the title color.
 */
async function expectTitleColorToLeaveTheDescriptionColor(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("colors", "Title", "Body", "#112233", "#334455"),
    textSection("other", "Other title", "Other body", "#123456", "#445566"),
  ]);
  const titleColor = screen.getByLabelText("Title color");
  const descriptionColor = screen.getByLabelText("Description color");
  await user.clear(titleColor);
  await user.type(titleColor, "#010101");
  // The description field and the other section keep their own colors.
  expect(titleColor).toHaveProperty("value", "#010101");
  expect(descriptionColor).toHaveProperty("value", "#334455");
  expect(paintColor(previewTitle("colors"))).toBe("#010101");
  expect(paintColor(previewDescription("colors"))).toBe("#334455");
  expect(previewTitle("other").textContent).toBe("Other title");
  expect(paintColor(previewTitle("other"))).toBe("#123456");
  expect(paintColor(previewDescription("other"))).toBe("#445566");
}

/**
 * Asserts editing one text title leaves the other text title in the preview.
 *
 * Purpose: two text sections do not share a title.
 * Inputs: none.
 * Side effects: renders the shell and edits the first title.
 */
async function expectTheSecondTextTitleToStay(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("first", "First title", "First body", "#112233", "#334455"),
    textSection("second", "Second title", "Second body", "#123456", "#445566"),
  ]);
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, "Edited first");
  // The first preview follows the input. The second preview keeps its own title and color.
  expect(previewTitle("first").textContent).toBe("Edited first");
  expect(previewDescription("first").textContent).toBe("First body");
  expect(previewTitle("second").textContent).toBe("Second title");
  expect(previewDescription("second").textContent).toBe("Second body");
  expect(paintColor(previewTitle("second"))).toBe("#123456");
  expect(paintColor(previewDescription("second"))).toBe("#445566");
}

/**
 * Asserts an incomplete title color stays in the input and the preview keeps the previous color.
 *
 * Purpose: "#" and "#12" are draft text. They do not reset the control or the paint color.
 * Inputs: none.
 * Side effects: renders the shell and types incomplete colors.
 */
async function expectAnIncompleteColorToKeepThePreviousPaint(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("paint", "Kept title", "Kept body", "#112233", "#334455")]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#010101");
  // #010101 is valid and is not the default #112233, so a later fallback would be visible.
  expect(paintColor(previewTitle("paint"))).toBe("#010101");
  await user.clear(titleColor);
  await user.type(titleColor, "#");
  // The input is the raw hash. The title paint stays on the previous valid color.
  expect(titleColor).toHaveProperty("value", "#");
  expect(titleColor.getAttribute("type")).toBe("text");
  expect(titleColor.getAttribute("aria-invalid")).toBe("true");
  expect(paintColor(previewTitle("paint"))).toBe("#010101");
  expect(screen.getByText(TITLE_COLOR_ERROR)).toBeTruthy();
  expect(screen.queryByText("Low contrast")).toBeNull();
  expectControlDescription(titleColor, TITLE_COLOR_ERROR);
  await user.type(titleColor, "12");
  // #12 is still incomplete. The other fields stay, and the description color is unchanged.
  expect(titleColor).toHaveProperty("value", "#12");
  expect(paintColor(previewTitle("paint"))).toBe("#010101");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kept title");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Kept body");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#334455");
  expect(paintColor(previewDescription("paint"))).toBe("#334455");
  expect(screen.queryByText(DESCRIPTION_COLOR_ERROR)).toBeNull();
}

/**
 * Asserts a Unicode title stays in the draft and the preview.
 *
 * Purpose: the title is stored as text, including accents and characters outside Latin-1.
 * Inputs: none.
 * Side effects: renders the shell and types the title.
 */
async function expectAUnicodeTitleToStayInTheDraft(): Promise<void> {
  const user = userEvent.setup();
  const unicode = "Café — 新品";
  renderEditor([textSection("unicode", "Before", "Body")]);
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, unicode);
  // The input is the draft. The preview shows the same characters.
  expect(title).toHaveProperty("value", unicode);
  expect(previewTitle("unicode").textContent).toBe(unicode);
}

/**
 * Asserts empty title and description render an empty text block.
 *
 * Purpose: a blank text section is allowed and does not throw.
 * Inputs: none.
 * Side effects: renders the shell.
 */
function expectEmptyTextToRender(): void {
  renderEditor([textSection("empty", "", "", "#112233", "#334455")]);
  // Both controls and both preview lines are present and empty.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "");
  expect(previewTitle("empty").textContent).toBe("");
  expect(previewDescription("empty").textContent).toBe("");
  expect(previewBlock("empty").querySelector("img")).toBeNull();
  expect(previewBlock("empty").getAttribute("data-preview-label")).toBe("Text");
  expect(previewBlock("empty").getAttribute("data-preview-hint")).toBe("Untitled");
  expect(screen.getByRole("button", { name: "Select Text, Untitled" })).toBeTruthy();
}

/**
 * Asserts black title text does not warn and gray title text does.
 *
 * Purpose: the warning is visible in the inspector and does not clear the color.
 * Inputs: none.
 * Side effects: renders the shell and types two title colors.
 */
async function expectLowContrastToWarnWithoutRejectingTheColor(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("contrast", "Title", "Body", "#112233", "#334455")]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#000000");
  // Black on the white phone is above 4.5:1, so the warning is absent.
  expect(screen.queryByText("Low contrast")).toBeNull();
  expect(paintColor(previewTitle("contrast"))).toBe("#000000");
  expect(titleColor.getAttribute("aria-invalid")).toBe("false");
  expectControlDescription(titleColor, null);
  await user.clear(titleColor);
  await user.type(titleColor, "#767676");
  // #767676 is just above 4.5:1. It is painted and it is not an invalid color.
  expect(titleColor).toHaveProperty("value", "#767676");
  expect(screen.queryByText("Low contrast")).toBeNull();
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
  expect(paintColor(previewTitle("contrast"))).toBe("#767676");
  expect(titleColor.getAttribute("aria-invalid")).toBe("false");
  await user.clear(titleColor);
  await user.type(titleColor, "#777777");
  // The gray stays in the field. The warning is announced, and the field stays valid.
  expect(titleColor).toHaveProperty("value", "#777777");
  expect(screen.getByText("Low contrast")).toBeTruthy();
  expect(paintColor(previewTitle("contrast"))).toBe("#777777");
  expect(titleColor.getAttribute("aria-invalid")).toBe("false");
  expectControlDescription(titleColor, "Low contrast");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#334455");
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
}

/**
 * Asserts a text block that has never had a valid color uses the defaults.
 *
 * Purpose: "#" and "#12" paint #112233 and #334455 when there is no earlier valid color.
 * Inputs: none.
 * Side effects: renders the preview only. The schema cannot hydrate these strings.
 */
function expectInvalidInitialColorsToUseTheDefaults(): void {
  const section: DraftTextSection = {
    id: "raw",
    type: "text",
    title: "Visible",
    description: "Body",
    titleColor: "#",
    descriptionColor: "#12",
  };
  // The list item can render without the provider because the preview does not dispatch.
  render(
    <ol>
      <TextPreview section={section} />
    </ol>,
  );
  expect(previewTitle("raw").textContent).toBe("Visible");
  expect(paintColor(previewTitle("raw"))).toBe("#112233");
  expect(paintColor(previewDescription("raw"))).toBe("#334455");
}

/**
 * Asserts the static registry points text at the text components.
 *
 * Purpose: text is registered beside carousel and button, and the button is not the carousel placeholder.
 * Inputs: none.
 * Side effects: none.
 */
function expectTheRegistryToRegisterText(): void {
  // The keys are the three stored types. Text is the entry with the text components.
  expect(Object.keys(sectionUiRegistry)).toEqual(["carousel", "text", "cta"]);
  expect(sectionUiRegistry.text.Inspector).toBe(TextInspector);
  expect(sectionUiRegistry.text.Preview).toBe(TextPreview);
  expect(sectionUiRegistry.carousel.Inspector).not.toBe(sectionUiRegistry.cta.Inspector);
  expect(sectionUiRegistry.carousel.Preview).not.toBe(sectionUiRegistry.cta.Preview);
  expect(sectionUiRegistry.text.Inspector).not.toBe(sectionUiRegistry.carousel.Inspector);
  expect(sectionUiRegistry.text.Preview).not.toBe(sectionUiRegistry.carousel.Preview);
}

/**
 * Asserts a color control points at one message, or at none.
 *
 * Purpose: the hex error and the contrast warning belong to the input that shows them.
 * Inputs: control, the color field. message, the visible sentence, or null when the field has no description.
 * Side effects: none.
 */
function expectControlDescription(control: HTMLElement, message: string | null): void {
  const describedBy = control.getAttribute("aria-describedby");
  if (message === null) {
    // A valid color with enough contrast has nothing else to announce.
    expect(describedBy).toBeNull();
    return;
  }
  if (describedBy === null || describedBy.includes(" ")) {
    throw new Error(`Expected one description id for ${message}.`);
  }
  // The id points at the visible sentence.
  expect(document.getElementById(describedBy)?.textContent).toBe(message);
}

/**
 * Builds a text section the preview can render without the configuration schema.
 *
 * Purpose: an incomplete color cannot be hydrated, and a rerender can change the section id.
 * Inputs: id, the section id. titleColor and descriptionColor, the raw draft strings.
 * Side effects: none.
 */
function rawTextSection(id: string, titleColor: string, descriptionColor: string): DraftTextSection {
  // The title is the id so a rerender is visible in the preview text.
  return {
    id,
    type: "text",
    title: id,
    description: "Body",
    titleColor,
    descriptionColor,
  };
}

/**
 * Builds a carousel section.
 *
 * Purpose: a mixed document still shows a placeholder beside a text block.
 * Inputs: id, the section id. alt, the first slide's alt text.
 * Side effects: none.
 */
function carouselSection(id: string, alt: string): Section {
  // One slide is enough for the row hint. The address is the image source, not a caption.
  return {
    id,
    type: "carousel",
    aspectRatio: "landscape",
    images: [
      {
        id: `${id}-image-1`,
        url: `https://example.com/${id}.jpg`,
        alt,
      },
    ],
  };
}

/**
 * Builds a button section.
 *
 * Purpose: a button section can sit beside a text block in the same document.
 * Inputs: id, the section id. label, the button label.
 * Side effects: none.
 */
function buttonSection(id: string, label: string): Section {
  // The colors are valid. The button preview paints them.
  return {
    id,
    type: "cta",
    label,
    url: "https://example.com/continue",
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  };
}

/**
 * Asserts each title-color keystroke stays in the input until the color is valid.
 *
 * Purpose: "#" is not replaced by the previous color. #112 is a valid shorthand, and the sixth digit paints #112233.
 * Inputs: none.
 * Side effects: renders the shell and types a title color one character at a time.
 */
async function expectEachTitleColorKeystrokeToStayInTheInput(): Promise<void> {
  const user = userEvent.setup();
  const typed = "#112233";
  // #112 is #RGB, so the paint becomes #111122 there. Longer incomplete prefixes keep that color.
  const paintByPrefix = new Map<string, string>([
    ["#", "#010101"],
    ["#1", "#010101"],
    ["#11", "#010101"],
    ["#112", "#111122"],
    ["#1122", "#111122"],
    ["#11223", "#111122"],
    ["#112233", "#112233"],
  ]);
  renderEditor([
    textSection("paint", "Kept title", "Kept body", "#112233", "#334455"),
    textSection("other", "Other title", "Other body", "#123456", "#445566"),
  ]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#010101");
  // #010101 is not the default and is not the color typed next, so both mistakes are visible.
  expect(paintColor(previewTitle("paint"))).toBe("#010101");
  await user.clear(titleColor);
  let soFar = "";
  for (const character of typed) {
    await user.type(titleColor, character);
    soFar += character;
    const paint = paintByPrefix.get(soFar);
    if (paint === undefined) {
      throw new Error(`Missing expected paint for ${soFar}.`);
    }
    // The input is the prefix. A valid prefix is painted, and it is not written back expanded.
    expect(titleColor).toHaveProperty("value", soFar);
    expect(paintColor(previewTitle("paint"))).toBe(paint);
    if (soFar === "#112" || soFar === typed) {
      expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
    } else {
      expect(screen.getByText(TITLE_COLOR_ERROR)).toBeTruthy();
    }
  }
  // The description and the other text section are still their own values.
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Kept body");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#334455");
  expect(paintColor(previewDescription("paint"))).toBe("#334455");
  expect(paintColor(previewTitle("other"))).toBe("#123456");
  expect(paintColor(previewDescription("other"))).toBe("#445566");
  expect(previewTitle("other").textContent).toBe("Other title");
}

/**
 * Asserts the description color is independent of the title color.
 *
 * Purpose: an incomplete description color keeps its own previous paint and its own error.
 * Inputs: none.
 * Side effects: renders the shell and edits the description color.
 */
async function expectDescriptionColorToStayIndependent(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("colors", "Title", "Body", "#112233", "#334455"),
    textSection("other", "Other title", "Other body", "#123456", "#445566"),
  ]);
  const descriptionColor = screen.getByLabelText("Description color");
  await user.clear(descriptionColor);
  await user.type(descriptionColor, "#020202");
  // The description paint follows this field. The title color is a different field.
  expect(descriptionColor).toHaveProperty("value", "#020202");
  expect(descriptionColor.getAttribute("type")).toBe("text");
  expect(paintColor(previewDescription("colors"))).toBe("#020202");
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#112233");
  expect(paintColor(previewTitle("colors"))).toBe("#112233");
  expect(paintColor(previewDescription("other"))).toBe("#445566");
  await user.clear(descriptionColor);
  // A blank description color is unfinished. It keeps #020202 and does not warn.
  expect(descriptionColor).toHaveProperty("value", "");
  expect(descriptionColor.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(DESCRIPTION_COLOR_ERROR)).toBeNull();
  expect(paintColor(previewDescription("colors"))).toBe("#020202");
  await user.type(descriptionColor, "#");
  // "#" stays in this input. The description paint stays on #020202, and the title does not error.
  expect(descriptionColor).toHaveProperty("value", "#");
  expect(descriptionColor.getAttribute("aria-invalid")).toBe("true");
  expectControlDescription(descriptionColor, DESCRIPTION_COLOR_ERROR);
  expect(paintColor(previewDescription("colors"))).toBe("#020202");
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
  expect(screen.queryByText("Low contrast")).toBeNull();
  expect(paintColor(previewTitle("colors"))).toBe("#112233");
  await user.type(descriptionColor, "445566");
  // The finished color replaces the previous description paint and clears the error.
  expect(descriptionColor).toHaveProperty("value", "#445566");
  expect(paintColor(previewDescription("colors"))).toBe("#445566");
  expect(screen.queryByText(DESCRIPTION_COLOR_ERROR)).toBeNull();
  expect(paintColor(previewTitle("other"))).toBe("#123456");
  expect(previewTitle("other").textContent).toBe("Other title");
  await user.clear(descriptionColor);
  await user.type(descriptionColor, "#abc");
  // The shorthand stays in the field and expands only in the description paint.
  expect(descriptionColor).toHaveProperty("value", "#abc");
  expect(paintColor(previewDescription("colors"))).toBe("#aabbcc");
  expect(screen.queryByText(DESCRIPTION_COLOR_ERROR)).toBeNull();
  expect(screen.queryByText("Low contrast")).toBeNull();
  expect(paintColor(previewTitle("colors"))).toBe("#112233");
}

/**
 * Asserts clearing a title color is not an error.
 *
 * Purpose: an empty color is unfinished. The preview keeps the previous valid color.
 * Inputs: none.
 * Side effects: renders the shell and clears the title color.
 */
async function expectAnEmptyTitleColorToKeepThePreviousPaint(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("paint", "Kept title", "Kept body", "#112233", "#334455")]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#010101");
  await user.clear(titleColor);
  // The field is blank, so there is no hex error and no contrast warning.
  expect(titleColor).toHaveProperty("value", "");
  expect(titleColor.getAttribute("aria-invalid")).toBe("false");
  expectControlDescription(titleColor, null);
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
  expect(screen.queryByText("Low contrast")).toBeNull();
  expect(paintColor(previewTitle("paint"))).toBe("#010101");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kept title");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Kept body");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#334455");
  expect(paintColor(previewDescription("paint"))).toBe("#334455");
}

/**
 * Asserts the draft keeps the typed hex while the preview paints the normalized color.
 *
 * Purpose: #RGB and uppercase #RRGGBB are valid, and a light shorthand warns instead of erroring.
 * Inputs: none.
 * Side effects: renders the shell and types two title colors.
 */
async function expectTheTypedColorToStayWhileThePreviewNormalizesIt(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("norm", "Title", "Body", "#112233", "#334455")]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#abc");
  // The input is the shorthand. The paint is #aabbcc, which is below 4.5:1 on white.
  expect(titleColor).toHaveProperty("value", "#abc");
  expect(paintColor(previewTitle("norm"))).toBe("#aabbcc");
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
  expect(titleColor.getAttribute("aria-invalid")).toBe("false");
  expectControlDescription(titleColor, "Low contrast");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#334455");
  expect(paintColor(previewDescription("norm"))).toBe("#334455");
  await user.type(titleColor, "z");
  // #abcz is not a color. The warning goes away and the shorthand paint remains.
  expect(titleColor).toHaveProperty("value", "#abcz");
  expect(paintColor(previewTitle("norm"))).toBe("#aabbcc");
  expect(screen.queryByText("Low contrast")).toBeNull();
  expect(titleColor.getAttribute("aria-invalid")).toBe("true");
  expectControlDescription(titleColor, TITLE_COLOR_ERROR);
  await user.clear(titleColor);
  await user.type(titleColor, "#ABCDEF");
  // Uppercase stays in the draft. The preview uses the lowercase form.
  expect(titleColor).toHaveProperty("value", "#ABCDEF");
  expect(paintColor(previewTitle("norm"))).toBe("#abcdef");
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Body");
}

/**
 * Asserts a rejected title color names the field and leaves the other values in place.
 *
 * Purpose: #GGGGGG and #11223344 are not painted and do not clear the title or the description.
 * Inputs: none.
 * Side effects: renders the shell, types #GGGGGG, and pastes #11223344.
 */
async function expectRejectedTitleColorsToKeepTheOtherFields(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("paint", "Kept title", "Kept body", "#112233", "#334455")]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#010101");
  await user.clear(titleColor);
  await user.type(titleColor, "#GGGGGG");
  // Letters are not hex. The previous paint stays, and contrast does not warn.
  expect(titleColor).toHaveProperty("value", "#GGGGGG");
  expect(titleColor.getAttribute("aria-invalid")).toBe("true");
  expectControlDescription(titleColor, TITLE_COLOR_ERROR);
  expect(paintColor(previewTitle("paint"))).toBe("#010101");
  expect(screen.queryByText("Low contrast")).toBeNull();
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#334455");
  await user.clear(titleColor);
  await user.click(titleColor);
  await user.paste("#11223344");
  // One paste does not pass through the valid prefix #112233. The previous paint stays.
  expect(titleColor).toHaveProperty("value", "#11223344");
  expect(screen.getByText(TITLE_COLOR_ERROR)).toBeTruthy();
  expect(paintColor(previewTitle("paint"))).toBe("#010101");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kept title");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Kept body");
  expect(paintColor(previewDescription("paint"))).toBe("#334455");
  expect(screen.getByLabelText("Description color").getAttribute("aria-invalid")).toBe("false");
}

/**
 * Asserts a low-contrast description does not warn.
 *
 * Purpose: the warning is for the title color against the white phone background.
 * Inputs: none.
 * Side effects: renders the shell and types a gray description color.
 */
async function expectLowContrastToFollowTheTitleColorOnly(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("contrast", "Title", "Body", "#000000", "#334455")]);
  const descriptionColor = screen.getByLabelText("Description color");
  await user.clear(descriptionColor);
  await user.type(descriptionColor, "#777777");
  // The description is painted. The title is black on white, so the warning stays hidden.
  expect(descriptionColor).toHaveProperty("value", "#777777");
  expect(paintColor(previewDescription("contrast"))).toBe("#777777");
  expect(screen.queryByText("Low contrast")).toBeNull();
  expect(descriptionColor.getAttribute("aria-invalid")).toBe("false");
  expectControlDescription(descriptionColor, null);
  const titleColor = screen.getByLabelText("Title color");
  expect(titleColor).toHaveProperty("value", "#000000");
  expect(paintColor(previewTitle("contrast"))).toBe("#000000");
  expect(titleColor.getAttribute("aria-invalid")).toBe("false");
  expectControlDescription(titleColor, null);
}

/**
 * Asserts a multiline Unicode description stays in the draft and the preview.
 *
 * Purpose: accents, a blank line, and characters outside Latin-1 are text, not a fetch.
 * Inputs: none.
 * Side effects: renders the shell and types the description.
 */
async function expectAMultilineUnicodeDescriptionToStay(): Promise<void> {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  const body = "Café — 新品\n\n第二行";
  try {
    renderEditor([textSection("unicode", "Title", "")]);
    const description = screen.getByLabelText("Description");
    await user.type(description, "Café — 新品{Enter}{Enter}第二行");
    // The textarea and the preview share the newline. The title is untouched.
    expect(description).toHaveProperty("value", body);
    expect(previewDescription("unicode").textContent).toBe(body);
    expect(previewDescription("unicode").style.whiteSpace).toBe("pre-wrap");
    expect(screen.getByLabelText("Title")).toHaveProperty("value", "Title");
    expect(previewTitle("unicode").textContent).toBe("Title");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
}

/**
 * Asserts markup in a description is visible text.
 *
 * Purpose: the description is a React text node, so a script tag cannot be inserted.
 * Inputs: none.
 * Side effects: renders the shell and types the markup into the description.
 */
async function expectMarkupInTheDescriptionToStayText(): Promise<void> {
  const user = userEvent.setup();
  const markup = "<script>alert(1)</script>";
  renderEditor([textSection("html", "Kept title", "Before")]);
  const description = screen.getByLabelText("Description");
  await user.clear(description);
  await user.type(description, markup);
  const preview = previewDescription("html");
  const phone = document.querySelector(".phone-screen");
  // The characters are the text. The phone does not gain a script, and the title stays.
  expect(description).toHaveProperty("value", markup);
  expect(preview.textContent).toBe(markup);
  expect(preview.childNodes).toHaveLength(1);
  expect(preview.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
  expect(phone?.querySelector("script")).toBeNull();
  expect(phone?.querySelector("img")).toBeNull();
  expect(previewTitle("html").textContent).toBe("Kept title");
}

/**
 * Asserts an incomplete title color stays with its section while another section is selected.
 *
 * Purpose: selecting the second text section shows that section's fields and leaves the first paint alone.
 * Inputs: none.
 * Side effects: renders the shell, types an incomplete color, and selects each text row.
 */
async function expectAnIncompleteColorToStayWithItsSection(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("first", "First title", "First body", "#112233", "#334455"),
    textSection("second", "Second title", "Second body", "#123456", "#445566"),
  ]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#010101");
  await user.clear(titleColor);
  await user.type(titleColor, "#");
  await user.click(screen.getByRole("button", { name: "Select Text, Second title" }));
  // The inspector is the second section. The first preview still uses its previous valid color.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Second title");
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#123456");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#445566");
  expect(screen.queryByText(TITLE_COLOR_ERROR)).toBeNull();
  expect(paintColor(previewTitle("first"))).toBe("#010101");
  expect(paintColor(previewDescription("first"))).toBe("#334455");
  expect(paintColor(previewTitle("second"))).toBe("#123456");
  expect(paintColor(previewDescription("second"))).toBe("#445566");
  await user.click(screen.getByRole("button", { name: "Select Text, First title" }));
  // Returning to the first section restores the unfinished color without resetting the paint.
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#");
  expect(screen.getByText(TITLE_COLOR_ERROR)).toBeTruthy();
  expect(paintColor(previewTitle("first"))).toBe("#010101");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "First body");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#334455");
  expect(previewTitle("second").textContent).toBe("Second title");
}

/**
 * Asserts moving a text section keeps the last valid color for an incomplete field.
 *
 * Purpose: the phone row moves with the section, and the paint does not fall back to the default.
 * Inputs: none.
 * Side effects: renders the shell, types an incomplete color, and moves the section down.
 */
async function expectMovingASectionToKeepItsLastValidColor(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("first", "First title", "First body", "#112233", "#334455"),
    textSection("second", "Second title", "Second body", "#123456", "#445566"),
  ]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#010101");
  await user.clear(titleColor);
  await user.type(titleColor, "#");
  const reorder = screen.getByRole("button", { name: "Reorder Text, First title" });
  reorder.focus();
  await user.keyboard("{ArrowDown}");
  const ids = [...document.querySelectorAll(".preview-list [data-section-id]")].map((element) => element.getAttribute("data-section-id"));
  // The unfinished color is still on the first section, which is now second in the phone.
  expect(ids).toEqual(["second", "first"]);
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#");
  expect(paintColor(previewTitle("first"))).toBe("#010101");
  expect(paintColor(previewDescription("first"))).toBe("#334455");
  expect(previewTitle("second").textContent).toBe("Second title");
  expect(paintColor(previewTitle("second"))).toBe("#123456");
  expect(paintColor(previewDescription("second"))).toBe("#445566");
}

/**
 * Asserts one preview instance does not reuse another section's last valid color.
 *
 * Purpose: a new section id starts from its own color or the default, even when the component stays mounted.
 * Inputs: none.
 * Side effects: renders the preview and rerenders it with new props.
 */
function expectAPreviewToForgetAnotherSectionsColor(): void {
  const view = render(
    <ol>
      <TextPreview section={rawTextSection("a", "#010101", "#020202")} />
    </ol>,
  );
  // The first section paints the valid colors it was given.
  expect(paintColor(previewTitle("a"))).toBe("#010101");
  expect(paintColor(previewDescription("a"))).toBe("#020202");
  view.rerender(
    <ol>
      <TextPreview section={rawTextSection("a", "#", "#12")} />
    </ol>,
  );
  // The same section keeps those colors while the draft strings are incomplete.
  expect(paintColor(previewTitle("a"))).toBe("#010101");
  expect(paintColor(previewDescription("a"))).toBe("#020202");
  view.rerender(
    <ol>
      <TextPreview section={rawTextSection("b", "#", "#12")} />
    </ol>,
  );
  // A different section does not inherit that memory. Neither field has been valid yet.
  expect(document.querySelector('[data-section-id="a"]')).toBeNull();
  expect(paintColor(previewTitle("b"))).toBe("#112233");
  expect(paintColor(previewDescription("b"))).toBe("#334455");
  view.rerender(
    <ol>
      <TextPreview section={rawTextSection("b", "#abcdef", "#fedcba")} />
    </ol>,
  );
  // The new section can then remember its own valid colors.
  expect(paintColor(previewTitle("b"))).toBe("#abcdef");
  expect(paintColor(previewDescription("b"))).toBe("#fedcba");
  view.rerender(
    <ol>
      <TextPreview section={rawTextSection("a", "#", "#")} />
    </ol>,
  );
  // Coming back to the first id does not restore the other section's colors.
  expect(paintColor(previewTitle("a"))).toBe("#112233");
  expect(paintColor(previewDescription("a"))).toBe("#334455");
}

/**
 * Asserts a text-only phone hides the placeholder note.
 *
 * Purpose: the note is for carousel blocks, and a text screen has none.
 * Inputs: none.
 * Side effects: renders the shell.
 */
function expectATextOnlyPhoneToHideThePlaceholderNote(): void {
  renderEditor([textSection("only", "Only title", "Only body")]);
  // The text is visible. The placeholder sentence is not, because every block is text.
  expect(previewTitle("only").textContent).toBe("Only title");
  expect(previewDescription("only").textContent).toBe("Only body");
  expect(screen.queryByText("Carousel blocks are placeholders for the section preview.")).toBeNull();
}

/**
 * Asserts a carousel keeps its own preview beside a text block and a button.
 *
 * Purpose: selecting the carousel does not show the text or button fields, and the text preview stays.
 * Inputs: none.
 * Side effects: renders the shell and selects each row.
 */
async function expectACarouselToKeepTheTextPreviewWhenSelected(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("copy", "Visible title", "Visible body"),
    carouselSection("slides", "Shop window"),
    buttonSection("go", "Continue"),
  ]);
  // The text row is selected. The carousel is a real preview. The button is a real preview.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Visible title");
  expect(screen.queryByText("Carousel blocks are placeholders for the section preview.")).toBeNull();
  expect(previewBlock("slides").classList.contains("preview-carousel")).toBe(true);
  expect(previewBlock("slides").classList.contains("preview-placeholder")).toBe(false);
  expect(previewBlock("slides").querySelector("img")?.getAttribute("alt")).toBe("Shop window");
  expect(previewBlock("slides").getAttribute("data-preview-label")).toBe("Carousel");
  expect(previewBlock("slides").getAttribute("data-preview-hint")).toBe("Shop window");
  expect(previewBlock("go").classList.contains("preview-cta")).toBe(true);
  expect(previewBlock("go").querySelector("button")?.textContent).toBe("Continue");
  expect(previewBlock("go").getAttribute("data-preview-label")).toBe("Button");
  expect(previewBlock("go").getAttribute("data-preview-hint")).toBe("Continue");
  expect(previewTitle("copy").textContent).toBe("Visible title");
  expect(screen.queryByText("https://example.com/continue")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Select Carousel, Shop window" }));
  // The carousel inspector is the ratio and the image fields. The text preview stays on the phone.
  expect(screen.getByRole("radiogroup", { name: "Aspect ratio" })).toBeTruthy();
  expect(screen.getByLabelText("Image URL")).toHaveProperty("value", "https://example.com/slides.jpg");
  expect(screen.queryByText("Fields for this section arrive in the next prompts.")).toBeNull();
  expect(screen.queryByLabelText("Title")).toBeNull();
  expect(screen.queryByLabelText("Label")).toBeNull();
  expect(previewTitle("copy").textContent).toBe("Visible title");
  await user.click(screen.getByRole("button", { name: "Select Button, Continue" }));
  // The button row shows its fields. The destination URL is not visible until the preview button is activated.
  expect(screen.getByText("Type: cta")).toBeTruthy();
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "Continue");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/continue");
  expect(screen.queryByText("Fields for this section arrive in the next prompts.")).toBeNull();
  expect(screen.queryByLabelText("Description")).toBeNull();
  expect(screen.queryByText("https://example.com/continue")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Select Text, Visible title" }));
  // The text fields return with the draft copy.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Visible title");
  expect(screen.getByLabelText("Description")).toHaveProperty("value", "Visible body");
  expect(screen.queryByLabelText("Label")).toBeNull();
  expect(screen.queryByText("Fields for this section arrive in the next prompts.")).toBeNull();
}

/**
 * Asserts each text color swatch writes the matching color input.
 *
 * Purpose: a picked color and a typed color stay on the same field, and an incomplete string stays in the text input.
 * Inputs: none.
 * Side effects: renders the shell, picks a title color, and types both color fields.
 */
async function expectTheColorPickersToWriteTheColorInputs(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("colors", "Title", "Body", "#112233", "#334455"),
    textSection("other", "Other title", "Other body", "#123456", "#445566"),
    {
      id: "go",
      type: "cta",
      label: "Continue",
      url: "https://example.com/continue",
      backgroundColor: "#112233",
      labelColor: "#ffffff",
    },
  ]);
  const settings = screen.getByRole("region", { name: "Section settings" });
  const titleColor = withinSettingsInput(settings, "Title color");
  const titlePicker = withinSettingsInput(settings, "Choose title color");
  const descriptionColor = withinSettingsInput(settings, "Description color");
  const descriptionPicker = withinSettingsInput(settings, "Choose description color");
  // The text inputs stay text inputs. The swatches start on the same colors.
  expect(titleColor.getAttribute("type")).toBe("text");
  expect(titlePicker.getAttribute("type")).toBe("color");
  expect(titlePicker).toHaveProperty("value", "#112233");
  expect(descriptionPicker).toHaveProperty("value", "#334455");
  fireEvent.input(titlePicker, { target: { value: "#abcdef" } });
  // The picked color is the title color input and the title paint. The description stays.
  expect(titleColor).toHaveProperty("value", "#abcdef");
  expect(titlePicker).toHaveProperty("value", "#abcdef");
  expect(paintColor(previewTitle("colors"))).toBe("#abcdef");
  expect(descriptionColor).toHaveProperty("value", "#334455");
  expect(descriptionPicker).toHaveProperty("value", "#334455");
  expect(paintColor(previewTitle("other"))).toBe("#123456");
  await user.clear(descriptionColor);
  await user.type(descriptionColor, "#010101");
  // Typing updates the description swatch and leaves the title color that was picked.
  expect(descriptionColor).toHaveProperty("value", "#010101");
  expect(descriptionPicker).toHaveProperty("value", "#010101");
  expect(titleColor).toHaveProperty("value", "#abcdef");
  await user.clear(titleColor);
  await user.type(titleColor, "#abc");
  // Shorthand stays in the text input. The swatch shows the expanded color.
  expect(titleColor).toHaveProperty("value", "#abc");
  expect(titlePicker).toHaveProperty("value", "#aabbcc");
  await user.clear(titleColor);
  await user.type(titleColor, "#");
  // An incomplete string stays in the text input. The swatch keeps the last valid color.
  expect(titleColor).toHaveProperty("value", "#");
  expect(titlePicker).toHaveProperty("value", "#aabbcc");
  expect(paintColor(previewTitle("colors"))).toBe("#aabbcc");
  await user.click(screen.getByRole("button", { name: "Select Text, Other title" }));
  // The other section's settings show that section's own color input and swatch.
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#123456");
  expect(screen.getByLabelText("Choose title color")).toHaveProperty("value", "#123456");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#445566");
  expect(screen.getByLabelText("Choose description color")).toHaveProperty("value", "#445566");
  await user.click(screen.getByRole("button", { name: "Select Text, Title" }));
  // Coming back keeps the incomplete title in its input and the last valid color on its swatch.
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#");
  expect(screen.getByLabelText("Choose title color")).toHaveProperty("value", "#aabbcc");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#010101");
  await user.click(screen.getByRole("button", { name: "Select Button, Continue" }));
  // A button has its own color fields. The text swatches are not shown on this row.
  expect(screen.queryByLabelText("Choose title color")).toBeNull();
  expect(screen.getByLabelText("Choose button color")).toHaveProperty("value", "#112233");
  await user.click(screen.getByRole("button", { name: "Select Text, Title" }));
  // Opening the button and coming back still keeps this text field's swatch.
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#");
  expect(screen.getByLabelText("Choose title color")).toHaveProperty("value", "#aabbcc");
}

/**
 * Reads one labeled control inside section settings.
 *
 * Purpose: the color input and its swatch are both in the details pane.
 * Inputs: settings, the section settings region. label, the accessible name.
 * Side effects: none. Throws when that control is missing.
 */
function withinSettingsInput(settings: HTMLElement, label: string): HTMLElement {
  // The landmark keeps the assertion on the selected section's fields.
  const control = within(settings).getByLabelText(label);
  if (!(control instanceof HTMLElement)) {
    throw new Error(`Missing ${label}.`);
  }
  return control;
}

/**
 * Registers the text section cases.
 *
 * Purpose: each case covers one editing or rendering behavior from this prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerTextSectionCases(): void {
  // Editing, preview text, colors, contrast, and the registry entry.
  it("updates the preview title from the draft without a fetch", expectTypingTheTitleToUpdateThePreviewWithoutAFetch);
  it("keeps a newline in the preview description", expectAMultilineDescriptionToKeepItsNewline);
  it("shows a markup title as text", expectMarkupInTheTitleToStayText);
  it("keeps the description color when the title color changes", expectTitleColorToLeaveTheDescriptionColor);
  it("keeps the second text title when the first title changes", expectTheSecondTextTitleToStay);
  it("keeps # in the title color input and the previous paint color", expectAnIncompleteColorToKeepThePreviousPaint);
  it("keeps a Unicode title in the draft and the preview", expectAUnicodeTitleToStayInTheDraft);
  it("renders an empty title and an empty description", expectEmptyTextToRender);
  it("warns for low contrast and keeps the color", expectLowContrastToWarnWithoutRejectingTheColor);
  it("uses the default colors when no valid color has been entered", expectInvalidInitialColorsToUseTheDefaults);
  it("registers the text inspector and preview", expectTheRegistryToRegisterText);
  it("keeps each title-color keystroke and paints the color when it is valid", expectEachTitleColorKeystrokeToStayInTheInput);
  it("keeps an incomplete description color on that field only", expectDescriptionColorToStayIndependent);
  it("treats an empty title color as unfinished and keeps the previous paint", expectAnEmptyTitleColorToKeepThePreviousPaint);
  it("keeps the typed hex and paints the normalized color", expectTheTypedColorToStayWhileThePreviewNormalizesIt);
  it("names a rejected title color and keeps the other fields", expectRejectedTitleColorsToKeepTheOtherFields);
  it("does not warn when only the description color is low contrast", expectLowContrastToFollowTheTitleColorOnly);
  it("keeps a multiline Unicode description in the draft and the preview", expectAMultilineUnicodeDescriptionToStay);
  it("shows markup in the description as text", expectMarkupInTheDescriptionToStayText);
  it("keeps an incomplete title color when another text section is selected", expectAnIncompleteColorToStayWithItsSection);
  it("keeps the last valid color when the text section moves", expectMovingASectionToKeepItsLastValidColor);
  it("uses the default color when a preview instance changes section", expectAPreviewToForgetAnotherSectionsColor);
  it("hides the placeholder note when every section is text", expectATextOnlyPhoneToHideThePlaceholderNote);
  it("keeps the text preview when a carousel is selected beside a button", expectACarouselToKeepTheTextPreviewWhenSelected);
  it("writes a picked color into the matching color input", expectTheColorPickersToWriteTheColorInputs);
}

afterEach(() => {
  cleanup();
});

describe("text section", registerTextSectionCases);
