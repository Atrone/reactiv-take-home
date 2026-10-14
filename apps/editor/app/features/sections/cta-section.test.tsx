// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configurationSchema, SUPPORTED_SCHEMA_VERSION, type Configuration, type Section } from "@reactiv/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorShell } from "../editor/editor-shell.js";
import { EditorProvider } from "../editor/editor-context.js";
import type { DraftCtaSection } from "../editor/draft-document.js";
import { CtaInspector } from "./cta-inspector.js";
import { CtaPreview } from "./cta-preview.js";
import {
  BUTTON_COLOR_ERROR,
  DEFAULT_CTA_BACKGROUND_COLOR,
  DEFAULT_CTA_LABEL_COLOR,
  LABEL_COLOR_ERROR,
  LABEL_REQUIRED_ERROR,
  LINK_ERROR,
  OPEN_DESTINATION_LABEL,
  destinationLine,
} from "./cta-fields.js";
import { sectionUiRegistry } from "./section-ui-registry.js";
import { LOW_CONTRAST_WARNING } from "./text-contrast.js";

/**
 * Builds a button section for a fixture.
 *
 * Purpose: each test can choose its own label, link, and colors.
 * Inputs: id, the section id. label, the button label. url, the destination.
 * backgroundColor and labelColor, schema hex colors.
 * Side effects: none.
 */
function ctaSection(
  id: string,
  label: string,
  url: string,
  backgroundColor = "#112233",
  labelColor = "#ffffff",
): Section {
  // The colors and URL are valid so the configuration schema can hydrate the provider.
  return {
    id,
    type: "cta",
    label,
    url,
    backgroundColor,
    labelColor,
  };
}

/**
 * Wraps fixture sections in a configuration.
 *
 * Purpose: the provider hydrates from the same shape the loader returns, without a network call.
 * Inputs: sections, the ordered sections.
 * Side effects: none. Throws when the sections are not a valid configuration.
 */
function ctaConfiguration(sections: Section[]): Configuration {
  // id, revision, and updatedAt are service-owned fields the hydrate command expects.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: "cfg_cta",
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
  const configuration = ctaConfiguration(sections);
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
 * Purpose: assertions can tell two buttons apart.
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
 * Reads the preview button for one CTA.
 *
 * Purpose: click and text assertions stay on that section's button.
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
 * Reads the revealed destination line, or null when the button has not been activated.
 *
 * Purpose: URL assertions can tell a hidden destination from the visible sentence.
 * Inputs: sectionId, the draft id.
 * Side effects: none.
 */
function previewDestination(sectionId: string): HTMLElement | null {
  const destination = previewBlock(sectionId).querySelector(".preview-cta-destination");
  if (destination === null) {
    return null;
  }
  if (!(destination instanceof HTMLElement)) {
    throw new Error(`Missing destination element for ${sectionId}.`);
  }
  return destination;
}

/**
 * Reads the Open destination anchor, or null when the URL is not an absolute HTTP(S) URL.
 *
 * Purpose: navigation assertions stay on that section's anchor.
 * Inputs: sectionId, the draft id.
 * Side effects: none.
 */
function openDestination(sectionId: string): HTMLAnchorElement | null {
  const link = previewBlock(sectionId).querySelector(".preview-cta-open");
  if (link === null) {
    return null;
  }
  if (!(link instanceof HTMLAnchorElement)) {
    throw new Error(`Missing open destination for ${sectionId}.`);
  }
  return link;
}

/**
 * Reads a painted color as lowercase #rrggbb.
 *
 * Purpose: happy-dom may report the style as hex or as rgb().
 * Inputs: element, the preview button. property, color or backgroundColor.
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

/** One window.open request recorded by the test. */
type OpenCall = {
  url: string;
  target: string;
  features: string;
};

/**
 * Replaces window.open with a recorder that does not load the URL.
 *
 * Purpose: the anchor calls the document window's open. Assigning the method is the call that window runs.
 * Inputs: none.
 * Side effects: replaces window.open until restore runs.
 */
function recordWindowOpen(): { calls: OpenCall[]; restore: () => void } {
  const calls: OpenCall[] = [];
  const originalOpen = window.open;
  /**
   * Stores an open request and does not load the address.
   *
   * Purpose: the test can see the target and features without leaving the page.
   * Inputs: url, target, and features from the anchor activation.
   * Side effects: appends one call.
   */
  function recordOpen(url?: string | URL, target?: string, features?: string): null {
    // Keep the arguments the anchor passed. Return null so no window is created.
    calls.push({
      url: String(url ?? ""),
      target: target ?? "",
      features: features ?? "",
    });
    return null;
  }
  // Assignment updates the document window. The anchor reads that method.
  window.open = recordOpen;
  if (window.open !== recordOpen) {
    throw new Error("window.open was not replaced.");
  }
  /**
   * Puts the previous window.open back.
   *
   * Purpose: later tests see the browser method.
   * Inputs: none.
   * Side effects: restores window.open.
   */
  function restore(): void {
    // The previous method is the one the environment installed.
    window.open = originalOpen;
  }
  return { calls, restore };
}

/**
 * Asserts a control points at one message, or at none.
 *
 * Purpose: the field error and the contrast warning belong to the input that shows them.
 * Inputs: control, the field. message, the visible sentence, or null when the field has no description.
 * Side effects: none.
 */
function expectControlDescription(control: HTMLElement, message: string | null): void {
  const describedBy = control.getAttribute("aria-describedby");
  if (message === null) {
    // A valid field with nothing else to announce has no description.
    expect(describedBy).toBeNull();
    return;
  }
  if (describedBy === null) {
    throw new Error(`Expected a description id for ${message}.`);
  }
  const ids = describedBy.split(" ");
  const texts: string[] = [];
  for (const id of ids) {
    // Each id points at one visible sentence.
    const text = document.getElementById(id)?.textContent;
    if (text !== undefined) {
      texts.push(text);
    }
  }
  expect(texts).toContain(message);
}

/**
 * Asserts editing the label updates that preview button and leaves the other button alone.
 *
 * Purpose: the draft label is the button text, and a second CTA does not share it.
 * Inputs: none.
 * Side effects: renders the shell and types a label.
 */
async function expectEditingTheLabelToUpdateThePreviewButton(): Promise<void> {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  try {
    renderEditor([
      ctaSection("first", "First label", "https://example.com/first", "#112233", "#ffffff"),
      ctaSection("second", "Second label", "https://example.com/second", "#123456", "#eeeeee"),
    ]);
    const label = screen.getByLabelText("Label");
    await user.clear(label);
    await user.type(label, "Shop the sale");
    // The first button follows the input. The second button keeps its own label.
    expect(label.tagName).toBe("INPUT");
    expect(label).toHaveProperty("value", "Shop the sale");
    expect(previewButton("first").textContent).toBe("Shop the sale");
    expect(previewButton("second").textContent).toBe("Second label");
    expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/first");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    fetchSpy.mockRestore();
  }
}

/**
 * Asserts editing the URL updates the revealed destination and leaves the other CTA alone.
 *
 * Purpose: each button reveals its own draft URL, and the other button's link and colors stay.
 * Inputs: none.
 * Side effects: renders the shell, reveals both destinations, and types a URL.
 */
async function expectEditingTheUrlToUpdateTheRevealedDestination(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("first", "First label", "https://example.com/first", "#112233", "#ffffff"),
    ctaSection("second", "Second label", "https://example.com/second", "#123456", "#eeeeee"),
  ]);
  await user.click(previewButton("first"));
  await user.click(previewButton("second"));
  // Each preview shows the URL that belongs to that section.
  expect(previewDestination("first")?.textContent).toBe(destinationLine("https://example.com/first"));
  expect(previewDestination("second")?.textContent).toBe(destinationLine("https://example.com/second"));
  const link = screen.getByLabelText("Link");
  await user.clear(link);
  await user.type(link, "https://example.com/sale");
  const firstOpen = openDestination("first");
  const secondOpen = openDestination("second");
  // The first destination and its anchor follow the input. The second CTA is unchanged.
  expect(link).toHaveProperty("value", "https://example.com/sale");
  expect(previewDestination("first")?.textContent).toBe(destinationLine("https://example.com/sale"));
  expect(firstOpen?.getAttribute("href")).toBe("https://example.com/sale");
  expect(firstOpen?.getAttribute("target")).toBe("_blank");
  expect(firstOpen?.getAttribute("rel")).toBe("noreferrer");
  expect(firstOpen?.textContent).toBe(OPEN_DESTINATION_LABEL);
  expect(previewButton("first").textContent).toBe("First label");
  expect(previewDestination("second")?.textContent).toBe(destinationLine("https://example.com/second"));
  expect(secondOpen?.getAttribute("href")).toBe("https://example.com/second");
  expect(previewButton("second").textContent).toBe("Second label");
  expect(paintColor(previewButton("second"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("second"), "color")).toBe("#eeeeee");
  await user.click(screen.getByRole("button", { name: "Select Button, Second label" }));
  // The second inspector still has its own link and label.
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/second");
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "Second label");
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#123456");
  expect(screen.getByLabelText("Label color")).toHaveProperty("value", "#eeeeee");
}

