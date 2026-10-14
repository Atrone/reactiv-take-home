// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  configurationSchema,
  createDemoDocument,
  SUPPORTED_SCHEMA_VERSION,
  type Configuration,
  type Section,
} from "@reactiv/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DraftCarouselSection, DraftCtaSection, DraftSection, DraftTextSection } from "./draft-document.js";
import { EditorProvider } from "./editor-context.js";
import { EditorShell } from "./editor-shell.js";
import { sectionControlName } from "./section-summary.js";
import { EMPTY_CAROUSEL_MESSAGE } from "../sections/carousel-fields.js";

/** One user-event session. */
type EditorUser = ReturnType<typeof userEvent.setup>;

/** URLs passed to fetch while a test is mounted. */
let fetchCalls: string[] = [];

/** The spy installed for this test, restored after the shell unmounts. */
let fetchSpy: { mockRestore: () => void } | null = null;

/**
 * Builds a 1x1 PNG response.
 *
 * Purpose: an image src that happy-dom does request is answered here, not on the network.
 * Inputs: none.
 * Side effects: none.
 */
function imageResponse(): Response {
  // A 1x1 PNG. The preview test reads the src attribute, not the decoded pixels.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const binary = atob(png);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    // Copy one decoded byte into the response body.
    const code = binary.charCodeAt(index);
    bytes[index] = code;
  }
  return new Response(bytes, { status: 200, headers: { "content-type": "image/png" } });
}

/**
 * Reads the URL from a fetch input.
 *
 * Purpose: the stub can tell an image address from any other request.
 * Inputs: input, the value passed to fetch.
 * Side effects: none.
 */
function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    // A string URL is already the address.
    return input;
  }
  if (input instanceof URL) {
    // A URL object uses its href.
    return input.href;
  }
  // A Request carries the address on url.
  return input.url;
}

/**
 * Reports whether a URL is a slide image.
 *
 * Purpose: image bytes are stubbed. Any other address is a request the preview must not make.
 * Inputs: url, the fetch address.
 * Side effects: none.
 */
function isImageRequest(url: string): boolean {
  // The demo slides and an edited slide use a picture suffix.
  return /\.(?:png|jpe?g|gif|webp)(?:$|\?)/i.test(url);
}

/**
 * Stubs fetch for one test.
 *
 * Purpose: a slide request gets a local PNG. Any other call throws and is recorded.
 * Inputs: none.
 * Side effects: replaces global fetch until restoreInstalledFetch runs.
 */
