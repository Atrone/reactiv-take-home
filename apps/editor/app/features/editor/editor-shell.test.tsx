// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  configurationSchema,
  createDemoDocument,
  SUPPORTED_SCHEMA_VERSION,
  type Configuration,
  type Section,
} from "@reactiv/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Route } from "../../routes/+types/editor";
import EditorRoute from "../../routes/editor.js";
import { sectionControlName } from "./section-summary.js";
import type { DraftSection } from "./draft-document.js";

/**
 * One placeholder as the phone shows it.
 *
 * Purpose: order tests compare the type label and the hint, not the markup.
 */
type PreviewEntry = {
  label: string;
  hint: string;
};

/**
 * Builds the six-section demo configuration.
 *
 * Purpose: the shell tests hydrate the same document the seed stores, without a network call.
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
 * Builds a one-section configuration that must not replace a mounted draft.
 *
 * Purpose: a later loader payload has different copy, so a reset would be visible.
 * Inputs: none.
 * Side effects: none.
 */
function replacementConfiguration(): Configuration {
  // One text block. Its title does not appear in the demo document.
  return configurationSchema.parse({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "replacement-text",
          type: "text",
          title: "Replacement title only",
          description: "",
          titleColor: "#112233",
          descriptionColor: "#334455",
        },
      ],
    },
    id: "cfg_other",
    revision: 4,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Builds the editor route element.
 *
 * Purpose: the first render and a later rerender pass the same prop shape.
 * Inputs: configuration, the document on the loader result. etag, the strong validator stored off the page.
 * Side effects: none.
 */
function pageElement(configuration: Configuration, etag: string | null): ReturnType<typeof createElement> {
  const props = {
    loaderData: {
      title: "Editor",
      configuration,
      etag,
    },
  } as Route.ComponentProps;
  // The route mounts the provider. This test does not call the loader.
  return createElement(EditorRoute, props);
}

/**
 * Renders the editor route with loader data.
 *
 * Purpose: the page hydrates from the same props the loader returns.
 * Inputs: configuration, the document to hydrate. etag, the strong validator stored off the page.
 * Side effects: mounts the shell.
 */
function renderLoaded(configuration: Configuration, etag: string | null = '"1"'): ReturnType<typeof render> {
  // The element is the same one a later rerender passes back in.
  return render(pageElement(configuration, etag));
}

/**
 * Builds a configuration from fixture sections.
 *
 * Purpose: hint and selection tests can hydrate a document that is not the demo.
 * Inputs: sections, the ordered sections.
 * Side effects: none. Throws when the sections are not a valid configuration.
 */