/**
 * Asserts two different valid hex colors are painted on the same button.
 *
 * Purpose: button color and label color are independent, including from the other CTA.
 * Inputs: none.
 * Side effects: renders the shell and types both colors.
 */
async function expectBothColorsToPaintOnTheButton(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("first", "First label", "https://example.com/first", "#112233", "#ffffff"),
    ctaSection("second", "Second label", "https://example.com/second", "#123456", "#eeeeee"),
  ]);
  const buttonColor = screen.getByLabelText("Button color");
  const labelColor = screen.getByLabelText("Label color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#010101");
  await user.clear(labelColor);
  await user.type(labelColor, "#abcdef");
  const button = previewButton("first");
  // Both colors are on this button. The draft keeps the typed strings, and the other CTA stays.
  expect(buttonColor).toHaveProperty("value", "#010101");
  expect(labelColor).toHaveProperty("value", "#abcdef");
  expect(button.getAttribute("type")).toBe("button");
  expect(paintColor(button, "backgroundColor")).toBe("#010101");
  expect(paintColor(button, "color")).toBe("#abcdef");
  expect(button.style.backgroundColor).not.toBe("");
  expect(button.style.color).not.toBe("");
  expect(paintColor(previewButton("second"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("second"), "color")).toBe("#eeeeee");
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
}

/**
 * Asserts clicking the preview button reveals the URL and leaves the location unchanged.
 *
 * Purpose: the preview control is not a link, so the editor page stays where it is.
 * Inputs: none.
 * Side effects: renders the shell and clicks the preview button.
 */
async function expectClickingThePreviewButtonToKeepTheLocation(): Promise<void> {
  const user = userEvent.setup();
  const href = window.location.href;
  const opened = recordWindowOpen();
  let assignCalls = 0;
  const locationWithAssign = window.location as Location & { assign: (url: string) => void };
  const originalAssign = locationWithAssign.assign;
  /**
   * Records an attempt to navigate the current page.
   *
   * Purpose: the preview button must not call location.assign.
   * Inputs: url, the address a navigation would have used.
   * Side effects: increments the call count.
   */
  function recordAssign(url: string | URL): void {
    // Count the call and ignore the address. The button must not reach this function.
    void url;
    assignCalls += 1;
  }
  locationWithAssign.assign = recordAssign;
  // The replacement has to be the function a navigation would call.
  expect(locationWithAssign.assign).toBe(recordAssign);
  try {
    renderEditor([ctaSection("stay", "Stay here", "https://example.com/sale")]);
    const button = previewButton("stay");
    await user.click(button);
    // The page address is the same. The destination is text inside the preview.
    expect(window.location.href).toBe(href);
    expect(assignCalls).toBe(0);
    expect(opened.calls).toEqual([]);
    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("type")).toBe("button");
    expect(button.closest("a")).toBeNull();
    expect(previewDestination("stay")?.textContent).toBe(destinationLine("https://example.com/sale"));
    expect(previewDestination("stay")?.querySelector("a")).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    expect(screen.getByLabelText("Label")).toHaveProperty("value", "Stay here");
    expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
  } finally {
    locationWithAssign.assign = originalAssign;
    opened.restore();
  }
}

/**
 * Asserts notaurl stays in the link field and the anchor is omitted.
 *
 * Purpose: an invalid URL is draft text. It does not reset the input or the other fields.
 * Inputs: none.
 * Side effects: renders the shell and types notaurl.
 */
async function expectNotaurlToRemainInTheLinkInput(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("first", "First label", "https://example.com/first", "#112233", "#ffffff"),
    ctaSection("second", "Second label", "https://example.com/second", "#123456", "#eeeeee"),
  ]);
  const link = screen.getByLabelText("Link");
  await user.click(previewButton("first"));
  await user.clear(link);
  await user.type(link, "notaurl");
  // The input is the invalid string. The button remains, and the new-tab anchor does not.
  expect(link).toHaveProperty("value", "notaurl");
  expect(link.getAttribute("type")).toBe("text");
  expect(link.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(LINK_ERROR)).toBeTruthy();
  expectControlDescription(link, LINK_ERROR);
  expect(previewButton("first").textContent).toBe("First label");
  expect(previewDestination("first")?.textContent).toBe(destinationLine("notaurl"));
  expect(openDestination("first")).toBeNull();
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "First label");
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#112233");
  expect(screen.getByLabelText("Label color")).toHaveProperty("value", "#ffffff");
  expect(openDestination("second")?.getAttribute("href")).toBe("https://example.com/second");
  expect(previewButton("second").textContent).toBe("Second label");
}

/**
 * Asserts markup in the label is visible text and not an element.
 *
 * Purpose: the preview button uses a React text node, so an image tag cannot run.
 * Inputs: none.
 * Side effects: renders the shell and types the markup into the label.
 */