function installFetchStub(): void {
  // Start from an empty log so a previous test cannot satisfy this one.
  fetchCalls = [];
  fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL): Promise<Response> => {
    const url = requestUrl(input);
    // Record the address before answering, so a preview edit can assert the log stayed empty.
    fetchCalls.push(url);
    if (isImageRequest(url)) {
      // Slide bytes stay in the test. The assertion reads the img src attribute.
      return Promise.resolve(imageResponse());
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

/**
 * Restores fetch and drops the shell.
 *
 * Purpose: the next test mounts a fresh editor and the original fetch.
 * Inputs: none.
 * Side effects: unmounts the rendered tree and restores fetch.
 */
function cleanupEditor(): void {
  // Unmount before restoring fetch so a stray image load still sees the stub.
  cleanup();
  fetchSpy?.mockRestore();
  fetchSpy = null;
  fetchCalls = [];
}

/**
 * Builds the six-section demo configuration.
 *
 * Purpose: the behavior tests hydrate the same document the seed stores, without a network call.
 * Inputs: none.
 * Side effects: none.
 */
function demoConfiguration(): Configuration {
  let next = 0;
  /**
   * Issues the next fixture id.
   *
   * Purpose: give the demo factory ten stable ids.
   * Inputs: none.
   * Side effects: increments the counter.
   */
  function nextId(): string {
    // The number is part of the id. It is not a screen position.
    next += 1;
    return `demo-${next}`;
  }
  // The factory returns the portable document. The configuration fields are service-owned.
  return configurationSchema.parse({
    ...createDemoDocument(nextId),
    id: "cfg_demo",
    revision: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Builds a configuration from fixture sections.
 *
 * Purpose: the two-section key test can mount the demo's text blocks on their own.
 * Inputs: sections, the ordered sections.
 * Side effects: none. Throws when the sections are not a valid configuration.
 */
function configurationWith(sections: Section[]): Configuration {
  // id, revision, and updatedAt are the service fields the provider hydrates.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: "cfg_demo",
    revision: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Renders the shell from a configuration.
 *
 * Purpose: the provider copies the fixture into the draft once. The shell does not load it again.
 * Inputs: configuration, the document to hydrate.
 * Side effects: mounts the provider and the shell.
 */
function renderEditor(configuration: Configuration): ReturnType<typeof render> {
  // initialEtag is the strong validator. This render does not call the loader.
  return render(
    <EditorProvider initialConfiguration={configuration} initialEtag={'"1"'}>
      <EditorShell title="Editor" />
    </EditorProvider>,
  );
}

/**
 * Reads the phone rows in screen order.
 *
 * Purpose: order assertions follow the elements the preview list rendered.
 * Inputs: none.
 * Side effects: none. Throws when the phone list is missing.
 */
function previewItems(): HTMLElement[] {
  const list = document.querySelector(".preview-list");
  if (!(list instanceof HTMLElement)) {
    // The phone renders this list whenever the draft has a section.
    throw new Error("Missing preview list.");
  }
  const items: HTMLElement[] = [];
  for (const child of list.children) {
    if (child instanceof HTMLElement) {
      // Each child is one section preview, in draft order.
      items.push(child);
    }
  }
  return items;
}

/**
 * Reads the preview section ids in screen order.
 *
 * Purpose: the phone order is the draft array order.
 * Inputs: none.
 * Side effects: none. Throws when a row has no section id.
 */
function previewSectionIds(): string[] {
  const ids: string[] = [];
  for (const item of previewItems()) {
    const id = item.getAttribute("data-section-id");
    if (id === null) {
      // The row's attribute is the section id the phone rendered.
      throw new Error("A preview row is missing its section id.");
    }
    ids.push(id);
  }
  return ids;
}

/**
 * Counts preview rows of one class.
 *
 * Purpose: carousel, text, and button totals are visible in the phone.
 * Inputs: className, the preview class for that type.
 * Side effects: none.
 */
function previewCount(className: string): number {
  let count = 0;
  for (const item of previewItems()) {
    if (item.classList.contains(className)) {
      // One row of this type.
      count += 1;
    }
  }
  return count;
}

/**
 * Reads one phone block.
 *
 * Purpose: assertions stay on the section they edited.
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
 * Purpose: description assertions stay on that section's body.
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
 * Reads the preview button.
 *
 * Purpose: label and color assertions stay on that section's button.
 * Inputs: sectionId, the draft id.
 * Side effects: none. Throws when the button is missing.
 */
function previewButton(sectionId: string): HTMLButtonElement {
  const button = previewBlock(sectionId).querySelector(".preview-cta-button");
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing preview button for ${sectionId}.`);
  }
  return button;
}

/**
 * Reads the Open destination anchor.
 *
 * Purpose: the link href is the preview of the CTA URL.
 * Inputs: sectionId, the draft id.
 * Side effects: none. Throws when the anchor is missing.
 */
function openDestination(sectionId: string): HTMLAnchorElement {
  const link = previewBlock(sectionId).querySelector(".preview-cta-open");
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error(`Missing open destination for ${sectionId}.`);
  }
  return link;
}

/**
 * Reads the revealed destination line.
 *
 * Purpose: activating the preview button shows the draft URL as text.
 * Inputs: sectionId, the draft id.
 * Side effects: none. Throws when the line is missing.
 */
function destinationText(sectionId: string): string {
  const line = previewBlock(sectionId).querySelector(".preview-cta-destination");
  if (!(line instanceof HTMLElement)) {
    throw new Error(`Missing destination line for ${sectionId}.`);
  }
  return line.textContent ?? "";
}

/**
 * Reads the slide images for one carousel.
 *
 * Purpose: src and alt assertions stay on that carousel's frames.
 * Inputs: sectionId, the draft id.
 * Side effects: none.
 */
function slideImages(sectionId: string): HTMLImageElement[] {
  const images: HTMLImageElement[] = [];
  for (const node of previewBlock(sectionId).querySelectorAll("img")) {
    if (node instanceof HTMLImageElement) {
      // Document order is the slide order.
      images.push(node);
    }
  }
  return images;
}

/**
 * Reads the aspect-ratio frames for one carousel.
 *
 * Purpose: a ratio change is the CSS aspect-ratio on those frames.
 * Inputs: sectionId, the draft id.
 * Side effects: none.
 */
function frames(sectionId: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  for (const node of previewBlock(sectionId).querySelectorAll("[data-carousel-frame]")) {
    if (node instanceof HTMLElement) {
      // Each slide has one frame. The ratio is the inline style.
      found.push(node);
    }
  }
  return found;
}

/**
 * Reads a painted color as lowercase #rrggbb.
 *
 * Purpose: happy-dom may report the style as hex or as rgb().
 * Inputs: element, the painted node. property, color or backgroundColor.
 * Side effects: none.
 */
function paintColor(element: HTMLElement, property: "color" | "backgroundColor"): string {
  // Drop spaces so rgb(1, 2, 3) and rgb(1,2,3) share one pattern.
  const color = element.style[property].replaceAll(" ", "").toLowerCase();
  const match = /^rgba?\((\d+),(\d+),(\d+)/.exec(color);
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
 * Reads one labeled control.
 *
 * Purpose: repeated fields such as Image URL can be addressed by position within the selected section.
 * Inputs: label, the accessible name. index, which match to use when several share the name.
 * Side effects: none. Throws when that control is missing.
 */
function labeledControl(label: string, index = 0): HTMLElement {
  const controls = screen.getAllByLabelText(label);
  const control = controls[index];
  if (!(control instanceof HTMLElement)) {
    throw new Error(`Missing ${label} at ${index}.`);
  }
  return control;
}

/**
 * Reads the nth demo section of one type.
 *
 * Purpose: the two text blocks, two buttons, and two carousels keep their fixture identity.
 * Inputs: configuration, the hydrated document. type, the stored discriminator. occurrence, the zero-based match.
 * Side effects: none. Throws when that match is missing.
 */
function sectionAt(configuration: Configuration, type: Section["type"], occurrence: number): DraftSection {
  const matches = configuration.data.sections.filter((section) => section.type === type);
  const section = matches[occurrence];
  if (section === undefined) {
    throw new Error(`Missing ${type} section ${occurrence}.`);
  }
  return section;
}

/**
 * Reads one demo text section.
 *
 * Purpose: title and color assertions have the text fields.
 * Inputs: configuration, the hydrated document. occurrence, the zero-based text match.
 * Side effects: none. Throws when the match is not text.
 */
function textAt(configuration: Configuration, occurrence: number): DraftTextSection {
  const section = sectionAt(configuration, "text", occurrence);
  if (section.type !== "text") {
    throw new Error(`Section ${occurrence} is not text.`);
  }
  return section;
}

/**
 * Reads one demo button section.
 *
 * Purpose: label and color assertions have the CTA fields.
 * Inputs: configuration, the hydrated document. occurrence, the zero-based CTA match.
 * Side effects: none. Throws when the match is not a CTA.
 */
function ctaAt(configuration: Configuration, occurrence: number): DraftCtaSection {
  const section = sectionAt(configuration, "cta", occurrence);
  if (section.type !== "cta") {
    throw new Error(`Section ${occurrence} is not a button.`);
  }
  return section;
}

/**
 * Reads one demo carousel.
 *
 * Purpose: image and ratio assertions have the carousel fields.
 * Inputs: configuration, the hydrated document. occurrence, the zero-based carousel match.
 * Side effects: none. Throws when the match is not a carousel.
 */
function carouselAt(configuration: Configuration, occurrence: number): DraftCarouselSection {
  const section = sectionAt(configuration, "carousel", occurrence);
  if (section.type !== "carousel") {
    throw new Error(`Section ${occurrence} is not a carousel.`);
  }
  return section;
}

/**
 * Selects one section.
 *
 * Purpose: the inspector shows that row's fields. The preview already shows every row.
 * Inputs: user, the pointer session. section, the fixture row. Its hint is the name the button still has.
 * Side effects: clicks the row's select button.
 */
async function selectSection(user: EditorUser, section: DraftSection): Promise<void> {
  // The accessible name includes the label and the hint from this section object.
  await user.click(screen.getByRole("button", { name: sectionControlName("Select", section) }));
}

/**
 * Moves one section down one place.
 *
 * Purpose: reorder uses the drag handle's down arrow, the same keyboard control the author uses.
 * Inputs: user, the keyboard session. section, the fixture row. Its hint must still match the handle.
 * Side effects: focuses the handle and presses ArrowDown.
 */
async function moveSectionDown(user: EditorUser, section: DraftSection): Promise<void> {
  const handle = screen.getByRole("button", { name: sectionControlName("Reorder", section) });
  // The arrow handler is on the drag handle. One press swaps this section with the neighbor below it.
  handle.focus();
  await user.keyboard("{ArrowDown}");
}

/**
 * Replaces a control's value.
 *
 * Purpose: the keystrokes go through the input, and the preview reads the draft those keystrokes write.
 * Inputs: user, the pointer session. control, the input or textarea. value, the replacement.
 * Side effects: clears the control and types the value.
 */
async function replaceControl(user: EditorUser, control: HTMLElement, value: string): Promise<void> {
  // Remove the fixture characters so the typed value is the whole field.
  await user.clear(control);
  // Each character updates the draft. The preview assertion runs after the last one.
  await user.type(control, value);
}

/**
 * Asserts every supported field changes its own preview.
 *
 * Purpose: title, description, both text colors, CTA label, CTA URL, both CTA colors, an image URL, alt text, and aspect ratio are visible without a save.
 * Inputs: none.
 * Side effects: renders the demo screen and edits one field at a time.
 */
async function expectEachFieldToUpdateThePreview(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  const text = textAt(configuration, 0);
  const button = ctaAt(configuration, 0);
  const carousel = carouselAt(configuration, 0);
  renderEditor(configuration);
  await selectSection(user, text);
  await replaceControl(user, labeledControl("Title"), "Live title");
  // The phone title is the typed title.
  expect(previewTitle(text.id).textContent).toBe("Live title");
  await replaceControl(user, labeledControl("Description"), "Live description");
  // The phone body is the typed description.
  expect(previewDescription(text.id).textContent).toBe("Live description");
  await replaceControl(user, labeledControl("Title color"), "#010101");
  // The title paint is the typed color.
  expect(paintColor(previewTitle(text.id), "color")).toBe("#010101");
  await replaceControl(user, labeledControl("Description color"), "#020202");
  // The description paint is its own color.
  expect(paintColor(previewDescription(text.id), "color")).toBe("#020202");
  await selectSection(user, button);
  await replaceControl(user, labeledControl("Label"), "Live label");
  // The phone button text is the typed label.
  expect(previewButton(button.id).textContent).toBe("Live label");
  await replaceControl(user, labeledControl("Link"), "https://example.com/live");
  // The anchor is the preview of the URL before the button is activated.
  expect(openDestination(button.id).getAttribute("href")).toBe("https://example.com/live");
  await user.click(previewButton(button.id));
  // Activation shows that same URL as text and stays on this page.
  expect(destinationText(button.id)).toBe("Destination: https://example.com/live");
  await replaceControl(user, labeledControl("Button color"), "#030303");
  // The button background is the typed button color.
  expect(paintColor(previewButton(button.id), "backgroundColor")).toBe("#030303");
  await replaceControl(user, labeledControl("Label color"), "#040404");
  // The button label paint is the typed label color.
  expect(paintColor(previewButton(button.id), "color")).toBe("#040404");
  await selectSection(user, carousel);
  await replaceControl(user, labeledControl("Image URL"), "https://example.com/demo/live.jpg");
  // The first slide requests the typed URL. The second slide keeps its fixture URL.
  expect(slideImages(carousel.id)[0]?.getAttribute("src")).toBe("https://example.com/demo/live.jpg");
  expect(slideImages(carousel.id)[1]?.getAttribute("src")).toBe("https://example.com/demo/reading-table.jpg");
  await replaceControl(user, labeledControl("Alt text"), "Live alt text");
  // The first slide's accessible name is the typed alt. The second slide keeps its fixture alt.
  expect(slideImages(carousel.id)[0]?.getAttribute("alt")).toBe("Live alt text");
  expect(slideImages(carousel.id)[1]?.getAttribute("alt")).toBe("Front table stacked with featured books");
  await user.click(screen.getByRole("radio", { name: "Square" }));
  // Both frames of this carousel use the square ratio.
  expect(frames(carousel.id).map((frame) => frame.style.aspectRatio)).toEqual(["1 / 1", "1 / 1"]);
}

/**
 * Asserts editing the first text block leaves the second text block alone.
 *
 * Purpose: title, description, and both colors belong to the section that was edited.
 * Inputs: none.
 * Side effects: renders the demo screen and edits the first text block.
 */
async function expectTextSectionsToStayIndependent(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  const first = textAt(configuration, 0);
  const second = textAt(configuration, 1);
  renderEditor(configuration);
  await selectSection(user, first);
  await replaceControl(user, labeledControl("Title"), "Only the first title");
  await replaceControl(user, labeledControl("Description"), "Only the first description");
  await replaceControl(user, labeledControl("Title color"), "#010101");
  await replaceControl(user, labeledControl("Description color"), "#020202");
  // The edited block shows the new copy and colors.
  expect(previewTitle(first.id).textContent).toBe("Only the first title");
  expect(previewDescription(first.id).textContent).toBe("Only the first description");
  expect(paintColor(previewTitle(first.id), "color")).toBe("#010101");
  expect(paintColor(previewDescription(first.id), "color")).toBe("#020202");
  // The other text block still shows its fixture copy and colors.
  expect(previewTitle(second.id).textContent).toBe(second.title);
  expect(previewDescription(second.id).textContent).toBe(second.description);
  expect(paintColor(previewTitle(second.id), "color")).toBe(second.titleColor);
  expect(paintColor(previewDescription(second.id), "color")).toBe(second.descriptionColor);
  await selectSection(user, second);
  // The other block's fields are still the fixture values.
  expect(labeledControl("Title")).toHaveProperty("value", second.title);
  expect(labeledControl("Description")).toHaveProperty("value", second.description);
  expect(labeledControl("Title color")).toHaveProperty("value", second.titleColor);
  expect(labeledControl("Description color")).toHaveProperty("value", second.descriptionColor);
}

/**
 * Asserts editing the first button leaves the second button alone.
 *
 * Purpose: label, URL, and both colors belong to the section that was edited.
 * Inputs: none.
 * Side effects: renders the demo screen and edits the first button.
 */
async function expectCtaSectionsToStayIndependent(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  const first = ctaAt(configuration, 0);
  const second = ctaAt(configuration, 1);
  renderEditor(configuration);
  await selectSection(user, first);
  await replaceControl(user, labeledControl("Label"), "Only the first label");
  await replaceControl(user, labeledControl("Link"), "https://example.com/only-first");
  await replaceControl(user, labeledControl("Button color"), "#111111");
  await replaceControl(user, labeledControl("Label color"), "#eeeeee");
  // The edited button shows the new label, link, and colors.
  expect(previewButton(first.id).textContent).toBe("Only the first label");
  expect(openDestination(first.id).getAttribute("href")).toBe("https://example.com/only-first");
  expect(paintColor(previewButton(first.id), "backgroundColor")).toBe("#111111");
  expect(paintColor(previewButton(first.id), "color")).toBe("#eeeeee");
  // The other button still shows its fixture label, link, and colors.
  expect(previewButton(second.id).textContent).toBe(second.label);
  expect(openDestination(second.id).getAttribute("href")).toBe(second.url);
  expect(paintColor(previewButton(second.id), "backgroundColor")).toBe(second.backgroundColor);
  expect(paintColor(previewButton(second.id), "color")).toBe(second.labelColor);
  await selectSection(user, second);
  // The other button's fields are still the fixture values.
  expect(labeledControl("Label")).toHaveProperty("value", second.label);
  expect(labeledControl("Link")).toHaveProperty("value", second.url);
  expect(labeledControl("Button color")).toHaveProperty("value", second.backgroundColor);
  expect(labeledControl("Label color")).toHaveProperty("value", second.labelColor);
}

/**
 * Asserts editing the first carousel leaves the second carousel alone.
 *
 * Purpose: the image URL, the alt text, and the aspect ratio belong to the carousel that was edited.
 * Inputs: none.
 * Side effects: renders the demo screen and edits the first carousel.
 */
async function expectCarouselSectionsToStayIndependent(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  const first = carouselAt(configuration, 0);
  const second = carouselAt(configuration, 1);
  const secondImage = second.images[0];
  if (secondImage === undefined) {
    throw new Error("The second demo carousel has no slide.");
  }
  renderEditor(configuration);
  await selectSection(user, first);
  await replaceControl(user, labeledControl("Image URL"), "https://example.com/demo/only-first.jpg");
  await replaceControl(user, labeledControl("Alt text"), "Only the first alt");
  await user.click(screen.getByRole("radio", { name: "Square" }));
  // The edited carousel shows the new slide and the square frames.
  expect(slideImages(first.id)[0]?.getAttribute("src")).toBe("https://example.com/demo/only-first.jpg");
  expect(slideImages(first.id)[0]?.getAttribute("alt")).toBe("Only the first alt");
  expect(frames(first.id).map((frame) => frame.style.aspectRatio)).toEqual(["1 / 1", "1 / 1"]);
  // The other carousel still shows its fixture slides and portrait frames.
  expect(slideImages(second.id)[0]?.getAttribute("src")).toBe(secondImage.url);
  expect(slideImages(second.id)[0]?.getAttribute("alt")).toBe(secondImage.alt);
  expect(frames(second.id).map((frame) => frame.style.aspectRatio)).toEqual(["3 / 4", "3 / 4"]);
}

/**
 * Asserts the demo screen already shows two of each type.
 *
 * Purpose: the fixture is the evidence that one screen can hold two carousels, two text blocks, and two buttons.
 * Inputs: none.
 * Side effects: renders the demo screen.
 */
function expectTheFixtureToRenderTwoOfEachType(): void {
  const configuration = demoConfiguration();
  const firstText = textAt(configuration, 0);
  const secondText = textAt(configuration, 1);
  const firstButton = ctaAt(configuration, 0);
  const secondButton = ctaAt(configuration, 1);
  const firstCarousel = carouselAt(configuration, 0);
  const secondCarousel = carouselAt(configuration, 1);
  renderEditor(configuration);
  // The phone walks the fixture array. The ids are the section ids, in that order.
  expect(previewSectionIds()).toEqual(configuration.data.sections.map((section) => section.id));
  expect(previewCount("preview-carousel")).toBe(2);
  expect(previewCount("preview-text")).toBe(2);
  expect(previewCount("preview-cta")).toBe(2);
  // Each pair shows its own copy, not one shared preview.
  expect(previewTitle(firstText.id).textContent).toBe(firstText.title);
  expect(previewTitle(secondText.id).textContent).toBe(secondText.title);
  expect(previewButton(firstButton.id).textContent).toBe(firstButton.label);
  expect(previewButton(secondButton.id).textContent).toBe(secondButton.label);
  expect(slideImages(firstCarousel.id)[0]?.getAttribute("alt")).toBe(firstCarousel.images[0]?.alt);
  expect(frames(firstCarousel.id).map((frame) => frame.style.aspectRatio)).toEqual(["16 / 9", "16 / 9"]);
  expect(slideImages(secondCarousel.id)[0]?.getAttribute("alt")).toBe(secondCarousel.images[0]?.alt);
  expect(frames(secondCarousel.id).map((frame) => frame.style.aspectRatio)).toEqual(["3 / 4", "3 / 4"]);
}

/**
 * Asserts adding one more of each type raises the preview count.
 *
 * Purpose: the screen can hold more than the two of each type that the fixture already has.
 * Inputs: none.
 * Side effects: renders the demo screen and clicks the three add buttons.
 */
async function expectAddingOneMoreOfEachTypeToRaiseThePreviewCount(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  renderEditor(configuration);
  const before = previewSectionIds();
  // The fixture starts at two of each. The adds append a third.
  expect(previewCount("preview-carousel")).toBe(2);
  expect(previewCount("preview-text")).toBe(2);
  expect(previewCount("preview-cta")).toBe(2);
  await user.click(screen.getByRole("button", { name: "Add carousel" }));
  await user.click(screen.getByRole("button", { name: "Add text" }));
  await user.click(screen.getByRole("button", { name: "Add button" }));
  const after = previewSectionIds();
  const items = previewItems();
  const addedCarousel = items[6];
  const addedText = items[7];
  const addedButton = items[8];
  if (addedCarousel === undefined || addedText === undefined || addedButton === undefined) {
    throw new Error("The three added previews are missing.");
  }
  const addedTextId = addedText.getAttribute("data-section-id");
  const addedButtonId = addedButton.getAttribute("data-section-id");
  if (addedTextId === null || addedButtonId === null) {
    throw new Error("An added preview is missing its section id.");
  }
  // The original six stay in front. Three new rows follow them.
  expect(after.slice(0, before.length)).toEqual(before);
  expect(after).toHaveLength(9);
  expect(previewCount("preview-carousel")).toBe(3);
  expect(previewCount("preview-text")).toBe(3);
  expect(previewCount("preview-cta")).toBe(3);
  // Each new row is that type's own preview.
  expect(addedCarousel.classList.contains("preview-carousel")).toBe(true);
  expect(addedCarousel.textContent).toContain(EMPTY_CAROUSEL_MESSAGE);
  expect(previewTitle(addedTextId).textContent).toBe("Title");
  expect(previewButton(addedButtonId).textContent).toBe("Continue");
}

/**
 * Asserts moving one text block past the other keeps both blocks' copy and colors.
 *
 * Purpose: the phone order follows the draft array, and a move does not trade settings.
 * Inputs: none.
 * Side effects: renders the demo screen and presses ArrowDown on the first text block.
 */
async function expectMovingATextSectionToKeepItsCopy(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  const sections = configuration.data.sections;
  const firstText = textAt(configuration, 0);
  const secondText = textAt(configuration, 1);
  renderEditor(configuration);
  const firstNode = previewBlock(firstText.id);
  const secondNode = previewBlock(secondText.id);
  // The first text block starts at index 1. Three steps carry it past the second text block.
  await moveSectionDown(user, firstText);
  await moveSectionDown(user, firstText);
  await moveSectionDown(user, firstText);
  const carousel = sections[0];
  const firstButton = sections[2];
  const secondCarousel = sections[3];
  const lastButton = sections[5];
  if (
    carousel === undefined ||
    firstButton === undefined ||
    secondCarousel === undefined ||
    lastButton === undefined
  ) {
    throw new Error("The demo screen is missing a section.");
  }
  // The moved text block is now after the other text block. The other rows kept their relative order.
  expect(previewSectionIds()).toEqual([
    carousel.id,
    firstButton.id,
    secondCarousel.id,
    secondText.id,
    firstText.id,
    lastButton.id,
  ]);
  // The same preview nodes moved. Their copy and colors stayed on those nodes.
  expect(previewBlock(firstText.id)).toBe(firstNode);
  expect(previewBlock(secondText.id)).toBe(secondNode);
  expect(previewItems().indexOf(secondNode)).toBeLessThan(previewItems().indexOf(firstNode));
  expect(previewTitle(firstText.id).textContent).toBe(firstText.title);
  expect(previewDescription(firstText.id).textContent).toBe(firstText.description);
  expect(paintColor(previewTitle(firstText.id), "color")).toBe(firstText.titleColor);
  expect(paintColor(previewDescription(firstText.id), "color")).toBe(firstText.descriptionColor);
  expect(previewTitle(secondText.id).textContent).toBe(secondText.title);
  expect(previewDescription(secondText.id).textContent).toBe(secondText.description);
  expect(paintColor(previewTitle(secondText.id), "color")).toBe(secondText.titleColor);
  expect(paintColor(previewDescription(secondText.id), "color")).toBe(secondText.descriptionColor);
}

/**
 * Asserts an edit updates the preview when fetch throws.
 *
 * Purpose: the preview updates from the draft. The edit does not call fetch.
 * Inputs: none.
 * Side effects: renders the demo screen and types a title.
 */
async function expectAnEditToUpdateThePreviewWhenFetchThrows(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  const text = textAt(configuration, 0);
  renderEditor(configuration);
  await selectSection(user, text);
  await replaceControl(user, labeledControl("Title"), "Offline title");
  // The phone shows the typed title. fetch was not asked for a save or a reload.
  expect(previewTitle(text.id).textContent).toBe("Offline title");
  expect(previewDescription(text.id).textContent).toBe(text.description);
  expect(fetchCalls).toEqual([]);
}

/**
 * Asserts reordering two sections moves their preview nodes and their input values together.
 *
 * Purpose: the preview key is the section id. An index key would leave the first row's node in place with the other section's copy.
 * Inputs: none.
 * Side effects: renders the demo's two text blocks, types into both, and presses ArrowDown.
 */
async function expectPreviewKeysToMoveInputValuesWithTheSections(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  const texts = configuration.data.sections.filter((section) => section.type === "text");
  const first = texts[0];
  const second = texts[1];
  if (first === undefined || second === undefined || first.type !== "text" || second.type !== "text") {
    throw new Error("The demo document is missing its two text blocks.");
  }
  renderEditor(configurationWith([first, second]));
  await replaceControl(user, labeledControl("Title"), "Alpha title");
  await replaceControl(user, labeledControl("Description"), "Alpha body");
  await replaceControl(user, labeledControl("Title color"), "#010101");
  await replaceControl(user, labeledControl("Description color"), "#101010");
  // Alpha stays selected until Beta is chosen. The second row still has its fixture title.
  await user.click(screen.getByRole("button", { name: "Select Text, From the floor" }));
  await replaceControl(user, labeledControl("Title"), "Beta title");
  await replaceControl(user, labeledControl("Description"), "Beta body");
  await replaceControl(user, labeledControl("Title color"), "#020202");
  await replaceControl(user, labeledControl("Description color"), "#202020");
  await user.click(screen.getByRole("button", { name: "Select Text, Alpha title" }));
  const titleInput = labeledControl("Title");
  const descriptionInput = labeledControl("Description");
  const titleColorInput = labeledControl("Title color");
  const descriptionColorInput = labeledControl("Description color");
  const alphaNode = previewBlock(first.id);
  const betaNode = previewBlock(second.id);
  // Alpha is selected and first. Its inputs hold the values just typed.
  expect(titleInput).toHaveProperty("value", "Alpha title");
  expect(descriptionInput).toHaveProperty("value", "Alpha body");
  expect(titleColorInput).toHaveProperty("value", "#010101");
  expect(descriptionColorInput).toHaveProperty("value", "#101010");
  const reorder = screen.getByRole("button", { name: "Reorder Text, Alpha title" });
  reorder.focus();
  await user.keyboard("{ArrowDown}");
  // The same nodes traded places. Alpha's copy is on Alpha's node, now in the second row.
  expect(previewItems()[0]).toBe(betaNode);
  expect(previewItems()[1]).toBe(alphaNode);
  expect(previewBlock(first.id)).toBe(alphaNode);
  expect(previewBlock(second.id)).toBe(betaNode);
  expect(previewTitle(first.id).textContent).toBe("Alpha title");
  expect(previewDescription(first.id).textContent).toBe("Alpha body");
  expect(paintColor(previewTitle(first.id), "color")).toBe("#010101");
  expect(paintColor(previewDescription(first.id), "color")).toBe("#101010");
  expect(previewTitle(second.id).textContent).toBe("Beta title");
  expect(previewDescription(second.id).textContent).toBe("Beta body");
  expect(paintColor(previewTitle(second.id), "color")).toBe("#020202");
  expect(paintColor(previewDescription(second.id), "color")).toBe("#202020");
  // Alpha stayed selected, so its inputs moved with that section rather than showing Beta's values.
  expect(labeledControl("Title")).toBe(titleInput);
  expect(titleInput).toHaveProperty("value", "Alpha title");
  expect(descriptionInput).toHaveProperty("value", "Alpha body");
  expect(titleColorInput).toHaveProperty("value", "#010101");
  expect(descriptionColorInput).toHaveProperty("value", "#101010");
  await user.click(screen.getByRole("button", { name: "Select Text, Beta title" }));
  // Beta's row now shows Beta's typed values.
  expect(labeledControl("Title")).toHaveProperty("value", "Beta title");
  expect(labeledControl("Description")).toHaveProperty("value", "Beta body");
  expect(labeledControl("Title color")).toHaveProperty("value", "#020202");
  expect(labeledControl("Description color")).toHaveProperty("value", "#202020");
}

/**
 * Registers the live-preview cases.
 *
 * Purpose: each case locks one editor behavior from this prompt.
 * Inputs: none.
 * Side effects: registers the fetch stub and the vitest cases.
 */
function registerLivePreviewCases(): void {
  // Image requests resolve locally. Any other fetch throws and is recorded.
  beforeEach(installFetchStub);
  afterEach(cleanupEditor);
  // Typing through every field takes about 3s alone and can pass the 5s default while the service suite runs.
  it("updates the visible preview when each supported field changes", expectEachFieldToUpdateThePreview, 20_000);
  it("keeps the second text section unchanged when the first text section is edited", expectTextSectionsToStayIndependent);
  it("keeps the second button unchanged when the first button is edited", expectCtaSectionsToStayIndependent);
  it("keeps the second carousel unchanged when the first carousel is edited", expectCarouselSectionsToStayIndependent);
  it("renders two of each section type from the demo fixture", expectTheFixtureToRenderTwoOfEachType);
  it("shows three of each section type after adding one more", expectAddingOneMoreOfEachTypeToRaiseThePreviewCount);
  it("moves a text section past the other and keeps each section's copy", expectMovingATextSectionToKeepItsCopy);
  it("updates the preview when fetch throws and does not call fetch", expectAnEditToUpdateThePreviewWhenFetchThrows);
  it("moves preview nodes and input values with their section ids", expectPreviewKeysToMoveInputValuesWithTheSections);
}

describe("live preview", registerLivePreviewCases);