function loadedConfiguration(sections: Section[]): Configuration {
  // The service fields are present so the loader shape is the one the route expects.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: "cfg_fixture",
    revision: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Builds a text section.
 *
 * Purpose: fixture titles and descriptions can differ.
 * Inputs: id, the section id. title, the title string. description, the body string.
 * Side effects: none.
 */
function textBlock(id: string, title: string, description = ""): Section {
  // The colors are valid and are not what the placeholder shows.
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
 * Builds a carousel section.
 *
 * Purpose: the first alt and a later alt can be set independently.
 * Inputs: id, the section id. alts, the alt text of each slide, in order.
 * Side effects: none.
 */
function carouselBlock(id: string, alts: string[]): Section {
  // Each slide has its own id and URL so the hint can be checked against both.
  return {
    id,
    type: "carousel",
    aspectRatio: "landscape",
    images: alts.map((alt, index) => ({
      id: `${id}-image-${index + 1}`,
      url: `https://example.com/${id}-${index + 1}.jpg`,
      alt,
    })),
  };
}

/**
 * Builds a carousel with no slides.
 *
 * Purpose: a loaded empty carousel uses the same hint as a newly added one.
 * Inputs: id, the section id.
 * Side effects: none.
 */
function emptyCarousel(id: string): Section {
  // An empty image list is a valid carousel.
  return {
    id,
    type: "carousel",
    aspectRatio: "landscape",
    images: [],
  };
}

/**
 * Builds a button section.
 *
 * Purpose: the label and the URL can be set independently.
 * Inputs: id, the section id. label, the button label. url, the link.
 * Side effects: none.
 */
function buttonBlock(id: string, label: string, url = "https://example.com/go"): Section {
  // The colors are valid and are not what the placeholder shows.
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
 * Reads the section rows.
 *
 * Purpose: row counts stay inside the Sections region, not the phone list.
 * Inputs: none.
 * Side effects: none. Throws when the region is missing.
 */
function sectionRows(): HTMLElement[] {
  // The region label is the landmark name. The list items are the rows.
  return within(screen.getByRole("region", { name: "Sections" })).getAllByRole("listitem");
}

/**
 * Reads the preview placeholders in screen order.
 *
 * Purpose: a move is visible as a change in this order.
 * Inputs: none.
 * Side effects: none. Throws when the phone region is missing.
 */
function previewEntries(): PreviewEntry[] {
  const items = within(screen.getByRole("region", { name: "Phone preview" })).getAllByRole("listitem");
  const entries: PreviewEntry[] = [];
  for (const item of items) {
    // The attributes are the registry label and the row hint. A text body is separate.
    const label = item.getAttribute("data-preview-label") ?? "";
    const hint = item.getAttribute("data-preview-hint") ?? "";
    entries.push({ label, hint });
  }
  return entries;
}

/**
 * Reads one demo section as a draft row.
 *
 * Purpose: accessible names use the same hint helper as the shell.
 * Inputs: configuration, the demo configuration. index, the screen index.
 * Side effects: none. Throws when that index is missing.
 */
function demoSection(configuration: Configuration, index: number): DraftSection {
  const section = configuration.data.sections[index];
  if (section === undefined) {
    // The demo document has six sections. A bad index fails the test setup.
    throw new Error(`Missing demo section at index ${index}.`);
  }
  return section;
}

/**
 * Reads the hint from each section row, in list order.
 *
 * Purpose: the list and the phone can be compared after a move or a remove.
 * Inputs: none.
 * Side effects: none. Throws when the Sections region is missing.
 */
function rowHints(): string[] {
  const buttons = within(screen.getByRole("region", { name: "Sections" })).getAllByRole("button", {
    name: /^Select /,
  });
  const hints: string[] = [];
  for (const button of buttons) {
    const name = button.getAttribute("aria-label") ?? "";
    const separator = name.indexOf(", ");
    // The accessible name is "Select {label}, {hint}". The hint starts after that comma.
    hints.push(separator < 0 ? name : name.slice(separator + 2));
  }
  return hints;
}

/**
 * Reads the Section settings region.
 *
 * Purpose: inspector assertions stay inside that landmark.
 * Inputs: none.
 * Side effects: none. Throws when the region is missing.
 */
function inspectorRegion(): HTMLElement {
  // The landmark name is the region label.
  return screen.getByRole("region", { name: "Section settings" });
}

/**
 * Asserts the inspector describes one section.
 *
 * Purpose: the type and the id stay. Text, button, and carousel show their own fields.
 * Inputs: type, the stored section type. id, the section id.
 * Side effects: none. Throws when one of those lines is missing.
 */
function expectInspectorToShow(type: string, id: string): void {
  const region = inspectorRegion();
  // The stored type is carousel, text, or cta. The id is the row id, not the screen index.
  expect(within(region).getByText(`Type: ${type}`)).toBeTruthy();
  expect(within(region).getByText(`Id: ${id}`)).toBeTruthy();
  if (type === "carousel") {
    // The carousel inspector replaces the pending sentence. The ratio group and Add image stay.
    expect(within(region).getByRole("radiogroup", { name: "Aspect ratio" })).toBeTruthy();
    expect(within(region).getByRole("button", { name: "Add image" })).toBeTruthy();
    expect(within(region).queryByLabelText("Choose title color")).toBeNull();
    expect(within(region).queryByText("Fields for this section arrive in the next prompts.")).toBeNull();
    return;
  }
  if (type === "text") {
    // The text inspector replaces the pending sentence. The four labels are the fields.
    expect(within(region).getByLabelText("Title")).toBeTruthy();
    expect(within(region).getByLabelText("Description")).toBeTruthy();
    expect(within(region).getByLabelText("Title color")).toBeTruthy();
    expect(within(region).getByLabelText("Description color")).toBeTruthy();
    expect(within(region).getByLabelText("Choose title color").getAttribute("type")).toBe("color");
    expect(within(region).getByLabelText("Choose description color").getAttribute("type")).toBe("color");
    expect(within(region).queryByText("Fields for this section arrive in the next prompts.")).toBeNull();
    return;
  }
  if (type === "cta") {
    // The button inspector replaces the pending sentence. The four labels are the fields.
    expect(within(region).getByLabelText("Label")).toBeTruthy();
    expect(within(region).getByLabelText("Link")).toBeTruthy();
    expect(within(region).getByLabelText("Button color")).toBeTruthy();
    expect(within(region).getByLabelText("Label color")).toBeTruthy();
    expect(within(region).getByLabelText("Choose button color").getAttribute("type")).toBe("color");
    expect(within(region).getByLabelText("Choose label color").getAttribute("type")).toBe("color");
    expect(within(region).queryByText("Fields for this section arrive in the next prompts.")).toBeNull();
    return;
  }
  throw new Error(`Unexpected inspector type ${type}.`);
}

/**
 * Waits until focus lands on one element id.
 *
 * Purpose: add, remove, and some moves move focus after the next paint.
 * Inputs: id, the element id that should be active.
 * Side effects: none. Throws when focus does not arrive.
 */
async function expectFocus(id: string): Promise<void> {
  await waitFor(() => {
    // The effect focuses the element after the command's render.
    expect(document.activeElement?.id).toBe(id);
  });
}

/**
 * Gives each section row a vertical band.
 *
 * Purpose: happy-dom does not lay out the rows, and the drag hit test reads these rectangles.
 * Inputs: none. The rows are the ones currently rendered.
 * Side effects: replaces getBoundingClientRect on each row.
 */
function layoutSectionRows(): void {
  const rows = [...document.querySelectorAll<HTMLElement>(".section-list .section-row")];
  const height = 40;
  const gap = 8;
  rows.forEach((row, index) => {
    const top = index * (height + gap);
    const rect = {
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: 240,
      width: 240,
      height,
      toJSON() {
        return {};
      },
    };
    // The drag session reads top and height. The other fields keep the DOMRect shape.
    row.getBoundingClientRect = () => rect;
  });
}

/**
 * Presses the pointer on one section control.
 *
 * Purpose: the drag starts from this element, using the same pointer id the later move and release use.
 * Inputs: source, the handle, row, or button. startY, the client Y at pointer down.
 * Side effects: lays out the rows and dispatches pointerdown.
 */
function beginSectionDrag(source: HTMLElement, startY: number): void {
  // The rectangles have to exist before the first move reads them.
  layoutSectionRows();
  fireEvent.pointerDown(source, { pointerId: 1, button: 0, pointerType: "mouse", clientX: 12, clientY: startY });
}

/**
 * Moves the active section drag to a client Y.
 *
 * Purpose: the drop line follows this Y. The draft does not change until release.
 * Inputs: clientY, the pointer position in the same coordinate space as the laid-out rows.
 * Side effects: dispatches pointermove on window.
 */
function moveSectionDrag(clientY: number): void {
  // Window hears the move after the pointer leaves the row that received pointer down.
  fireEvent.pointerMove(window, { pointerId: 1, button: 0, pointerType: "mouse", clientX: 12, clientY });
}

/**
 * Releases the active section drag.
 *
 * Purpose: the release is what commits a move that passed the drag threshold.
 * Inputs: clientY, the pointer position at release.
 * Side effects: dispatches pointerup on window.
 */
function endSectionDrag(clientY: number): void {
  // The same pointer id ties this release to the press.
  fireEvent.pointerUp(window, { pointerId: 1, button: 0, pointerType: "mouse", clientX: 12, clientY });
}

/**
 * Moves one section one row with the keyboard.
 *
 * Purpose: the drag handle's arrow keys are the keyboard reorder control.
 * Inputs: user, the keyboard session. name, the handle's accessible name. direction, up or down.
 * Side effects: focuses the handle and sends the arrow key.
 */
async function reorderWithArrow(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  direction: "up" | "down",
): Promise<HTMLElement> {
  const handle = screen.getByRole("button", { name });
  // The arrow handler is on the handle, so the handle has to be the active element.
  handle.focus();
  await user.keyboard(direction === "up" ? "{ArrowUp}" : "{ArrowDown}");
  return handle;
}

/**
 * Asserts the hydrated demo document shows six rows.
 *
 * Purpose: the loader payload becomes one row and one placeholder per section.
 * Inputs: none.
 * Side effects: renders the route.
 */
function expectHydratedDemoToShowSixRows(): void {
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const entries = previewEntries();
  // The phone follows the document order. Each placeholder uses that section's own hint.
  expect(entries).toEqual([
    { label: "Carousel", hint: "Shop window with a new arrival display" },
    { label: "Text", hint: "New this week" },
    { label: "Button", hint: "Continue" },
    { label: "Carousel", hint: "Staff picks stacked on a wooden counter" },
    { label: "Text", hint: "From the floor" },
    { label: "Button", hint: "See the list" },
  ]);
  expect(rowHints()).toEqual(entries.map((entry) => entry.hint));
  expect(screen.getByRole("button", { name: "Select Carousel, Shop window with a new arrival display", pressed: true })).toBeTruthy();
  expect(screen.queryAllByRole("button", { name: /^Move up / })).toHaveLength(0);
  expect(screen.queryAllByRole("button", { name: /^Move down / })).toHaveLength(0);
  expect(screen.getAllByRole("button", { name: /^Reorder / })).toHaveLength(6);
  expect(screen.getByText("Drag a handle to reorder. Arrow keys move the focused handle.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Reorder Carousel, Shop window with a new arrival display" }).id).toBe(
    `section-drag-${demoSection(configuration, 0).id}`,
  );
  // A later slide and a link stay off the page. Text descriptions are the preview body.
  expect(screen.queryByText("Front table stacked with featured books")).toBeNull();
  expect(screen.queryByText("Chair in a quiet corner of the shop")).toBeNull();
  expect(screen.getByText("A short list from the front table.")).toBeTruthy();
  expect(screen.getByText("Notes from the people who unpack the boxes.")).toBeTruthy();
  expect(screen.queryByText("https://example.com/continue")).toBeNull();
  expect(screen.queryByText("https://example.com/list")).toBeNull();
  expect(document.querySelector("[draggable]")).toBeNull();
  const editorPane = screen.getByRole("button", { name: "Editor" });
  const previewPane = screen.getByRole("button", { name: "Preview" });
  // Both pane controls stay enabled, so both can remain in the tab order.
  expect(editorPane).toHaveProperty("disabled", false);
  expect(previewPane).toHaveProperty("disabled", false);
  expect(editorPane.getAttribute("tabindex")).not.toBe("-1");
  expect(previewPane.getAttribute("tabindex")).not.toBe("-1");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  // Export JSON is enabled. Import JSON is a file input. Save stays disabled because this draft is clean.
  expect(screen.getByRole("button", { name: "Export JSON" })).toHaveProperty("disabled", false);
  const importFile = screen.getByLabelText("Import JSON");
  expect(importFile.tagName).toBe("INPUT");
  expect(importFile.getAttribute("type")).toBe("file");
  expect(importFile.getAttribute("accept")).toBe(".json");
  expect(importFile).toHaveProperty("disabled", false);
}

/**
 * Asserts adding a carousel appends a seventh row and keeps focus.
 *
 * Purpose: Add carousel dispatches addSection and moves focus to the inspector heading.
 * Inputs: none.
 * Side effects: renders the route and clicks Add carousel.
 */
async function expectAddingACarouselToShowSevenRows(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const before = previewEntries();
  await user.click(screen.getByRole("button", { name: "Add carousel" }));
  const entries = previewEntries();
  const pressed = screen.getByRole("button", { name: "Select Carousel, Empty carousel", pressed: true });
  const addedId = pressed.id.replace(/^section-select-/, "");
  // The new carousel is last and selected. The earlier placeholders stay in order.
  expect(entries.slice(0, before.length)).toEqual(before);
  expect(entries[6]).toEqual({ label: "Carousel", hint: "Empty carousel" });
  expect(screen.getByRole("button", { name: sectionControlName("Select", demoSection(configuration, 0)) }).getAttribute("aria-pressed")).toBe("false");
  expectInspectorToShow("carousel", addedId);
  await expectFocus("section-settings-heading");
  expect(screen.getByRole("heading", { name: "Section settings" }).getAttribute("tabindex")).toBe("-1");
}

/**
 * Asserts dragging the first section down swaps the first two preview placeholders.
 *
 * Purpose: a drag changes the phone immediately and does not call fetch.
 * Inputs: none.
 * Side effects: renders the route and drags the first section onto the second row.
 */
function expectDraggingTheFirstSectionDownToSwapTheFirstTwoPlaceholders(): void {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const first = demoSection(configuration, 0);
  const handle = screen.getByRole("button", { name: sectionControlName("Reorder", first) });
  const before = previewEntries();
  // The second row's lower half is one slot below the first section.
  beginSectionDrag(handle, 20);
  moveSectionDrag(70);
  const during = [...document.querySelectorAll<HTMLElement>(".section-row")];
  expect(during[0]?.getAttribute("data-dragging")).toBe("true");
  expect(during[1]?.getAttribute("data-drop")).toBe("after");
  endSectionDrag(70);
  const after = previewEntries();
  // The first two trade places. The other placeholders stay in order.
  expect(after[0]).toEqual(before[1]);
  expect(after[1]).toEqual(before[0]);
  expect(after.slice(2)).toEqual(before.slice(2));
  expect(rowHints()).toEqual(after.map((entry) => entry.hint));
  expectInspectorToShow("carousel", first.id);
  expect(screen.getByRole("button", { name: sectionControlName("Select", first), pressed: true })).toBeTruthy();
  expect(document.querySelector("[data-dragging]")).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
}

/**
 * Dispatches one drag event with a client Y happy-dom would otherwise omit.
 *
 * Purpose: the drop half is chosen from clientY, and this host's DragEvent constructor drops that field.
 * Inputs: target, the element that receives the event. type, the drag event name. clientY, the pointer Y.
 * dataTransfer, the drag payload.
 * Side effects: dispatches the event.
 */
function dispatchRowDrag(target: HTMLElement, type: string, clientY: number, dataTransfer: DataTransfer): void {
  const event = new DragEvent(type, { bubbles: true, cancelable: true });
  // The constructor leaves clientY unset. The handler reads the value defined here.
  Object.defineProperty(event, "clientY", { configurable: true, value: clientY });
  Object.defineProperty(event, "dataTransfer", { configurable: true, value: dataTransfer });
  target.dispatchEvent(event);
}

/**
 * Asserts a browser drag-and-drop drop swaps the first two placeholders.
 *
 * Purpose: a gesture that reports dragstart and drop, rather than pointer moves, still reorders the phone.
 * Inputs: none.
 * Side effects: renders the route and drops the first section on the second row.
 */
function expectAnHtmlDropToSwapTheFirstTwoPlaceholders(): void {
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const first = demoSection(configuration, 0);
  const handle = screen.getByRole("button", { name: sectionControlName("Reorder", first) });
  const before = previewEntries();
  layoutSectionRows();
  const rows = [...document.querySelectorAll<HTMLElement>(".section-row")];
  const target = rows[1];
  if (target === undefined) {
    throw new Error("The second section row was not rendered.");
  }
  const dataTransfer = new DataTransfer();
  // The second row's lower half is one slot below the first section. act flushes the drop indicator and the place.
  act(() => {
    dispatchRowDrag(handle, "dragstart", 20, dataTransfer);
    dispatchRowDrag(target, "dragover", 70, dataTransfer);
    dispatchRowDrag(target, "drop", 70, dataTransfer);
    dispatchRowDrag(handle, "dragend", 70, dataTransfer);
  });
  const after = previewEntries();
  expect(after[0]).toEqual(before[1]);
  expect(after[1]).toEqual(before[0]);
  expect(after.slice(2)).toEqual(before.slice(2));
  expectInspectorToShow("carousel", first.id);
}

/**
 * Asserts a drag can move a section past more than one row.
 *
 * Purpose: releasing over the end of the list places that section last and marks the draft unsaved.
 * Inputs: none.
 * Side effects: renders the route and drags the first section below the last row.
 */
function expectDraggingASectionToTheEndToUpdateThePhone(): void {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const first = demoSection(configuration, 0);
  const handle = screen.getByRole("button", { name: sectionControlName("Reorder", first) });
  const before = previewEntries();
  // Below the last laid-out row. The first section should land at the end.
  beginSectionDrag(handle, 20);
  moveSectionDrag(300);
  endSectionDrag(300);
  const after = previewEntries();
  expect(after[0]).toEqual(before[1]);
  expect(after[after.length - 1]).toEqual(before[0]);
  expect(after.slice(0, -1)).toEqual(before.slice(1));
  expect(rowHints()).toEqual(after.map((entry) => entry.hint));
  expectInspectorToShow("carousel", first.id);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
}

/**
 * Asserts a short press and Escape do not reorder the list.
 *
 * Purpose: a click on the handle, and a drag that is cancelled, leave the draft clean.
 * Inputs: none.
 * Side effects: renders the route and sends two pointer gestures.
 */
function expectAShortOrCancelledDragToLeaveTheOrder(): void {
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const first = demoSection(configuration, 0);
  const handle = screen.getByRole("button", { name: sectionControlName("Reorder", first) });
  const before = previewEntries();
  // Two pixels is under the drag threshold. The order and Save stay as they were.
  beginSectionDrag(handle, 20);
  moveSectionDrag(22);
  endSectionDrag(22);
  expect(previewEntries()).toEqual(before);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  // A drag past the list is abandoned with Escape before the pointer is released.
  beginSectionDrag(handle, 20);
  moveSectionDrag(300);
  fireEvent.keyDown(window, { key: "Escape" });
  endSectionDrag(300);
  expect(previewEntries()).toEqual(before);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  expect(document.querySelector("[data-dragging]")).toBeNull();
}

/**
 * Asserts dragging a row does not change which section is selected.
 *
 * Purpose: the click that follows a drag is swallowed, and the inspector stays on the section that was already selected.
 * Inputs: none.
 * Side effects: renders the route, drags the third row to the top, and clicks that row.
 */
async function expectDraggingARowToKeepTheCurrentSelection(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const first = demoSection(configuration, 0);
  const third = demoSection(configuration, 2);
  const select = screen.getByRole("button", { name: sectionControlName("Select", third) });
  // The third row is dropped above the list. The click after release must not select it.
  beginSectionDrag(select, 120);
  moveSectionDrag(10);
  endSectionDrag(10);
  fireEvent.click(select);
  expect(previewEntries()[0]).toEqual({ label: "Button", hint: "Continue" });
  expect(screen.getByRole("button", { name: sectionControlName("Select", first), pressed: true })).toBeTruthy();
  expect(select.getAttribute("aria-pressed")).toBe("false");
  // A later press is a selection. The drag's leftover click does not block it.
  await user.click(select);
  expect(select.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: sectionControlName("Select", first) }).getAttribute("aria-pressed")).toBe("false");
}