async function expectMarkupInTheLabelToStayText(): Promise<void> {
  const user = userEvent.setup();
  const markup = "<img src=x onerror=alert(1)>";
  renderEditor([ctaSection("html", "Before", "https://example.com/sale")]);
  const label = screen.getByLabelText("Label");
  await user.clear(label);
  await user.type(label, markup);
  const button = previewButton("html");
  const phone = document.querySelector(".phone-screen");
  // The characters are the button text. The phone does not gain an image or a script.
  expect(label).toHaveProperty("value", markup);
  expect(button.textContent).toBe(markup);
  expect(button.childNodes).toHaveLength(1);
  expect(button.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
  expect(button.querySelector("img")).toBeNull();
  expect(phone?.querySelector("img")).toBeNull();
  expect(phone?.querySelector("script")).toBeNull();
}

/**
 * Asserts a blank label shows an inline error and does not throw.
 *
 * Purpose: a blank label keeps the link and both colors. A label with text clears the error, including when it has surrounding spaces.
 * Inputs: none.
 * Side effects: renders the shell and clears the label.
 */
async function expectABlankLabelToShowAnInlineError(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([ctaSection("blank", "Before", "https://example.com/sale", "#112233", "#ffffff")]);
  const label = screen.getByLabelText("Label");
  await user.clear(label);
  await user.type(label, "   ");
  // Spaces are not a label. The button shows them, and the other fields stay.
  expect(label).toHaveProperty("value", "   ");
  expect(label.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(LABEL_REQUIRED_ERROR)).toBeTruthy();
  expectControlDescription(label, LABEL_REQUIRED_ERROR);
  expect(previewButton("blank").textContent).toBe("   ");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#112233");
  expect(screen.getByLabelText("Label color")).toHaveProperty("value", "#ffffff");
  expect(screen.getByRole("button", { name: "Select Button, Untitled button" })).toBeTruthy();
  await user.clear(label);
  await user.paste("\t");
  // A tab is blank after trimming. The link is still the original URL.
  expect(label).toHaveProperty("value", "\t");
  expect(screen.getByText(LABEL_REQUIRED_ERROR)).toBeTruthy();
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
  await user.clear(label);
  await user.type(label, "  Shop  ");
  // Surrounding spaces are kept on the button, and the trimmed label is not an error.
  expect(label).toHaveProperty("value", "  Shop  ");
  expect(label.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(LABEL_REQUIRED_ERROR)).toBeNull();
  expectControlDescription(label, null);
  expect(previewButton("blank").textContent).toBe("  Shop  ");
  await user.clear(label);
  await user.type(label, "Shop");
  // Typing a label removes the error and leaves the link and colors in place.
  expect(label).toHaveProperty("value", "Shop");
  expect(screen.queryByText(LABEL_REQUIRED_ERROR)).toBeNull();
  expect(previewButton("blank").textContent).toBe("Shop");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
  expect(paintColor(previewButton("blank"), "backgroundColor")).toBe("#112233");
  expect(paintColor(previewButton("blank"), "color")).toBe("#ffffff");
}

/**
 * Asserts a low-contrast pair warns and does not reject the colors.
 *
 * Purpose: the warning compares the label color with the button color and leaves both values in place.
 * Inputs: none.
 * Side effects: renders the shell and types a white button color.
 */
async function expectLowContrastToWarnWithoutRejectingTheColors(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("contrast", "Shop", "https://example.com/sale", "#112233", "#ffffff"),
    ctaSection("other", "Other", "https://example.com/other", "#123456", "#eeeeee"),
  ]);
  const buttonColor = screen.getByLabelText("Button color");
  const labelColor = screen.getByLabelText("Label color");
  // White on the default navy button is above 4.5:1, so the warning is absent.
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
  expect(buttonColor.getAttribute("aria-invalid")).toBe("false");
  expect(labelColor.getAttribute("aria-invalid")).toBe("false");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#ffffff");
  // White on white warns. Both colors stay, and the other CTA is unchanged.
  expect(buttonColor).toHaveProperty("value", "#ffffff");
  expect(labelColor).toHaveProperty("value", "#ffffff");
  expect(screen.getByText(LOW_CONTRAST_WARNING)).toBeTruthy();
  expect(buttonColor.getAttribute("aria-invalid")).toBe("false");
  expect(labelColor.getAttribute("aria-invalid")).toBe("false");
  expectControlDescription(labelColor, LOW_CONTRAST_WARNING);
  expectControlDescription(buttonColor, LOW_CONTRAST_WARNING);
  expect(paintColor(previewButton("contrast"), "backgroundColor")).toBe("#ffffff");
  expect(paintColor(previewButton("contrast"), "color")).toBe("#ffffff");
  expect(screen.queryByText(BUTTON_COLOR_ERROR)).toBeNull();
  expect(screen.queryByText(LABEL_COLOR_ERROR)).toBeNull();
  expect(paintColor(previewButton("other"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("other"), "color")).toBe("#eeeeee");
  await user.clear(labelColor);
  await user.type(labelColor, "#000000");
  // Black on white is above 4.5:1. The warning goes away and the button color stays white.
  expect(labelColor).toHaveProperty("value", "#000000");
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
  expect(paintColor(previewButton("contrast"), "backgroundColor")).toBe("#ffffff");
  expect(paintColor(previewButton("contrast"), "color")).toBe("#000000");
}

/**
 * Asserts an incomplete color stays in its input and the preview keeps the previous paint.
 *
 * Purpose: "#" and "#12" are draft text. They do not reset the control or the other CTA.
 * Inputs: none.
 * Side effects: renders the shell and types incomplete colors.
 */
async function expectAnIncompleteColorToKeepThePreviousPaint(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("paint", "Kept label", "https://example.com/sale", "#112233", "#ffffff"),
    ctaSection("other", "Other label", "https://example.com/other", "#123456", "#eeeeee"),
  ]);
  const buttonColor = screen.getByLabelText("Button color");
  const labelColor = screen.getByLabelText("Label color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#010101");
  await user.clear(labelColor);
  await user.type(labelColor, "#abcdef");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#");
  // The button color input is the raw hash. Its paint stays on the previous valid color.
  expect(buttonColor).toHaveProperty("value", "#");
  expect(buttonColor.getAttribute("type")).toBe("text");
  expect(buttonColor.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(BUTTON_COLOR_ERROR)).toBeTruthy();
  expect(paintColor(previewButton("paint"), "backgroundColor")).toBe("#010101");
  expect(paintColor(previewButton("paint"), "color")).toBe("#abcdef");
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
  await user.clear(labelColor);
  await user.type(labelColor, "#12");
  // The label color is still incomplete. The link and the other CTA stay.
  expect(labelColor).toHaveProperty("value", "#12");
  expect(screen.getByText(LABEL_COLOR_ERROR)).toBeTruthy();
  expect(paintColor(previewButton("paint"), "color")).toBe("#abcdef");
  expect(paintColor(previewButton("paint"), "backgroundColor")).toBe("#010101");
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "Kept label");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
  expect(paintColor(previewButton("other"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("other"), "color")).toBe("#eeeeee");
}

/**
 * Asserts a button that has never had a valid color uses the defaults.
 *
 * Purpose: "#" and "#12" paint #112233 and #ffffff when there is no earlier valid color.
 * Inputs: none.
 * Side effects: renders the preview only. The schema cannot hydrate these strings.
 */
function expectInvalidInitialColorsToUseTheDefaults(): void {
  const section: DraftCtaSection = {
    id: "raw",
    type: "cta",
    label: "Visible",
    url: "notaurl",
    backgroundColor: "#",
    labelColor: "#12",
  };
  // The list item can render without the provider because the preview does not dispatch.
  render(
    <ol>
      <CtaPreview section={section} />
    </ol>,
  );
  const button = previewButton("raw");
  // The defaults are the paint colors. The invalid URL has no new-tab anchor.
  expect(button.textContent).toBe("Visible");
  expect(paintColor(button, "backgroundColor")).toBe(DEFAULT_CTA_BACKGROUND_COLOR);
  expect(paintColor(button, "color")).toBe(DEFAULT_CTA_LABEL_COLOR);
  expect(openDestination("raw")).toBeNull();
  expect(previewDestination("raw")).toBeNull();
}

/**
 * Asserts the preview button does not submit a surrounding form.
 *
 * Purpose: type="button" keeps a click, Enter, and Space from submitting a form.
 * Inputs: none.
 * Side effects: renders the preview inside a form and clicks the button.
 */
async function expectThePreviewButtonNotToSubmitAForm(): Promise<void> {
  const user = userEvent.setup();
  const submitSpy = vi.fn();
  const section: DraftCtaSection = {
    id: "form",
    type: "cta",
    label: "Submit me",
    url: "https://example.com/sale",
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  };
  const href = window.location.href;
  render(
    <form onSubmit={submitSpy}>
      <ol>
        <CtaPreview section={section} />
      </ol>
    </form>,
  );
  const button = previewButton("form");
  await user.click(button);
  button.focus();
  await user.keyboard("{Enter}");
  await user.keyboard(" ");
  // Click, Enter, and Space reveal the URL. None of them submit the form.
  expect(submitSpy).not.toHaveBeenCalled();
  expect(window.location.href).toBe(href);
  expect(button.getAttribute("type")).toBe("button");
  expect(previewDestination("form")?.textContent).toBe(destinationLine("https://example.com/sale"));
}

/**
 * Asserts the static registry points the button at the CTA components.
 *
 * Purpose: carousel stays a placeholder, and the button is not that placeholder.
 * Inputs: none.
 * Side effects: none.
 */
function expectTheRegistryToRegisterTheCta(): void {
  // The keys are the three stored types. The button entry is the CTA components.
  expect(Object.keys(sectionUiRegistry)).toEqual(["carousel", "text", "cta"]);
  expect(sectionUiRegistry.cta.Inspector).toBe(CtaInspector);
  expect(sectionUiRegistry.cta.Preview).toBe(CtaPreview);
  expect(sectionUiRegistry.carousel.Inspector).not.toBe(CtaInspector);
  expect(sectionUiRegistry.carousel.Preview).not.toBe(CtaPreview);
}

/**
 * Builds a CTA the preview can render without the configuration schema.
 *
 * Purpose: an incomplete color cannot be hydrated, and a rerender can change the section id.
 * Inputs: id, the section id. backgroundColor and labelColor, the raw draft strings.
 * Side effects: none.
 */
function rawCta(id: string, backgroundColor: string, labelColor: string): DraftCtaSection {
  // The label is the id so a rerender is visible in the button text.
  return {
    id,
    type: "cta",
    label: id,
    url: "https://example.com/sale",
    backgroundColor,
    labelColor,
  };
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
      <CtaPreview section={rawCta("a", "#010101", "#abcdef")} />
    </ol>,
  );
  // The first section paints the valid colors it was given.
  expect(paintColor(previewButton("a"), "backgroundColor")).toBe("#010101");
  expect(paintColor(previewButton("a"), "color")).toBe("#abcdef");
  view.rerender(
    <ol>
      <CtaPreview section={rawCta("a", "#", "#12")} />
    </ol>,
  );
  // The same section keeps those colors while the draft strings are incomplete.
  expect(paintColor(previewButton("a"), "backgroundColor")).toBe("#010101");
  expect(paintColor(previewButton("a"), "color")).toBe("#abcdef");
  view.rerender(
    <ol>
      <CtaPreview section={rawCta("b", "#", "#12")} />
    </ol>,
  );
  // A different section does not inherit that memory. Neither field has been valid yet.
  expect(document.querySelector('[data-section-id="a"]')).toBeNull();
  expect(paintColor(previewButton("b"), "backgroundColor")).toBe(DEFAULT_CTA_BACKGROUND_COLOR);
  expect(paintColor(previewButton("b"), "color")).toBe(DEFAULT_CTA_LABEL_COLOR);
}

/**
 * Asserts a shorthand button color stays in the input and expands only in the paint.
 *
 * Purpose: #RGB is valid, and the draft is not rewritten to six digits.
 * Inputs: none.
 * Side effects: renders the shell and types a shorthand color.
 */
async function expectAShorthandButtonColorToStayInTheInput(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([ctaSection("short", "Shop", "https://example.com/sale", "#112233", "#ffffff")]);
  const buttonColor = screen.getByLabelText("Button color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#abc");
  // The input is the shorthand. The paint is #aabbcc, and the label color is a different field.
  expect(buttonColor).toHaveProperty("value", "#abc");
  expect(buttonColor.getAttribute("aria-invalid")).toBe("false");
  expect(paintColor(previewButton("short"), "backgroundColor")).toBe("#aabbcc");
  expect(screen.getByLabelText("Label color")).toHaveProperty("value", "#ffffff");
  expect(paintColor(previewButton("short"), "color")).toBe("#ffffff");
  expect(screen.queryByText(BUTTON_COLOR_ERROR)).toBeNull();
}

/**
 * Asserts an empty link is unfinished and omits the anchor.
 *
 * Purpose: clearing the link keeps the previous destination text once revealed, and does not name an error.
 * Inputs: none.
 * Side effects: renders the shell, reveals the destination, and clears the link.
 */
async function expectAnEmptyLinkToOmitTheAnchor(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([ctaSection("link", "Shop", "https://example.com/sale")]);
  await user.click(previewButton("link"));
  const link = screen.getByLabelText("Link");
  await user.clear(link);
  // The field is blank, so there is no URL error. The button remains and the anchor does not.
  expect(link).toHaveProperty("value", "");
  expect(link.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(LINK_ERROR)).toBeNull();
  expectControlDescription(link, null);
  expect(openDestination("link")).toBeNull();
  expect(previewButton("link").textContent).toBe("Shop");
  expect(previewDestination("link")?.textContent).toBe(destinationLine(""));
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "Shop");
}

/**
 * Asserts the contrast warning uses the button color as the background.
 *
 * Purpose: a dark label on a dark button warns, and the same label on white does not.
 * Inputs: none.
 * Side effects: renders the shell and types both colors.
 */
async function expectContrastToFollowTheButtonColor(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("contrast", "Shop", "https://example.com/sale", "#112233", "#ffffff"),
    ctaSection("other", "Other", "https://example.com/other", "#123456", "#eeeeee"),
  ]);
  const buttonColor = screen.getByLabelText("Button color");
  const labelColor = screen.getByLabelText("Label color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#111111");
  // White on a dark button is above 4.5:1.
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
  expect(paintColor(previewButton("contrast"), "backgroundColor")).toBe("#111111");
  expect(paintColor(previewButton("contrast"), "color")).toBe("#ffffff");
  await user.clear(labelColor);
  await user.type(labelColor, "#000000");
  // Black on that same dark button is below 4.5:1. Black on the white phone would not warn.
  expect(labelColor).toHaveProperty("value", "#000000");
  expect(buttonColor).toHaveProperty("value", "#111111");
  expect(screen.getByText(LOW_CONTRAST_WARNING)).toBeTruthy();
  expect(labelColor.getAttribute("aria-invalid")).toBe("false");
  expect(buttonColor.getAttribute("aria-invalid")).toBe("false");
  expect(paintColor(previewButton("other"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("other"), "color")).toBe("#eeeeee");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#ffffff");
  // The label is still black. White is a passing background, so the warning leaves.
  expect(buttonColor).toHaveProperty("value", "#ffffff");
  expect(labelColor).toHaveProperty("value", "#000000");
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
  expect(paintColor(previewButton("contrast"), "backgroundColor")).toBe("#ffffff");
  expect(paintColor(previewButton("contrast"), "color")).toBe("#000000");
}