/**
 * Asserts two text placeholders keep their own titles when one row moves.
 *
 * Purpose: moving one text section does not copy its title onto the other.
 * Inputs: none.
 * Side effects: renders the route and presses ArrowUp on the second text section.
 */
async function expectTextPlaceholdersToKeepTheirTitles(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const secondText = demoSection(configuration, 4);
  await reorderWithArrow(user, sectionControlName("Reorder", secondText), "up");
  const textEntries = previewEntries().filter((entry) => entry.label === "Text");
  // Each text placeholder still shows the title that belongs to that section.
  expect(textEntries).toEqual([
    { label: "Text", hint: "New this week" },
    { label: "Text", hint: "From the floor" },
  ]);
}

/**
 * Asserts removing a middle section leaves the others in order.
 *
 * Purpose: the removed row leaves both the list and the phone, and the neighbors stay in sequence.
 * Inputs: none.
 * Side effects: renders the route and clicks Remove on the first button section.
 */
async function expectRemovingAMiddleSectionToKeepTheOthersInOrder(): Promise<void> {
  const user = userEvent.setup();
  const configuration = demoConfiguration();
  renderLoaded(configuration);
  const before = previewEntries();
  const first = demoSection(configuration, 0);
  const middle = demoSection(configuration, 2);
  await user.click(screen.getByRole("button", { name: "Remove Button, Continue" }));
  const after = previewEntries();
  // Index 2 is the first button. The rows before it and after it keep their order.
  expect(after).toEqual([...before.slice(0, 2), ...before.slice(3)]);
  expect(rowHints()).toEqual(after.map((entry) => entry.hint));
  expect(screen.queryByText("Continue")).toBeNull();
  expectInspectorToShow("carousel", first.id);
  expect(within(inspectorRegion()).queryByText(`Id: ${middle.id}`)).toBeNull();
  await expectFocus(`section-select-${first.id}`);
}

/**
 * Asserts the empty editor and the empty preview after every section is removed.
 *
 * Purpose: the add controls stay available when the document has no sections.
 * Inputs: none.
 * Side effects: renders the route and removes every section.
 */
async function expectEmptyStateAfterRemovingEverySection(): Promise<void> {
  const user = userEvent.setup();
  renderLoaded(demoConfiguration());
  /**
   * Reads the remove buttons that are still on the page.
   *
   * Purpose: each click removes one row, so the next click uses the list that remains.
   * Inputs: none.
   * Side effects: none.
   */
  function removeButtons(): HTMLElement[] {
    // The accessible name starts with Remove and includes the section label.
    return screen.queryAllByRole("button", { name: /^Remove / });
  }
  while (removeButtons().length > 0) {
    const button = removeButtons()[0];
    if (button === undefined) {
      // The length check already found a button. This guard satisfies the index type.
      break;
    }
    await user.click(button);
  }
  const sections = screen.getByRole("region", { name: "Sections" });
  // Both empty messages are visible, and the three add controls are still buttons.
  expect(within(sections).queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.getByText("No sections yet. Add a carousel, a text block, or a button.")).toBeTruthy();
  expect(screen.getByText("Nothing to preview yet.")).toBeTruthy();
  expect(within(inspectorRegion()).getByText("No section is selected.")).toBeTruthy();
  expect(within(inspectorRegion()).queryByText(/^Type:/)).toBeNull();
  expect(document.getElementById("empty-editor-message")?.getAttribute("tabindex")).toBe("-1");
  // The list is empty, so focus lands on Add carousel instead of the document body.
  await expectFocus("add-carousel");
  expect(screen.getByRole("button", { name: "Add carousel" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Add text" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Add button" })).toHaveProperty("disabled", false);
}