/**
 * Asserts an incomplete color removes a low-contrast warning and keeps the last paint.
 *
 * Purpose: a warning needs two valid colors. "#" is an error, and the previous paint stays.
 * Inputs: none.
 * Side effects: renders the shell and types a button color.
 */
async function expectAnInvalidColorToClearTheContrastWarning(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([ctaSection("contrast", "Shop", "https://example.com/sale", "#112233", "#ffffff")]);
  const buttonColor = screen.getByLabelText("Button color");
  const labelColor = screen.getByLabelText("Label color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#ffffff");
  // White on white warns before the color becomes incomplete.
  expect(screen.getByText(LOW_CONTRAST_WARNING)).toBeTruthy();
  await user.clear(buttonColor);
  await user.type(buttonColor, "#");
  // The warning is gone. The button still paints the last valid white.
  expect(buttonColor).toHaveProperty("value", "#");
  expect(buttonColor.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText(BUTTON_COLOR_ERROR)).toBeTruthy();
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
  expect(labelColor).toHaveProperty("value", "#ffffff");
  expect(labelColor.getAttribute("aria-invalid")).toBe("false");
  expect(paintColor(previewButton("contrast"), "backgroundColor")).toBe("#ffffff");
  expect(paintColor(previewButton("contrast"), "color")).toBe("#ffffff");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
}

/**
 * Asserts an empty color is unfinished and keeps the previous paint.
 *
 * Purpose: clearing a color is not a hex error. Each color field remembers its own paint.
 * Inputs: none.
 * Side effects: renders the shell and clears both colors.
 */
async function expectAnEmptyColorToKeepThePreviousPaint(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("paint", "Kept", "https://example.com/sale", "#112233", "#ffffff"),
    ctaSection("other", "Other", "https://example.com/other", "#123456", "#eeeeee"),
  ]);
  const buttonColor = screen.getByLabelText("Button color");
  const labelColor = screen.getByLabelText("Label color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#010101");
  await user.clear(labelColor);
  await user.type(labelColor, "#abcdef");
  await user.clear(buttonColor);
  // A blank button color has no error and does not fall back to the default.
  expect(buttonColor).toHaveProperty("value", "");
  expect(buttonColor.getAttribute("aria-invalid")).toBe("false");
  expectControlDescription(buttonColor, null);
  expect(screen.queryByText(BUTTON_COLOR_ERROR)).toBeNull();
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
  expect(paintColor(previewButton("paint"), "backgroundColor")).toBe("#010101");
  expect(paintColor(previewButton("paint"), "color")).toBe("#abcdef");
  await user.clear(labelColor);
  // The label color is a separate memory. The button paint stays #010101.
  expect(labelColor).toHaveProperty("value", "");
  expect(labelColor.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(LABEL_COLOR_ERROR)).toBeNull();
  expect(paintColor(previewButton("paint"), "color")).toBe("#abcdef");
  expect(paintColor(previewButton("paint"), "backgroundColor")).toBe("#010101");
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "Kept");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
  expect(paintColor(previewButton("other"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("other"), "color")).toBe("#eeeeee");
}

/**
 * Asserts a rejected color stays in the field and does not paint a valid prefix.
 *
 * Purpose: #GGGGGG and a pasted #11223344 keep the previous paint and the other fields.
 * Inputs: none.
 * Side effects: renders the shell, types a rejected color, and pastes another.
 */
async function expectARejectedColorToKeepThePreviousPaint(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("paint", "Kept", "https://example.com/sale", "#112233", "#ffffff"),
    ctaSection("other", "Other", "https://example.com/other", "#123456", "#eeeeee"),
  ]);
  const buttonColor = screen.getByLabelText("Button color");
  const labelColor = screen.getByLabelText("Label color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#010101");
  await user.clear(labelColor);
  await user.type(labelColor, "#abcdef");
  await user.clear(buttonColor);
  await user.click(buttonColor);
  await user.paste("#11223344");
  // One paste does not pass through the valid prefix #112233. The previous paint stays.
  expect(buttonColor).toHaveProperty("value", "#11223344");
  expect(buttonColor.getAttribute("aria-invalid")).toBe("true");
  expectControlDescription(buttonColor, BUTTON_COLOR_ERROR);
  expect(paintColor(previewButton("paint"), "backgroundColor")).toBe("#010101");
  expect(paintColor(previewButton("paint"), "color")).toBe("#abcdef");
  expect(screen.queryByText(LOW_CONTRAST_WARNING)).toBeNull();
  await user.clear(labelColor);
  await user.type(labelColor, "#GGGGGG");
  // Letters are not hex. The label paint stays, and the button field is still the pasted value.
  expect(labelColor).toHaveProperty("value", "#GGGGGG");
  expect(screen.getByText(LABEL_COLOR_ERROR)).toBeTruthy();
  expect(paintColor(previewButton("paint"), "color")).toBe("#abcdef");
  expect(buttonColor).toHaveProperty("value", "#11223344");
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "Kept");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
  expect(paintColor(previewButton("other"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("other"), "color")).toBe("#eeeeee");
}

/**
 * Asserts an uppercase label color stays in the input and paints in lowercase.
 *
 * Purpose: the draft is not rewritten when the preview normalizes #RRGGBB.
 * Inputs: none.
 * Side effects: renders the shell and types a label color.
 */
async function expectAnUppercaseLabelColorToStayInTheInput(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("case", "Shop", "https://example.com/sale", "#112233", "#ffffff"),
    ctaSection("other", "Other", "https://example.com/other", "#123456", "#eeeeee"),
  ]);
  const labelColor = screen.getByLabelText("Label color");
  await user.clear(labelColor);
  await user.type(labelColor, "#ABCDEF");
  // The input keeps the capitals. The paint is the lowercase form, and the button color is untouched.
  expect(labelColor).toHaveProperty("value", "#ABCDEF");
  expect(labelColor.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(LABEL_COLOR_ERROR)).toBeNull();
  expect(paintColor(previewButton("case"), "color")).toBe("#abcdef");
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#112233");
  expect(paintColor(previewButton("case"), "backgroundColor")).toBe("#112233");
  expect(paintColor(previewButton("other"), "color")).toBe("#eeeeee");
}

/**
 * Asserts a valid link restores the anchor after an invalid one.
 *
 * Purpose: fixing notaurl clears the error and points Open destination at the new URL.
 * Inputs: none.
 * Side effects: renders the shell and types two links.
 */
async function expectAValidLinkToRestoreTheAnchor(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("first", "First", "https://example.com/first", "#112233", "#ffffff"),
    ctaSection("second", "Second", "https://example.com/second", "#123456", "#eeeeee"),
  ]);
  const link = screen.getByLabelText("Link");
  await user.click(previewButton("first"));
  await user.clear(link);
  await user.type(link, "notaurl");
  await user.clear(link);
  await user.type(link, "http://example.com/restored");
  const firstOpen = openDestination("first");
  // http is accepted. The typed string is the href, and the other CTA keeps its own link.
  expect(link).toHaveProperty("value", "http://example.com/restored");
  expect(link.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(LINK_ERROR)).toBeNull();
  expectControlDescription(link, null);
  expect(previewDestination("first")?.textContent).toBe(destinationLine("http://example.com/restored"));
  expect(firstOpen?.getAttribute("href")).toBe("http://example.com/restored");
  expect(firstOpen?.getAttribute("target")).toBe("_blank");
  expect(firstOpen?.getAttribute("rel")).toBe("noreferrer");
  expect(previewButton("first").textContent).toBe("First");
  expect(openDestination("second")?.getAttribute("href")).toBe("https://example.com/second");
  expect(previewDestination("second")).toBeNull();
}

/**
 * Asserts the link field keeps a URL that a parser would rewrite.
 *
 * Purpose: the input and the anchor use the typed characters, including case and a leading space.
 * Inputs: none.
 * Side effects: renders the shell and types two links.
 */
async function expectTheTypedUrlToStayOnTheAnchor(): Promise<void> {
  const user = userEvent.setup();
  const uppercase = "HTTPS://example.com/Sale";
  const spaced = " https://example.com/sale";
  renderEditor([
    ctaSection("first", "First", "https://example.com/first"),
    ctaSection("second", "Second", "https://example.com/second"),
  ]);
  const link = screen.getByLabelText("Link");
  await user.clear(link);
  await user.type(link, uppercase);
  // The parser's href would lowercase the scheme. The field and the anchor keep the typed text.
  expect(link).toHaveProperty("value", uppercase);
  expect(screen.queryByText(LINK_ERROR)).toBeNull();
  expect(openDestination("first")?.getAttribute("href")).toBe(uppercase);
  await user.click(previewButton("first"));
  expect(previewDestination("first")?.textContent).toBe(destinationLine(uppercase));
  await user.clear(link);
  await user.type(link, spaced);
  // A leading space is valid to the parser and is removed from its href. The draft keeps the space.
  expect(link).toHaveProperty("value", spaced);
  expect(link.getAttribute("aria-invalid")).toBe("false");
  expect(openDestination("first")?.getAttribute("href")).toBe(spaced);
  expect(previewDestination("first")?.textContent).toBe(destinationLine(spaced));
  expect(openDestination("second")?.getAttribute("href")).toBe("https://example.com/second");
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "First");
}

/**
 * Builds a CTA preview row for a link the schema may reject.
 *
 * Purpose: the preview can show a javascript URL or a credential URL without hydrating a configuration.
 * Inputs: id, the section id. url, the raw link.
 * Side effects: none.
 */
function unsafeCta(id: string, url: string): DraftCtaSection {
  // The label is the id so each button is identifiable. The colors are the defaults.
  return {
    id,
    type: "cta",
    label: id,
    url,
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  };
}

/**
 * Asserts unsafe links omit the anchor and a raw https link keeps its characters.
 *
 * Purpose: javascript, data, file, blob, credentials, and relative URLs are not anchors. A path with markup stays text.
 * Inputs: none.
 * Side effects: renders the previews and activates the script URL and the markup URL.
 */
async function expectUnsafeUrlsToOmitTheAnchor(): Promise<void> {
  const user = userEvent.setup();
  const href = window.location.href;
  const markupUrl = "https://example.com/<img src=x onerror=alert(1)>";
  const hidden = [
    unsafeCta("script", "javascript:alert(1)"),
    unsafeCta("data", "data:text/html,hi"),
    unsafeCta("file", "file:///tmp/a"),
    unsafeCta("blob", "blob:https://example.com/uuid"),
    unsafeCta("creds", "https://user:pass@example.com/secret"),
    unsafeCta("user", "https://user@example.com/secret"),
    unsafeCta("empty-host", "http://"),
    unsafeCta("relative", "/sale"),
    unsafeCta("protocol-relative", "//example.com/sale"),
  ];
  const opened = recordWindowOpen();
  try {
    render(
      <ol>
        {hidden.map((section) => (
          <CtaPreview key={section.id} section={section} />
        ))}
        <CtaPreview section={unsafeCta("markup", markupUrl)} />
        <CtaPreview section={unsafeCta("safe", "https://example.com/sale")} />
      </ol>,
    );
    for (const section of hidden) {
      // The button remains. There is no anchor and no destination until activation.
      expect(previewButton(section.id).textContent).toBe(section.id);
      expect(openDestination(section.id)).toBeNull();
      expect(previewDestination(section.id)).toBeNull();
    }
    await user.click(previewButton("script"));
    const scriptDestination = previewDestination("script");
    // The script URL is text. Activating it does not leave the page or open a window.
    expect(scriptDestination?.textContent).toBe(destinationLine("javascript:alert(1)"));
    expect(scriptDestination?.querySelector("a")).toBeNull();
    expect(scriptDestination?.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(window.location.href).toBe(href);
    expect(opened.calls).toEqual([]);
    const markupButton = previewButton("markup");
    const markupOpen = openDestination("markup");
    // The anchor href is the typed path, not the parser's percent-encoded href. The label stays text.
    expect(markupOpen?.getAttribute("href")).toBe(markupUrl);
    expect(markupOpen?.getAttribute("target")).toBe("_blank");
    expect(markupOpen?.getAttribute("rel")).toBe("noreferrer");
    expect(markupButton.querySelector("img")).toBeNull();
    await user.click(markupButton);
    const markupDestination = previewDestination("markup");
    expect(markupDestination?.textContent).toBe(destinationLine(markupUrl));
    expect(markupDestination?.querySelector("img")).toBeNull();
    expect(markupDestination?.childNodes[0]?.nodeType).toBe(Node.TEXT_NODE);
    expect(openDestination("safe")?.getAttribute("href")).toBe("https://example.com/sale");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("script")).toBeNull();
  } finally {
    opened.restore();
  }
}

/**
 * Asserts the destination stays hidden until activation and a second activation keeps it.
 *
 * Purpose: Enter reveals the URL without navigating, and pressing Enter again does not hide it.
 * Inputs: none.
 * Side effects: renders the shell and presses Enter on the preview button.
 */
async function expectEnterToRevealTheDestinationWithoutNavigating(): Promise<void> {
  const user = userEvent.setup();
  const href = window.location.href;
  const opened = recordWindowOpen();
  try {
    renderEditor([
      ctaSection("first", "First", "https://example.com/first"),
      ctaSection("second", "Second", "https://example.com/second"),
    ]);
    const button = previewButton("first");
    // Neither destination is visible before activation.
    expect(previewDestination("first")).toBeNull();
    expect(previewDestination("second")).toBeNull();
    button.focus();
    await user.keyboard("{Enter}");
    const destination = previewDestination("first");
    // Enter shows this section's URL. The other button stays closed, and the page stays here.
    expect(destination?.textContent).toBe(destinationLine("https://example.com/first"));
    expect(destination?.getAttribute("aria-live")).toBe("polite");
    expect(previewDestination("second")).toBeNull();
    expect(window.location.href).toBe(href);
    expect(opened.calls).toEqual([]);
    await user.keyboard("{Enter}");
    expect(previewDestination("first")?.textContent).toBe(destinationLine("https://example.com/first"));
    expect(window.location.href).toBe(href);
    expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/first");
  } finally {
    opened.restore();
  }
}

/**
 * Asserts Open destination opens a new tab and leaves this page in place.
 *
 * Purpose: the anchor is the navigation control. The preview button is not.
 * Inputs: none.
 * Side effects: renders the shell and clicks the anchor.
 */