/**
 * Asserts a later loader payload does not replace the mounted draft.
 *
 * Purpose: the provider hydrates from the first loader value only.
 * Inputs: none.
 * Side effects: renders the route, adds a section, and rerenders with a different configuration.
 */
async function expectALaterLoaderPayloadToLeaveTheDraft(): Promise<void> {
  const user = userEvent.setup();
  const view = renderLoaded(demoConfiguration());
  await user.click(screen.getByRole("button", { name: "Add text" }));
  expect(sectionRows()).toHaveLength(7);
  view.rerender(pageElement(replacementConfiguration(), '"9"'));
  // The added row is still there. The replacement title was not hydrated over it.
  expect(sectionRows()).toHaveLength(7);
  expect(screen.queryByText("Replacement title only")).toBeNull();
  expect(screen.getAllByText("New this week").length).toBeGreaterThan(0);
}

/**
 * Asserts the pane switch can show the preview control as pressed.
 *
 * Purpose: both controls stay buttons, and activating Preview updates which one is pressed.
 * Inputs: none.
 * Side effects: renders the route and clicks Preview.
 */
async function expectPaneSwitchToKeepBothControls(): Promise<void> {
  const user = userEvent.setup();
  renderLoaded(demoConfiguration());
  const editorPane = screen.getByRole("button", { name: "Editor" });
  const previewPane = screen.getByRole("button", { name: "Preview" });
  const layout = document.querySelector(".editor-layout");
  if (layout === null) {
    // The shell always renders the split. A missing node fails the setup.
    throw new Error("The editor layout was not rendered.");
  }
  // The editor pane starts pressed. Both controls name the pane they show.
  expect(layout.getAttribute("data-pane")).toBe("editor");
  expect(editorPane.getAttribute("aria-pressed")).toBe("true");
  expect(editorPane.getAttribute("aria-controls")).toBe("editor-pane");
  expect(previewPane.getAttribute("aria-controls")).toBe("preview-pane");
  await user.click(previewPane);
  expect(previewPane.getAttribute("aria-pressed")).toBe("true");
  expect(editorPane.getAttribute("aria-pressed")).toBe("false");
  expect(layout.getAttribute("data-pane")).toBe("preview");
  await user.click(editorPane);
  // Returning to Editor restores the pressed state. Both panes stay in the document.
  expect(editorPane.getAttribute("aria-pressed")).toBe("true");
  expect(previewPane.getAttribute("aria-pressed")).toBe("false");
  expect(layout.getAttribute("data-pane")).toBe("editor");
  expect(editorPane.getAttribute("tabindex")).not.toBe("-1");
  expect(previewPane.getAttribute("tabindex")).not.toBe("-1");
  expect(document.getElementById("editor-pane")).toBeTruthy();
  expect(document.getElementById("preview-pane")).toBeTruthy();
  expect(previewEntries()).toHaveLength(6);
}

/**
 * Asserts the inspector describes the first carousel and shows its fields.
 *
 * Purpose: hydration selects the first row, and that carousel's ratio and image fields are the inspector.
 * Inputs: none.
 * Side effects: renders the route.
 */