async function expectOpenDestinationToRequestANewTab(): Promise<void> {
  const user = userEvent.setup();
  const href = window.location.href;
  const opened = recordWindowOpen();
  try {
    renderEditor([ctaSection("go", "Go", "https://example.com/sale")]);
    await user.click(previewButton("go"));
    // The preview button reveals text and does not ask for a new window.
    expect(opened.calls).toEqual([]);
    expect(window.location.href).toBe(href);
    const link = openDestination("go");
    if (link === null) {
      throw new Error("Expected Open destination for a valid URL.");
    }
    // The DOM click is the anchor's own activation, which asks for a new tab.
    link.click();
    // The current address is unchanged. The request is a new tab with noreferrer.
    expect(window.location.href).toBe(href);
    expect(opened.calls).toHaveLength(1);
    expect(opened.calls[0]?.target).toBe("_blank");
    expect(opened.calls[0]?.features).toBe("noreferrer");
    expect(opened.calls[0]?.url).toContain("https://example.com/sale");
    expect(previewDestination("go")?.textContent).toBe(destinationLine("https://example.com/sale"));
    expect(screen.getByLabelText("Label")).toHaveProperty("value", "Go");
    expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/sale");
  } finally {
    opened.restore();
  }
}

/**
 * Asserts a revealed destination does not follow a preview instance onto another section.
 *
 * Purpose: reusing the component for a new section id starts with the destination hidden.
 * Inputs: none.
 * Side effects: renders the preview, activates it, and rerenders it with a new section.
 */
async function expectARevealedDestinationToStayWithItsSection(): Promise<void> {
  const user = userEvent.setup();
  const first = unsafeCta("a", "https://example.com/a");
  const second = unsafeCta("b", "https://example.com/b");
  const view = render(
    <ol>
      <CtaPreview section={first} />
    </ol>,
  );
  expect(previewDestination("a")).toBeNull();
  await user.click(previewButton("a"));
  // The first section shows its own URL.
  expect(previewDestination("a")?.textContent).toBe(destinationLine("https://example.com/a"));
  view.rerender(
    <ol>
      <CtaPreview section={second} />
    </ol>,
  );
  // The new section does not inherit the revealed URL. Its button shows its own label.
  expect(document.querySelector('[data-section-id="a"]')).toBeNull();
  expect(previewButton("b").textContent).toBe("b");
  expect(previewDestination("b")).toBeNull();
  expect(openDestination("b")?.getAttribute("href")).toBe("https://example.com/b");
  await user.click(previewButton("b"));
  expect(previewDestination("b")?.textContent).toBe(destinationLine("https://example.com/b"));
}

/**
 * Asserts an incomplete color stays on its section while another CTA is selected.
 *
 * Purpose: the inspector shows the selected row, and the first preview keeps its last valid color.
 * Inputs: none.
 * Side effects: renders the shell, types an incomplete color, and selects each button.
 */
async function expectAnIncompleteColorToStayWithItsSection(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("first", "First", "https://example.com/first", "#112233", "#ffffff"),
    ctaSection("second", "Second", "https://example.com/second", "#123456", "#eeeeee"),
  ]);
  const buttonColor = screen.getByLabelText("Button color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#010101");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#");
  await user.click(screen.getByRole("button", { name: "Select Button, Second" }));
  // The inspector is the second section. The first preview still uses its previous valid color.
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "Second");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/second");
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#123456");
  expect(screen.getByLabelText("Label color")).toHaveProperty("value", "#eeeeee");
  expect(screen.queryByText(BUTTON_COLOR_ERROR)).toBeNull();
  expect(paintColor(previewButton("first"), "backgroundColor")).toBe("#010101");
  expect(paintColor(previewButton("first"), "color")).toBe("#ffffff");
  expect(previewButton("second").textContent).toBe("Second");
  await user.click(screen.getByRole("button", { name: "Select Button, First" }));
  // Returning to the first section restores the unfinished color without resetting the paint.
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#");
  expect(screen.getByText(BUTTON_COLOR_ERROR)).toBeTruthy();
  expect(paintColor(previewButton("first"), "backgroundColor")).toBe("#010101");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/first");
  expect(screen.getByLabelText("Label color")).toHaveProperty("value", "#ffffff");
  expect(openDestination("second")?.getAttribute("href")).toBe("https://example.com/second");
}

/**
 * Asserts moving a CTA keeps the last valid color for an incomplete field.
 *
 * Purpose: the phone row moves with the section, and the paint does not fall back to the default.
 * Inputs: none.
 * Side effects: renders the shell, types an incomplete color, and moves the section down.
 */
async function expectMovingASectionToKeepItsLastValidColor(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("first", "First", "https://example.com/first", "#112233", "#ffffff"),
    ctaSection("second", "Second", "https://example.com/second", "#123456", "#eeeeee"),
  ]);
  const buttonColor = screen.getByLabelText("Button color");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#010101");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#");
  const reorder = screen.getByRole("button", { name: "Reorder Button, First" });
  reorder.focus();
  await user.keyboard("{ArrowDown}");
  const ids = [...document.querySelectorAll(".preview-list [data-section-id]")].map((element) =>
    element.getAttribute("data-section-id"),
  );
  // The unfinished color is still on the first section, which is now second in the phone.
  expect(ids).toEqual(["second", "first"]);
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#");
  expect(paintColor(previewButton("first"), "backgroundColor")).toBe("#010101");
  expect(paintColor(previewButton("first"), "color")).toBe("#ffffff");
  expect(previewButton("second").textContent).toBe("Second");
  expect(paintColor(previewButton("second"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("second"), "color")).toBe("#eeeeee");
  expect(openDestination("first")?.getAttribute("href")).toBe("https://example.com/first");
  expect(openDestination("second")?.getAttribute("href")).toBe("https://example.com/second");
}

/**
 * Asserts a blank label and an invalid link can be reported together.
 *
 * Purpose: one field error does not clear the other field or its message.
 * Inputs: none.
 * Side effects: renders the shell and edits the label and the link.
 */
async function expectABlankLabelAndAnInvalidLinkToBothBeNamed(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([ctaSection("both", "Shop", "https://example.com/sale", "#112233", "#ffffff")]);
  const label = screen.getByLabelText("Label");
  const link = screen.getByLabelText("Link");
  await user.clear(label);
  await user.clear(link);
  await user.type(link, "notaurl");
  // Both messages are visible. The colors and the preview button remain.
  expect(label).toHaveProperty("value", "");
  expect(link).toHaveProperty("value", "notaurl");
  expect(screen.getByText(LABEL_REQUIRED_ERROR)).toBeTruthy();
  expect(screen.getByText(LINK_ERROR)).toBeTruthy();
  expectControlDescription(label, LABEL_REQUIRED_ERROR);
  expectControlDescription(link, LINK_ERROR);
  expect(previewButton("both").textContent).toBe("");
  expect(openDestination("both")).toBeNull();
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#112233");
  expect(screen.getByLabelText("Label color")).toHaveProperty("value", "#ffffff");
  expect(paintColor(previewButton("both"), "backgroundColor")).toBe("#112233");
  expect(paintColor(previewButton("both"), "color")).toBe("#ffffff");
}

/**
 * Asserts a screen of only buttons does not show the carousel placeholder note.
 *
 * Purpose: the note stays for carousels. A button has a real preview.
 * Inputs: none.
 * Side effects: renders the shell.
 */