function expectTheInspectorToDescribeTheFirstSection(): void {
  const configuration = demoConfiguration();
  renderLoaded(configuration, null);
  const first = demoSection(configuration, 0);
  // The first carousel is selected. Its two slides are the image fields.
  expect(screen.getByRole("heading", { level: 1, name: "Editor" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Sections" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Phone preview" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Section settings" }).getAttribute("tabindex")).toBe("-1");
  expectInspectorToShow("carousel", first.id);
  expect(screen.queryByText("Carousel blocks are placeholders for the section preview.")).toBeNull();
  expect(within(inspectorRegion()).getAllByLabelText("Image URL")).toHaveLength(2);
}

/**
 * Asserts clicking a row selects it and leaves the order alone.
 *
 * Purpose: selection changes the inspector and the pressed row, not the draft order.
 * Inputs: none.
 * Side effects: renders the route and clicks two section rows.
 */
async function expectSelectingARowToUpdateTheInspectorOnly(): Promise<void> {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  try {
    const configuration = demoConfiguration();
    renderLoaded(configuration);
    const first = demoSection(configuration, 0);
    const textRow = demoSection(configuration, 4);
    const before = previewEntries();
    const firstButton = screen.getByRole("button", { name: sectionControlName("Select", first) });
    await user.click(firstButton);
    // Clicking the selected row keeps focus there and does not open the inspector heading.
    expect(previewEntries()).toEqual(before);
    expect(document.activeElement).toBe(firstButton);
    expect(document.activeElement?.id).not.toBe("section-settings-heading");
    expectInspectorToShow("carousel", first.id);
    const textButton = screen.getByRole("button", { name: "Select Text, From the floor" });
    await user.click(textButton);
    // The pressed row and the inspector follow the click. The phone order does not.
    expect(previewEntries()).toEqual(before);
    expect(rowHints()).toEqual(before.map((entry) => entry.hint));
    expect(textButton.getAttribute("aria-pressed")).toBe("true");
    expect(firstButton.getAttribute("aria-pressed")).toBe("false");
    expect(document.activeElement).toBe(textButton);
    expectInspectorToShow("text", textRow.id);
    expect(within(inspectorRegion()).queryByText(`Id: ${first.id}`)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    // Restore fetch so a later case does not see this spy.
    fetchSpy.mockRestore();
  }
}

/**
 * Asserts Add text appends the factory text section and selects it.
 *
 * Purpose: the new row is last, its title is the factory title, and focus reaches the heading.
 * Inputs: none.
 * Side effects: renders the route and clicks Add text.
 */
async function expectAddingTextToAppendAndSelectIt(): Promise<void> {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  try {
    const configuration = demoConfiguration();
    renderLoaded(configuration);
    const before = previewEntries();
    await user.click(screen.getByRole("button", { name: "Add text" }));
    const entries = previewEntries();
    const pressed = screen.getByRole("button", { name: "Select Text, Title", pressed: true });
    const addedId = pressed.id.replace(/^section-select-/, "");
    // The factory title is Title. The earlier rows stay in front of it.
    expect(entries.slice(0, before.length)).toEqual(before);
    expect(entries[entries.length - 1]).toEqual({ label: "Text", hint: "Title" });
    expect(screen.getByRole("button", { name: sectionControlName("Select", demoSection(configuration, 0)) }).getAttribute("aria-pressed")).toBe("false");
    expectInspectorToShow("text", addedId);
    await expectFocus("section-settings-heading");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    // Restore fetch so a later case does not see this spy.
    fetchSpy.mockRestore();
  }
}

/**
 * Asserts Add button appends the factory button and selects it.
 *
 * Purpose: the visible label is Button and the stored type in the inspector is cta.
 * Inputs: none.
 * Side effects: renders the route and clicks Add button.
 */
async function expectAddingAButtonToAppendAndSelectIt(): Promise<void> {
  const user = userEvent.setup();
  renderLoaded(demoConfiguration());
  const before = previewEntries();
  await user.click(screen.getByRole("button", { name: "Add button" }));
  const entries = previewEntries();
  const pressedButtons = screen.getAllByRole("button", { name: "Select Button, Continue" }).filter((button) => {
    // The demo already has one Continue button. The new row is the pressed one.
    return button.getAttribute("aria-pressed") === "true";
  });
  const pressed = pressedButtons[0];
  if (pressed === undefined) {
    // The add command selects the new section. A missing pressed row fails that check.
    throw new Error("The new button section was not selected.");
  }
  const addedId = pressed.id.replace(/^section-select-/, "");
  // The factory label is Continue. The inspector uses the stored type cta.
  expect(pressedButtons).toHaveLength(1);
  expect(entries.slice(0, before.length)).toEqual(before);
  expect(entries[entries.length - 1]).toEqual({ label: "Button", hint: "Continue" });
  expectInspectorToShow("cta", addedId);
  expect(within(inspectorRegion()).queryByText("Type: button")).toBeNull();
  await expectFocus("section-settings-heading");
}

/**
 * Asserts the up arrow swaps a row with the previous one and keeps the selection.
 *
 * Purpose: keyboard reorder leaves focus on that section's drag handle.
 * Inputs: none.
 * Side effects: renders the route and presses ArrowUp on the second section.
 */
async function expectMoveUpToSwapWithThePreviousRow(): Promise<void> {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  try {
    const configuration = demoConfiguration();
    renderLoaded(configuration);
    const first = demoSection(configuration, 0);
    const second = demoSection(configuration, 1);
    const before = previewEntries();
    await reorderWithArrow(user, sectionControlName("Reorder", second), "up");
    const after = previewEntries();
    // The second row is now first. The original first section stays selected.
    expect(after[0]).toEqual(before[1]);
    expect(after[1]).toEqual(before[0]);
    expect(after.slice(2)).toEqual(before.slice(2));
    expect(rowHints()).toEqual(after.map((entry) => entry.hint));
    expectInspectorToShow("carousel", first.id);
    await expectFocus(`section-drag-${second.id}`);
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    // Restore fetch so a later case does not see this spy.
    fetchSpy.mockRestore();
  }
}

/**
 * Asserts the down arrow on the first of two rows keeps focus on that section.
 *
 * Purpose: moving onto the end does not send focus to the page heading.
 * Inputs: none.
 * Side effects: renders the route and presses ArrowDown.
 */
async function expectMoveDownOntoTheEndToFocusTheHandle(): Promise<void> {
  const user = userEvent.setup();
  const configuration = loadedConfiguration([
    textBlock("top", "Top title"),
    textBlock("bottom", "Bottom title"),
  ]);
  renderLoaded(configuration);
  await reorderWithArrow(user, "Reorder Text, Top title", "down");
  // Top is now last and still selected. Focus stays on its drag handle.
  expect(previewEntries()).toEqual([
    { label: "Text", hint: "Bottom title" },
    { label: "Text", hint: "Top title" },
  ]);
  expectInspectorToShow("text", "top");
  expect(screen.getByRole("button", { name: "Select Text, Top title", pressed: true })).toBeTruthy();
  await expectFocus("section-drag-top");
}

/**
 * Asserts removing the selected middle row inspects the next row.
 *
 * Purpose: the neighbor after the removed row becomes the selection, and focus follows it.
 * Inputs: none.
 * Side effects: renders the route, selects the middle row, and removes it.
 */
async function expectRemovingTheSelectedMiddleRowToInspectTheNext(): Promise<void> {
  const user = userEvent.setup();
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
  try {
    renderLoaded(loadedConfiguration([
      textBlock("alpha", "Alpha title"),
      textBlock("beta", "Beta title"),
      textBlock("gamma", "Gamma title"),
    ]));
    await user.click(screen.getByRole("button", { name: "Select Text, Beta title" }));
    await user.click(screen.getByRole("button", { name: "Remove Text, Beta title" }));
    // Gamma follows Beta, so Gamma is selected. Alpha stays first.
    expect(previewEntries()).toEqual([
      { label: "Text", hint: "Alpha title" },
      { label: "Text", hint: "Gamma title" },
    ]);
    expectInspectorToShow("text", "gamma");
    expect(within(inspectorRegion()).queryByText("Id: beta")).toBeNull();
    expect(within(inspectorRegion()).queryByText("Id: alpha")).toBeNull();
    expect(screen.getByRole("button", { name: "Select Text, Gamma title" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Select Text, Alpha title" }).getAttribute("aria-pressed")).toBe("false");
    await expectFocus("section-select-gamma");
    expect(fetchSpy).not.toHaveBeenCalled();
  } finally {
    // Restore fetch so a later case does not see this spy.
    fetchSpy.mockRestore();
  }
}

/**
 * Asserts removing the selected last row inspects the previous row.
 *
 * Purpose: there is no next neighbor, so the previous row becomes the selection.
 * Inputs: none.
 * Side effects: renders the route, selects the last row, and removes it.
 */
async function expectRemovingTheSelectedLastRowToInspectThePrevious(): Promise<void> {
  const user = userEvent.setup();
  renderLoaded(loadedConfiguration([
    textBlock("alpha", "Alpha title"),
    textBlock("beta", "Beta title"),
    textBlock("gamma", "Gamma title"),
  ]));
  await user.click(screen.getByRole("button", { name: "Select Text, Gamma title" }));
  await user.click(screen.getByRole("button", { name: "Remove Text, Gamma title" }));
  // Beta is the previous neighbor. The first two placeholders stay in order.
  expect(previewEntries()).toEqual([
    { label: "Text", hint: "Alpha title" },
    { label: "Text", hint: "Beta title" },
  ]);
  expectInspectorToShow("text", "beta");
  expect(within(inspectorRegion()).queryByText("Id: gamma")).toBeNull();
  expect(screen.getByRole("button", { name: "Select Text, Beta title" }).getAttribute("aria-pressed")).toBe("true");
  await expectFocus("section-select-beta");
}

/**
 * Asserts one section does not move when its handle receives an arrow key.
 *
 * Purpose: a single row is both the first and the last, and Remove stays available.
 * Inputs: none.
 * Side effects: renders the route and presses both arrow keys.
 */
async function expectOneSectionToStayPutWhenReordered(): Promise<void> {
  const user = userEvent.setup();
  renderLoaded(loadedConfiguration([textBlock("only", "Only title")]));
  // Remove stays available. Neither arrow has a neighbor to swap with.
  expect(previewEntries()).toEqual([{ label: "Text", hint: "Only title" }]);
  expect(screen.queryAllByRole("button", { name: /^Move up / })).toHaveLength(0);
  expect(screen.queryAllByRole("button", { name: /^Move down / })).toHaveLength(0);
  await reorderWithArrow(user, "Reorder Text, Only title", "down");
  await reorderWithArrow(user, "Reorder Text, Only title", "up");
  expect(previewEntries()).toEqual([{ label: "Text", hint: "Only title" }]);
  expect(screen.getByRole("button", { name: "Remove Text, Only title" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  expectInspectorToShow("text", "only");
}

/**
 * Asserts removing the only section focuses Add carousel.
 *
 * Purpose: the last remove clears the selection, both empty messages appear, and focus stays on an add control.
 * Inputs: none.
 * Side effects: renders the route and clicks Remove.
 */
async function expectRemovingTheOnlySectionToFocusAddCarousel(): Promise<void> {
  const user = userEvent.setup();
  renderLoaded(loadedConfiguration([textBlock("only", "Only title")]));
  await user.click(screen.getByRole("button", { name: "Remove Text, Only title" }));
  const sections = screen.getByRole("region", { name: "Sections" });
  // The list is gone. Focus lands on Add carousel, which can append a section.
  expect(within(sections).queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.getByText("No sections yet. Add a carousel, a text block, or a button.")).toBeTruthy();
  expect(screen.getByText("Nothing to preview yet.")).toBeTruthy();
  expect(within(inspectorRegion()).getByText("No section is selected.")).toBeTruthy();
  expect(document.getElementById("empty-editor-message")?.getAttribute("tabindex")).toBe("-1");
  await expectFocus("add-carousel");
  expect(screen.getByRole("button", { name: "Add text" })).toHaveProperty("disabled", false);
}

/**
 * Asserts an empty loader document shows the empty editor and preview.
 *
 * Purpose: a document with no sections hydrates without selecting a row.
 * Inputs: none.
 * Side effects: renders the route.
 */
function expectAnEmptyDocumentToShowTheEmptyState(): void {
  renderLoaded(loadedConfiguration([]), null);
  const sections = screen.getByRole("region", { name: "Sections" });
  // A null tag still hydrates. There is no row and no selected id.
  expect(within(sections).queryAllByRole("listitem")).toHaveLength(0);
  expect(screen.getByText("No sections yet. Add a carousel, a text block, or a button.")).toBeTruthy();
  expect(screen.getByText("Nothing to preview yet.")).toBeTruthy();
  expect(within(inspectorRegion()).getByText("No section is selected.")).toBeTruthy();
  expect(within(inspectorRegion()).queryByText(/^Type:/)).toBeNull();
  expect(screen.getByRole("button", { name: "Add carousel" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Add text" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Add button" })).toHaveProperty("disabled", false);
}

/**
 * Asserts adding to an empty document shows that one section.
 *
 * Purpose: the empty messages leave, and the new section is selected.
 * Inputs: none.
 * Side effects: renders the route and clicks Add text.
 */
async function expectAddingToAnEmptyDocumentToShowTheNewSection(): Promise<void> {
  const user = userEvent.setup();
  renderLoaded(loadedConfiguration([]));
  await user.click(screen.getByRole("button", { name: "Add text" }));
  const pressed = screen.getByRole("button", { name: "Select Text, Title", pressed: true });
  const addedId = pressed.id.replace(/^section-select-/, "");
  // One row replaces both empty messages. Focus is on the inspector heading.
  expect(sectionRows()).toHaveLength(1);
  expect(previewEntries()).toEqual([{ label: "Text", hint: "Title" }]);
  expect(screen.queryByText("No sections yet. Add a carousel, a text block, or a button.")).toBeNull();
  expect(screen.queryByText("Nothing to preview yet.")).toBeNull();
  expectInspectorToShow("text", addedId);
  await expectFocus("section-settings-heading");
}

/**
 * Asserts row hints use the first alt, the title, or the label.
 *
 * Purpose: blank and whitespace-only values fall back, and a later field is not the hint.
 * Inputs: none.
 * Side effects: renders the route.
 */
function expectHintsToUseTheDistinguishingField(): void {
  renderLoaded(loadedConfiguration([
    carouselBlock("first-alt", ["Shop window", "Front table"]),
    carouselBlock("blank-alt", ["", "Hidden second alt"]),
    carouselBlock("space-alt", ["   "]),
    emptyCarousel("no-slides"),
    textBlock("titled", "Visible title", "Hidden description"),
    textBlock("blank-title", "", "Also hidden"),
    textBlock("space-title", "   ", "Still hidden"),
    textBlock("spaced-title", "  Kept spaces  ", "Not shown"),
    buttonBlock("shop", "Shop now", "https://example.com/not-the-hint"),
  ]));
  const entries = previewEntries();
  // The first slide, the title, and the label are the hints. A text description is the preview body.
  expect(entries).toEqual([
    { label: "Carousel", hint: "Shop window" },
    { label: "Carousel", hint: "Empty carousel" },
    { label: "Carousel", hint: "Empty carousel" },
    { label: "Carousel", hint: "Empty carousel" },
    { label: "Text", hint: "Visible title" },
    { label: "Text", hint: "Untitled" },
    { label: "Text", hint: "Untitled" },
    { label: "Text", hint: "  Kept spaces  " },
    { label: "Button", hint: "Shop now" },
  ]);
  expect(rowHints()).toEqual(entries.map((entry) => entry.hint));
  expect(document.getElementById("section-select-spaced-title")?.getAttribute("aria-label")).toBe("Select Text,   Kept spaces  ");
  expect(screen.queryByText("Front table")).toBeNull();
  expect(screen.queryByText("Hidden second alt")).toBeNull();
  expect(screen.getByText("Hidden description")).toBeTruthy();
  expect(screen.getByText("Also hidden")).toBeTruthy();
  expect(screen.getByText("Still hidden")).toBeTruthy();
  expect(screen.getByText("Not shown")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Hidden description/ })).toBeNull();
  expect(screen.queryByText("https://example.com/not-the-hint")).toBeNull();
  expect(screen.getAllByRole("button", { name: "Select Text, Untitled" })).toHaveLength(2);
  expect(screen.getAllByRole("button", { name: "Select Carousel, Empty carousel" })).toHaveLength(3);
}

/**
 * Asserts a clean draft ignores a later loader payload.
 *
 * Purpose: the provider hydrates once, including when the author has not edited yet.
 * Inputs: none.
 * Side effects: renders the route and rerenders with a different configuration.
 */
function expectACleanDraftToIgnoreALaterLoaderPayload(): void {
  const view = renderLoaded(loadedConfiguration([textBlock("kept", "Kept title", "Kept body")]), null);
  expectInspectorToShow("text", "kept");
  view.rerender(pageElement(replacementConfiguration(), '"9"'));
  // The replacement document is not copied over the section already on screen.
  expect(sectionRows()).toHaveLength(1);
  expect(screen.queryByText("Replacement title only")).toBeNull();
  expect(within(inspectorRegion()).queryByText("Id: replacement-text")).toBeNull();
  expect(screen.getAllByText("Kept title").length).toBeGreaterThan(0);
  expectInspectorToShow("text", "kept");
}

/**
 * Asserts a clean document disables Save while Export JSON and Import JSON can run.
 *
 * Purpose: Save keeps its name and stays off until the draft changes. Import JSON is an enabled `.json` file input.
 * Inputs: none.
 * Side effects: renders the route.
 */
function expectACleanDocumentToDisableSaveWhileImportAcceptsJson(): void {
  renderLoaded(demoConfiguration());
  const exportButton = screen.getByRole("button", { name: "Export JSON" });
  // Export is enabled. It does not share a placeholder description with Save.
  expect(exportButton).toHaveProperty("disabled", false);
  expect(exportButton.getAttribute("title")).toBeNull();
  expect(exportButton.getAttribute("aria-describedby")).toBeNull();
  const save = screen.getByRole("button", { name: "Save" });
  // The seeded draft is clean, so Save is disabled. There is no placeholder sentence.
  expect(save).toHaveProperty("disabled", true);
  expect(save.getAttribute("title")).toBeNull();
  expect(screen.queryByText("Not available yet")).toBeNull();
  expect(document.getElementById("editor-unavailable")).toBeNull();
  const importFile = screen.getByLabelText("Import JSON");
  // The import control is a file input. It is not tied to the Save button.
  expect(importFile.tagName).toBe("INPUT");
  expect(importFile.getAttribute("type")).toBe("file");
  expect(importFile.getAttribute("accept")).toBe(".json");
  expect(importFile).toHaveProperty("disabled", false);
  expect(importFile.getAttribute("title")).toBeNull();
  expect(sectionRows()).toHaveLength(6);
}

/**
 * Finds the editor package root.
 *
 * Purpose: the stylesheet check can run from the package directory or the workspace root.
 * Inputs: none.
 * Side effects: none.
 */
function editorPackageRoot(): string {
  const cwd = process.cwd();
  // The editor test script uses apps/editor as the working directory.
  if (existsSync(path.join(cwd, "app", "features", "editor", "editor-shell.css"))) {
    return cwd;
  }
  // A workspace-root run still stores the stylesheet under apps/editor.
  return path.join(cwd, "apps", "editor");
}

/**
 * Asserts the stylesheet keeps the desktop split and the phone width.
 *
 * Purpose: the breakpoint and the frame width are the layout contract, and this environment does not apply media queries.
 * Inputs: none.
 * Side effects: reads the shell stylesheet.
 */
function expectStylesheetToKeepTheDesktopSplit(): void {
  const css = readFileSync(path.join(editorPackageRoot(), "app", "features", "editor", "editor-shell.css"), "utf8");
  // Below 1024px one pane is hidden. At 1024px both panes show, and the frame fits a narrow viewport.
  expect(css).toContain("max-width: 1023px");
  expect(css).toContain("min-width: 1024px");
  expect(css).toContain("width: min(390px, 100%)");
  expect(css).toContain("overflow-x: clip");
}

/**
 * Registers the shell cases.
 *
 * Purpose: each case covers one behavior from the editor shell prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerShellCases(): void {
  // Rows, selection, add, reorder, remove, hints, panes, and a later loader payload.
  it("shows six rows for the hydrated demo document", expectHydratedDemoToShowSixRows);
  it("describes the selected section in the inspector", expectTheInspectorToDescribeTheFirstSection);
  it("selects the clicked row without reordering the preview", expectSelectingARowToUpdateTheInspectorOnly);
  it("shows seven rows after adding a carousel", expectAddingACarouselToShowSevenRows);
  it("appends a text section and selects it", expectAddingTextToAppendAndSelectIt);
  it("appends a button section and selects it", expectAddingAButtonToAppendAndSelectIt);
  it("swaps the first two preview placeholders when the first section is dragged down", expectDraggingTheFirstSectionDownToSwapTheFirstTwoPlaceholders);
  it("swaps the first two preview placeholders when the first section is dropped", expectAnHtmlDropToSwapTheFirstTwoPlaceholders);
  it("moves a dragged section to the end of the phone", expectDraggingASectionToTheEndToUpdateThePhone);
  it("leaves the order unchanged when a drag is too short or cancelled", expectAShortOrCancelledDragToLeaveTheOrder);
  it("keeps the current selection when a row is dragged", expectDraggingARowToKeepTheCurrentSelection);
  it("moves the second section up and keeps focus on its drag handle", expectMoveUpToSwapWithThePreviousRow);
  it("keeps focus on the drag handle when a section moves to the end", expectMoveDownOntoTheEndToFocusTheHandle);
  it("keeps each text placeholder title when one text row moves", expectTextPlaceholdersToKeepTheirTitles);
  it("leaves the other sections in order when a middle section is removed", expectRemovingAMiddleSectionToKeepTheOthersInOrder);
  it("inspects the next section when the selected middle row is removed", expectRemovingTheSelectedMiddleRowToInspectTheNext);
  it("inspects the previous section when the selected last row is removed", expectRemovingTheSelectedLastRowToInspectThePrevious);
  it("leaves a single section in place when its drag handle receives arrow keys", expectOneSectionToStayPutWhenReordered);
  it("focuses Add carousel when the only section is removed", expectRemovingTheOnlySectionToFocusAddCarousel);
  it("shows the empty editor and the empty preview after every section is removed", expectEmptyStateAfterRemovingEverySection);
  it("shows the empty editor when the loader document has no sections", expectAnEmptyDocumentToShowTheEmptyState);
  it("shows the new section when adding to an empty document", expectAddingToAnEmptyDocumentToShowTheNewSection);
  it("uses the first alt, the title, or the label as the hint", expectHintsToUseTheDistinguishingField);
  it("does not replace a dirty draft when the loader payload changes", expectALaterLoaderPayloadToLeaveTheDraft);
  it("does not replace a clean draft when the loader payload changes", expectACleanDraftToIgnoreALaterLoaderPayload);
  it("keeps Save disabled on a clean document while Import JSON accepts a JSON file", expectACleanDocumentToDisableSaveWhileImportAcceptsJson);
  it("keeps Editor and Preview in the tab order", expectPaneSwitchToKeepBothControls);
  it("keeps the desktop breakpoint and the phone frame in the stylesheet", expectStylesheetToKeepTheDesktopSplit);
}

afterEach(() => {
  cleanup();
});

describe("editor shell", registerShellCases);