function expectAButtonOnlyPhoneToHideTheCarouselNote(): void {
  renderEditor([
    ctaSection("one", "One", "https://example.com/one", "#112233", "#ffffff"),
    ctaSection("two", "Two", "https://example.com/two", "#123456", "#eeeeee"),
  ]);
  // Both buttons are on the phone. The carousel sentence is absent, and the first inspector is the CTA fields.
  expect(screen.queryByText("Carousel blocks are placeholders for the section preview.")).toBeNull();
  expect(screen.queryByText("Fields for this section arrive in the next prompts.")).toBeNull();
  expect(previewButton("one").textContent).toBe("One");
  expect(previewButton("two").textContent).toBe("Two");
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "One");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/one");
  expect(openDestination("one")?.getAttribute("href")).toBe("https://example.com/one");
  expect(openDestination("two")?.getAttribute("href")).toBe("https://example.com/two");
  expect(paintColor(previewButton("two"), "backgroundColor")).toBe("#123456");
  expect(paintColor(previewButton("two"), "color")).toBe("#eeeeee");
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
 * Asserts each button color swatch writes the matching color input.
 *
 * Purpose: a picked color and a typed color stay on the same field, and an incomplete string stays in the text input.
 * Inputs: none.
 * Side effects: renders the shell, picks a button color, and types the label color.
 */
async function expectTheColorPickersToWriteTheColorInputs(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    ctaSection("colors", "Continue", "https://example.com/continue", "#112233", "#ffffff"),
    ctaSection("other", "Other", "https://example.com/other", "#123456", "#eeeeee"),
  ]);
  const settings = screen.getByRole("region", { name: "Section settings" });
  const buttonColor = withinSettingsInput(settings, "Button color");
  const buttonPicker = withinSettingsInput(settings, "Choose button color");
  const labelColor = withinSettingsInput(settings, "Label color");
  const labelPicker = withinSettingsInput(settings, "Choose label color");
  // The text inputs stay text inputs. The swatches start on the same colors.
  expect(buttonColor.getAttribute("type")).toBe("text");
  expect(buttonPicker.getAttribute("type")).toBe("color");
  expect(buttonPicker).toHaveProperty("value", "#112233");
  expect(labelPicker).toHaveProperty("value", "#ffffff");
  fireEvent.input(buttonPicker, { target: { value: "#010101" } });
  // The picked color is the button color input and the button background. The label color stays.
  expect(buttonColor).toHaveProperty("value", "#010101");
  expect(buttonPicker).toHaveProperty("value", "#010101");
  expect(paintColor(previewButton("colors"), "backgroundColor")).toBe("#010101");
  expect(labelColor).toHaveProperty("value", "#ffffff");
  expect(labelPicker).toHaveProperty("value", "#ffffff");
  expect(paintColor(previewButton("other"), "backgroundColor")).toBe("#123456");
  await user.clear(labelColor);
  await user.type(labelColor, "#abcdef");
  // Typing updates the label swatch and leaves the button color that was picked.
  expect(labelColor).toHaveProperty("value", "#abcdef");
  expect(labelPicker).toHaveProperty("value", "#abcdef");
  expect(paintColor(previewButton("colors"), "color")).toBe("#abcdef");
  expect(buttonColor).toHaveProperty("value", "#010101");
  await user.clear(buttonColor);
  await user.type(buttonColor, "#");
  // An incomplete string stays in the text input. The swatch keeps the last valid color.
  expect(buttonColor).toHaveProperty("value", "#");
  expect(buttonPicker).toHaveProperty("value", "#010101");
  expect(paintColor(previewButton("colors"), "backgroundColor")).toBe("#010101");
  await user.click(screen.getByRole("button", { name: "Select Button, Other" }));
  // The other section's settings show that section's own color input and swatch.
  expect(screen.getByLabelText("Button color")).toHaveProperty("value", "#123456");
  expect(screen.getByLabelText("Choose button color")).toHaveProperty("value", "#123456");
  expect(screen.getByLabelText("Label color")).toHaveProperty("value", "#eeeeee");
  expect(screen.getByLabelText("Choose label color")).toHaveProperty("value", "#eeeeee");
}

/**
 * Registers the CTA section cases.
 *
 * Purpose: each case covers one editing or rendering behavior from this prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerCtaSectionCases(): void {
  // Label, URL, colors, navigation, invalid input, and the registry entry.
  it("updates the preview button text when the label changes", expectEditingTheLabelToUpdateThePreviewButton);
  it("updates the revealed destination when the URL changes and leaves the other CTA", expectEditingTheUrlToUpdateTheRevealedDestination);
  it("paints the button color and the label color as two different hex values", expectBothColorsToPaintOnTheButton);
  it("leaves the current location unchanged when the preview button is clicked", expectClickingThePreviewButtonToKeepTheLocation);
  it("keeps notaurl in the link input", expectNotaurlToRemainInTheLinkInput);
  it("shows HTML in the label as text", expectMarkupInTheLabelToStayText);
  it("shows an inline error for a blank label and still renders the button", expectABlankLabelToShowAnInlineError);
  it("warns for low contrast and keeps both colors", expectLowContrastToWarnWithoutRejectingTheColors);
  it("keeps an incomplete color in the input and the previous paint color", expectAnIncompleteColorToKeepThePreviousPaint);
  it("uses the default colors when no valid color has been entered", expectInvalidInitialColorsToUseTheDefaults);
  it("does not submit a form when the preview button is clicked", expectThePreviewButtonNotToSubmitAForm);
  it("registers the CTA inspector and preview", expectTheRegistryToRegisterTheCta);
  it("uses the default color when a preview instance changes section", expectAPreviewToForgetAnotherSectionsColor);
  it("keeps a shorthand button color in the input and paints the expanded color", expectAShorthandButtonColorToStayInTheInput);
  it("treats an empty link as unfinished and omits Open destination", expectAnEmptyLinkToOmitTheAnchor);
  it("warns from the label color against the button color", expectContrastToFollowTheButtonColor);
  it("clears the contrast warning when the button color becomes incomplete", expectAnInvalidColorToClearTheContrastWarning);
  it("treats an empty color as unfinished and keeps the previous paint", expectAnEmptyColorToKeepThePreviousPaint);
  it("keeps a rejected color in the field and the previous paint", expectARejectedColorToKeepThePreviousPaint);
  it("keeps an uppercase label color in the input and paints the lowercase color", expectAnUppercaseLabelColorToStayInTheInput);
  it("restores Open destination when the link becomes a valid http URL", expectAValidLinkToRestoreTheAnchor);
  it("keeps the typed URL on the anchor", expectTheTypedUrlToStayOnTheAnchor);
  it("omits the anchor for an unsafe URL and keeps markup in the destination as text", expectUnsafeUrlsToOmitTheAnchor);
  it("reveals the destination on Enter and leaves the location unchanged", expectEnterToRevealTheDestinationWithoutNavigating);
  it("requests a new tab from Open destination and leaves this page in place", expectOpenDestinationToRequestANewTab);
  it("hides the revealed destination when the preview section changes", expectARevealedDestinationToStayWithItsSection);
  it("keeps an incomplete button color when another CTA is selected", expectAnIncompleteColorToStayWithItsSection);
  it("keeps the last valid color when the CTA moves", expectMovingASectionToKeepItsLastValidColor);
  it("names a blank label and an invalid link at the same time", expectABlankLabelAndAnInvalidLinkToBothBeNamed);
  it("hides the carousel note when every section is a button", expectAButtonOnlyPhoneToHideTheCarouselNote);
  it("writes a picked color into the matching color input", expectTheColorPickersToWriteTheColorInputs);
}

afterEach(() => {
  cleanup();
});

describe("cta section", registerCtaSectionCases);
