// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { configurationSchema, SUPPORTED_SCHEMA_VERSION, type Configuration, type Section } from "@reactiv/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateDraft } from "../editor/draft-document.js";
import { EditorShell } from "../editor/editor-shell.js";
import { EditorProvider } from "../editor/editor-context.js";
import { CarouselInspector } from "./carousel-inspector.js";
import { CarouselPreview } from "./carousel-preview.js";
import {
  EMPTY_CAROUSEL_MESSAGE,
  IMAGE_UNAVAILABLE_LABEL,
  IMAGE_URL_ERROR,
  NEXT_IMAGE_LABEL,
  PREVIOUS_IMAGE_LABEL,
  imageFinishedWithoutPixels,
} from "./carousel-fields.js";
import { sectionUiRegistry } from "./section-ui-registry.js";

/** One slide in a carousel fixture. */
type SlideSpec = {
  id: string;
  url: string;
  alt: string;
};

/**
 * Builds a carousel section for a fixture.
 *
 * Purpose: each test can choose its own ratio and slides.
 * Inputs: id, the section id. aspectRatio, the stored name. images, the slides in screen order.
 * Side effects: none.
 */
function carouselSection(
  id: string,
  aspectRatio: "portrait" | "landscape" | "square",
  images: readonly SlideSpec[],
): Section {
  const slides: SlideSpec[] = [];
  for (const image of images) {
    // Copy each slide so the fixture array is not the stored section array.
    slides.push({
      id: image.id,
      url: image.url,
      alt: image.alt,
    });
  }
  // The addresses are valid so the configuration schema can hydrate the provider.
  return {
    id,
    type: "carousel",
    aspectRatio,
    images: slides,
  };
}

/**
 * Wraps fixture sections in a configuration.
 *
 * Purpose: the provider hydrates from the same shape the loader returns, without a network call.
 * Inputs: sections, the ordered sections.
 * Side effects: none. Throws when the sections are not a valid configuration.
 */
function carouselConfiguration(sections: Section[]): Configuration {
  // id, revision, and updatedAt are service-owned fields the hydrate command expects.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: "cfg_carousel",
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
  const configuration = carouselConfiguration(sections);
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
 * Purpose: assertions can tell two carousels apart.
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
 * Reads the preview images for one carousel, in DOM order.
 *
 * Purpose: order assertions follow the slide elements, not the accessible names.
 * Inputs: sectionId, the draft id.
 * Side effects: none.
 */
function slideImages(sectionId: string): HTMLImageElement[] {
  const images: HTMLImageElement[] = [];
  for (const node of previewBlock(sectionId).querySelectorAll("img")) {
    if (node instanceof HTMLImageElement) {
      // DOM order is the carousel order.
      images.push(node);
    }
  }
  return images;
}

/**
 * Reads the frames for one carousel, in DOM order.
 *
 * Purpose: every slide in that carousel uses the same aspect-ratio style.
 * Inputs: sectionId, the draft id.
 * Side effects: none.
 */
function frames(sectionId: string): HTMLElement[] {
  const items: HTMLElement[] = [];
  for (const node of previewBlock(sectionId).querySelectorAll("[data-carousel-frame]")) {
    if (node instanceof HTMLElement) {
      // The frame is the element whose aspect-ratio style is the selected mode.
      items.push(node);
    }
  }
  return items;
}

/**
 * Reads one carousel's scroll region.
 *
 * Purpose: two carousels have two scrollers, and the snap style is on this element.
 * Inputs: sectionId, the draft id.
 * Side effects: none. Throws when the region is missing.
 */
function scroller(sectionId: string): HTMLElement {
  const region = previewBlock(sectionId).querySelector("[data-carousel-scroller]");
  if (!(region instanceof HTMLElement)) {
    throw new Error(`Missing scroller for ${sectionId}.`);
  }
  return region;
}

/**
 * Reads one named button inside one carousel preview.
 *
 * Purpose: Previous image and Next image stay on that carousel.
 * Inputs: sectionId, the draft id. name, the accessible name.
 * Side effects: none. Throws when the control is not a button.
 */
function previewControl(sectionId: string, name: string): HTMLButtonElement {
  const button = within(previewBlock(sectionId)).getByRole("button", { name });
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing ${name} for ${sectionId}.`);
  }
  return button;
}

/**
 * Asserts three slides render in list order.
 *
 * Purpose: the preview order matches the image array, including the middle slide.
 * Inputs: none.
 * Side effects: renders the shell.
 */
function expectThreeImagesToRenderInOrder(): void {
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
      { id: "three", url: "https://example.com/three.jpg", alt: "Third slide" },
    ]),
  ]);
  const images = slideImages("slides");
  // The phone follows the fixture order. The scroller snaps on the horizontal axis.
  expect(images.map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
    "https://example.com/three.jpg",
  ]);
  expect(images.map((image) => image.getAttribute("alt"))).toEqual(["First slide", "Second slide", "Third slide"]);
  const region = scroller("slides");
  const slides = region.querySelectorAll("[data-carousel-slide]");
  // One snap item per image. The region itself is the only list item for this section.
  expect(region.style.scrollSnapType).toBe("x mandatory");
  expect(region.style.overflowX).toBe("auto");
  expect(slides).toHaveLength(3);
  expect(previewBlock("slides").tagName).toBe("LI");
  expect(previewBlock("slides").querySelectorAll("li")).toHaveLength(0);
  for (const slide of slides) {
    if (slide instanceof HTMLElement) {
      // Each slide starts at the scroller's left edge when it is the selected snap.
      expect(slide.style.scrollSnapAlign).toBe("start");
      expect(slide.style.width).toBe("100%");
    }
  }
  expect(images.every((image) => image.style.objectFit === "cover")).toBe(true);
}

/**
 * Asserts editing the second address leaves the other slides alone.
 *
 * Purpose: the preview order stays, and only the edited src changes.
 * Inputs: none.
 * Side effects: renders the shell and types into the second Image URL field.
 */
async function expectEditingTheSecondUrlToChangeThatImageOnly(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
      { id: "three", url: "https://example.com/three.jpg", alt: "Third slide" },
    ]),
  ]);
  const fields = screen.getAllByLabelText("Image URL");
  const second = fields[1];
  if (second === undefined) {
    throw new Error("Missing the second Image URL field.");
  }
  await user.clear(second);
  await user.type(second, "https://example.com/changed.jpg");
  const images = slideImages("slides");
  // The first and third slides keep their addresses. The second alt stays Second slide.
  expect(images.map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/changed.jpg",
    "https://example.com/three.jpg",
  ]);
  expect(images[1]?.getAttribute("alt")).toBe("Second slide");
  expect(screen.getAllByLabelText("Alt text")[0]).toHaveProperty("value", "First slide");
  expect(screen.getAllByLabelText("Alt text")[2]).toHaveProperty("value", "Third slide");
}

/**
 * Asserts removing the only slide shows the empty message.
 *
 * Purpose: the carousel stays, Add image stays, and the preview does not throw.
 * Inputs: none.
 * Side effects: renders the shell and activates Remove image.
 */
async function expectRemovingTheLastImageToShowTheEmptyMessage(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "square", [{ id: "only", url: "https://example.com/only.jpg", alt: "Only slide" }]),
  ]);
  await user.click(screen.getByRole("button", { name: "Remove image 1" }));
  const preview = previewBlock("slides");
  const settings = screen.getByRole("region", { name: "Section settings" });
  // The message stays in the phone. Add image stays in the inspector, and both ends are disabled.
  expect(within(preview).getByText(EMPTY_CAROUSEL_MESSAGE)).toBeTruthy();
  expect(within(settings).queryByText(EMPTY_CAROUSEL_MESSAGE)).toBeNull();
  expect(within(settings).getByRole("button", { name: "Add image" })).toBeTruthy();
  expect(within(settings).queryAllByLabelText("Image URL")).toHaveLength(0);
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(screen.getByText("Type: carousel")).toBeTruthy();
  expect(slideImages("slides")).toHaveLength(0);
  expect(preview.querySelector("[data-carousel-scroller]")).toBeNull();
}

/**
 * Asserts Add image places the new slide after the ones already there.
 *
 * Purpose: the new id is last, and the earlier addresses stay in order.
 * Inputs: none.
 * Side effects: renders the shell and activates Add image.
 */
async function expectAddingAnImageToAppendIt(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  await user.click(screen.getByRole("button", { name: "Add image" }));
  const fields = screen.getAllByLabelText("Image URL");
  const images = slideImages("slides");
  // The blank slide is last. The first two sources are unchanged.
  expect(fields).toHaveLength(3);
  expect(fields[2]).toHaveProperty("value", "");
  expect(images).toHaveLength(3);
  expect(images[0]?.getAttribute("src")).toBe("https://example.com/one.jpg");
  expect(images[1]?.getAttribute("src")).toBe("https://example.com/two.jpg");
  expect(images[2]?.hasAttribute("src")).toBe(false);
  expect(images[2]?.getAttribute("alt")).toBe("Slide 3");
  const slideIds = previewBlock("slides").querySelectorAll("[data-carousel-slide]");
  // The appended slide has its own id. The earlier slides keep the ids they had.
  expect(slideIds[0]?.getAttribute("data-carousel-slide")).toBe("one");
  expect(slideIds[1]?.getAttribute("data-carousel-slide")).toBe("two");
  expect(slideIds[2]?.getAttribute("data-carousel-slide")).not.toBe("one");
  expect(slideIds[2]?.getAttribute("data-carousel-slide")).not.toBe("two");
  expect(slideIds[2]?.getAttribute("data-carousel-slide")).not.toBe("");
}

/**
 * Asserts Portrait, Landscape, and Square set the frame ratio.
 *
 * Purpose: the geometry gate is 3 / 4, 16 / 9, and 1 / 1, with cover cropping.
 * Inputs: none.
 * Side effects: renders the shell and chooses each radio.
 */
async function expectAspectRatiosToSetTheFrameStyle(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  const group = screen.getByRole("radiogroup", { name: "Aspect ratio" });
  // Landscape is the stored default for this fixture, and the CSS ratio is 16 / 9.
  expect(within(group).getByRole("radio", { name: "Landscape" })).toHaveProperty("checked", true);
  expect(frames("slides").map((frame) => frame.style.aspectRatio)).toEqual(["16 / 9", "16 / 9"]);
  expect(slideImages("slides").every((image) => image.style.objectFit === "cover")).toBe(true);
  await user.click(screen.getByRole("radio", { name: "Portrait" }));
  expect(within(group).getByRole("radio", { name: "Portrait" })).toHaveProperty("checked", true);
  expect(within(group).getByRole("radio", { name: "Landscape" })).toHaveProperty("checked", false);
  expect(frames("slides").every((frame) => frame.style.aspectRatio === "3 / 4")).toBe(true);
  await user.click(screen.getByRole("radio", { name: "Square" }));
  expect(within(group).getByRole("radio", { name: "Square" })).toHaveProperty("checked", true);
  expect(frames("slides").every((frame) => frame.style.aspectRatio === "1 / 1")).toBe(true);
  await user.click(screen.getByRole("radio", { name: "Landscape" }));
  // Returning to landscape uses 16 / 9, and the slide order is unchanged.
  expect(within(group).getByRole("radio", { name: "Landscape" })).toHaveProperty("checked", true);
  expect(frames("slides").every((frame) => frame.style.aspectRatio === "16 / 9")).toBe(true);
  expect(slideImages("slides").every((image) => image.style.objectFit === "cover")).toBe(true);
  expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
  ]);
}

/**
 * Asserts two carousels keep their own slides and ratios.
 *
 * Purpose: editing the first carousel does not change the second carousel's URL or frame.
 * Inputs: none.
 * Side effects: renders the shell, types a URL, and chooses Portrait.
 */
async function expectTwoCarouselsToStayIndependent(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("first", "landscape", [
      { id: "a1", url: "https://example.com/a-one.jpg", alt: "Alpha one" },
      { id: "a2", url: "https://example.com/a-two.jpg", alt: "Alpha two" },
    ]),
    carouselSection("second", "square", [{ id: "b1", url: "https://example.com/b-one.jpg", alt: "Beta one" }]),
  ]);
  const firstScroller = scroller("first");
  const secondScroller = scroller("second");
  // Each carousel has its own region. Moving one does not assign the other's scroll position.
  firstScroller.scrollLeft = 40;
  expect(firstScroller).not.toBe(secondScroller);
  expect(secondScroller.scrollLeft).toBe(0);
  expect(slideImages("second").map((image) => image.getAttribute("src"))).toEqual(["https://example.com/b-one.jpg"]);
  expect(frames("second")[0]?.style.aspectRatio).toBe("1 / 1");
  const firstField = screen.getAllByLabelText("Image URL")[0];
  if (firstField === undefined) {
    throw new Error("Missing the first Image URL field.");
  }
  await user.clear(firstField);
  await user.type(firstField, "https://example.com/a-changed.jpg");
  await user.click(screen.getByRole("radio", { name: "Portrait" }));
  // The selected carousel changed. The other carousel still shows its own slide and square frame.
  expect(slideImages("first")[0]?.getAttribute("src")).toBe("https://example.com/a-changed.jpg");
  expect(frames("first").every((frame) => frame.style.aspectRatio === "3 / 4")).toBe(true);
  expect(slideImages("second").map((image) => image.getAttribute("src"))).toEqual(["https://example.com/b-one.jpg"]);
  expect(frames("second")[0]?.style.aspectRatio).toBe("1 / 1");
  expect(slideImages("second")[0]?.getAttribute("alt")).toBe("Beta one");
}

/**
 * Asserts Previous image and Next image are buttons that stop at the ends.
 *
 * Purpose: the controls are keyboard buttons, and they do not wrap past the first or last slide.
 * Inputs: none.
 * Side effects: renders the shell and activates Next image, then Previous image.
 */
async function expectPreviousAndNextToBeButtons(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  const previous = previewControl("slides", PREVIOUS_IMAGE_LABEL);
  const next = previewControl("slides", NEXT_IMAGE_LABEL);
  // Both controls are buttons. The first slide disables Previous image.
  expect(previous.tagName).toBe("BUTTON");
  expect(next.tagName).toBe("BUTTON");
  expect(previous.getAttribute("type")).toBe("button");
  expect(next.getAttribute("type")).toBe("button");
  expect(previous.disabled).toBe(true);
  expect(next.disabled).toBe(false);
  expect(previous.getAttribute("aria-controls")).toBe(scroller("slides").id);
  expect(next.getAttribute("aria-controls")).toBe("carousel-scroller-slides");
  // The first slide's Previous control is disabled, so the keyboard stop is Next image.
  next.focus();
  expect(document.activeElement).toBe(next);
  await user.keyboard("{Enter}");
  // The last slide disables Next image. Previous image can move back, and it does not wrap.
  const previousAfterNext = previewControl("slides", PREVIOUS_IMAGE_LABEL);
  expect(previousAfterNext.disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  previousAfterNext.focus();
  await user.keyboard("{Enter}");
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(false);
  expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
  ]);
}

/**
 * Asserts a non-empty invalid address is named, and an empty address is not.
 *
 * Purpose: notaurl stays in the field. Clearing the field removes the error and does not throw.
 * Inputs: none.
 * Side effects: renders the shell and types into Image URL.
 */
async function expectAnInvalidUrlToStayInTheField(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  const fields = screen.getAllByLabelText("Image URL");
  const first = fields[0];
  if (first === undefined) {
    throw new Error("Missing the first Image URL field.");
  }
  await user.clear(first);
  // Empty is in progress. The second slide still has its address, and there is no error yet.
  expect(first).toHaveProperty("value", "");
  expect(screen.queryByText(IMAGE_URL_ERROR)).toBeNull();
  expect(slideImages("slides")[0]?.hasAttribute("src")).toBe(false);
  expect(slideImages("slides")[1]?.getAttribute("src")).toBe("https://example.com/two.jpg");
  await user.type(first, "notaurl");
  // The invalid text stays. It is not requested as an image, and the other slide is unchanged.
  expect(screen.getByLabelText("Image URL", { selector: "#carousel-url-slides-one" })).toHaveProperty("value", "notaurl");
  expect(screen.getByText(IMAGE_URL_ERROR)).toBeTruthy();
  expect(slideImages("slides")[0]?.hasAttribute("src")).toBe(false);
  expect(slideImages("slides")[1]?.getAttribute("src")).toBe("https://example.com/two.jpg");
  expect(screen.getByText("Type: carousel")).toBeTruthy();
}

/**
 * Asserts a blank alt is the accessible name Slide n and is not a caption.
 *
 * Purpose: the fallback is on the img only. The empty message is a different sentence.
 * Inputs: none.
 * Side effects: renders the shell.
 */
function expectABlankAltToUseTheSlideName(): void {
  renderEditor([
    carouselSection("slides", "portrait", [
      { id: "blank", url: "https://example.com/blank.jpg", alt: "   " },
      { id: "named", url: "https://example.com/named.jpg", alt: "Named slide" },
    ]),
  ]);
  const images = slideImages("slides");
  // Spaces are blank. Slide 1 is the accessible name, and it is not painted as a caption.
  expect(images[0]?.getAttribute("alt")).toBe("Slide 1");
  expect(images[1]?.getAttribute("alt")).toBe("Named slide");
  expect(screen.getByRole("img", { name: "Slide 1" })).toBeTruthy();
  expect(previewBlock("slides").textContent?.includes("Slide 1")).toBe(false);
  expect(screen.queryByText(EMPTY_CAROUSEL_MESSAGE)).toBeNull();
}

/**
 * Builds a DOM rectangle at one horizontal position.
 *
 * Purpose: a scroll test can place a slide inside or outside the scroller.
 * Inputs: left, the rectangle's left edge.
 * Side effects: none.
 */
function horizontalRect(left: number): DOMRect {
  // The preview compares left edges. The other fields complete the rectangle.
  return {
    x: left,
    y: 0,
    left,
    top: 0,
    right: left + 100,
    bottom: 100,
    width: 100,
    height: 100,
    toJSON() {
      // The preview does not read the JSON form.
      return {};
    },
  } as DOMRect;
}

/**
 * Makes one scroller report a scrollport and one left edge per slide.
 *
 * Purpose: happy-dom does not lay out the phone, so a drag test supplies the boxes the preview reads.
 * Inputs: sectionId, the carousel. leftEdges, one left edge per slide. Later writes to that array move the slides.
 * Side effects: replaces measurements on that scroller and its slides.
 */
function reportSlidePositions(sectionId: string, leftEdges: number[]): void {
  const region = scroller(sectionId);
  Object.defineProperty(region, "scrollWidth", {
    configurable: true,
    get() {
      // Wider than the port, so a scroll event counts as a move.
      return 900;
    },
  });
  Object.defineProperty(region, "clientWidth", {
    configurable: true,
    get() {
      // The port is narrower than the scroll width.
      return 300;
    },
  });
  // The scroller's left edge is the origin the slides are compared with.
  region.getBoundingClientRect = () => horizontalRect(0);
  const slides = region.querySelectorAll("[data-carousel-slide]");
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides.item(index);
    if (slide instanceof HTMLElement) {
      // Read the live array so a later step can move this slide.
      slide.getBoundingClientRect = () => horizontalRect(leftEdges[index] ?? 0);
    }
  }
}

/**
 * Sends a scroll event from one carousel's region.
 *
 * Purpose: a drag updates the buttons without using Previous image or Next image.
 * Inputs: sectionId, the carousel.
 * Side effects: dispatches a scroll event on that region.
 */
function dispatchScrollerScroll(sectionId: string): void {
  const region = scroller(sectionId);
  act(() => {
    // The preview listens on this region. Another carousel has a different element.
    region.dispatchEvent(new Event("scroll"));
  });
}

/**
 * Asserts removing the middle slide leaves the others in order.
 *
 * Purpose: Remove image deletes that slide only, and the preview stays on the first remaining slide.
 * Inputs: none.
 * Side effects: renders the shell and activates Remove image 2.
 */
async function expectRemovingTheMiddleImageToLeaveTheOthers(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
      { id: "three", url: "https://example.com/three.jpg", alt: "Third slide" },
    ]),
  ]);
  await user.click(screen.getByRole("button", { name: "Remove image 2" }));
  // The middle address is gone. The first slide is still the start, so Next image can reach the third.
  expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/three.jpg",
  ]);
  expect(slideImages("slides").map((image) => image.getAttribute("alt"))).toEqual(["First slide", "Third slide"]);
  expect(screen.getAllByLabelText("Image URL").map((field) => (field as HTMLInputElement).value)).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/three.jpg",
  ]);
  expect(screen.queryByRole("button", { name: "Remove image 3" })).toBeNull();
  expect(screen.getByRole("button", { name: "Remove image 2" }).textContent).toBe("Remove image");
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(false);
  expect(frames("slides").every((frame) => frame.style.aspectRatio === "16 / 9")).toBe(true);
}

/**
 * Asserts removing the slide in view stops on the new last slide.
 *
 * Purpose: a tail removal does not leave Next image enabled past the end, and it does not wrap to the first slide.
 * Inputs: none.
 * Side effects: renders the shell, moves to the last slide, and removes it.
 */
async function expectRemovingTheViewedTailToStopOnTheNewEnd(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "square", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
      { id: "three", url: "https://example.com/three.jpg", alt: "Third slide" },
    ]),
  ]);
  await user.click(previewControl("slides", NEXT_IMAGE_LABEL));
  await user.click(previewControl("slides", NEXT_IMAGE_LABEL));
  // The third slide is in view. Removing it leaves the second slide at the end.
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Remove image 3" }));
  expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
  ]);
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(frames("slides").every((frame) => frame.style.aspectRatio === "1 / 1")).toBe(true);
}

/**
 * Asserts one slide disables both ends.
 *
 * Purpose: Previous image and Next image do not wrap when there is nowhere to go.
 * Inputs: none.
 * Side effects: renders the shell.
 */
function expectOneImageToDisableBothControls(): void {
  renderEditor([
    carouselSection("slides", "portrait", [{ id: "only", url: "https://example.com/only.jpg", alt: "Only slide" }]),
  ]);
  // The only slide is both the start and the end. Its frame is the portrait ratio.
  expect(slideImages("slides")).toHaveLength(1);
  expect(slideImages("slides")[0]?.getAttribute("alt")).toBe("Only slide");
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(frames("slides")[0]?.style.aspectRatio).toBe("3 / 4");
  expect(screen.queryByText(EMPTY_CAROUSEL_MESSAGE)).toBeNull();
}

/**
 * Asserts Next image and Previous image move one slide at a time.
 *
 * Purpose: the middle slide enables both controls, and the ends do not wrap.
 * Inputs: none.
 * Side effects: renders the shell and activates the controls.
 */
async function expectTheControlsToMoveOneSlideAtATime(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
      { id: "three", url: "https://example.com/three.jpg", alt: "Third slide" },
    ]),
  ]);
  await user.click(previewControl("slides", NEXT_IMAGE_LABEL));
  // The middle slide can move either way. The addresses stay in list order.
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(false);
  await user.click(previewControl("slides", NEXT_IMAGE_LABEL));
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  await user.click(previewControl("slides", PREVIOUS_IMAGE_LABEL));
  // One step back is the middle, not the first slide.
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(false);
  expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
    "https://example.com/three.jpg",
  ]);
}

/**
 * Asserts a ratio change keeps the slide that is in view.
 *
 * Purpose: Portrait does not restart the carousel at the first slide or drop an address.
 * Inputs: none.
 * Side effects: renders the shell, moves to the last slide, and chooses Portrait.
 */
async function expectARatioChangeToKeepTheCurrentSlide(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  await user.click(previewControl("slides", NEXT_IMAGE_LABEL));
  await user.click(screen.getByRole("radio", { name: "Portrait" }));
  // The last slide is still the end. The frames use the portrait ratio and still cover the image.
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(frames("slides").every((frame) => frame.style.aspectRatio === "3 / 4")).toBe(true);
  expect(slideImages("slides").every((image) => image.style.objectFit === "cover")).toBe(true);
  expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
  ]);
}

/**
 * Asserts Add image on an empty carousel restores one unfinished slide.
 *
 * Purpose: the empty message leaves, and both controls stay disabled until a second slide exists.
 * Inputs: none.
 * Side effects: renders the shell, removes the only slide, and activates Add image.
 */
async function expectAddingToAnEmptyCarouselToRestoreOneSlide(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "square", [{ id: "only", url: "https://example.com/only.jpg", alt: "Only slide" }]),
  ]);
  await user.click(screen.getByRole("button", { name: "Remove image 1" }));
  await user.click(screen.getByRole("button", { name: "Add image" }));
  const images = slideImages("slides");
  // The new slide is unfinished. Slide 1 is its accessible name, and the empty message is gone.
  expect(screen.queryByText(EMPTY_CAROUSEL_MESSAGE)).toBeNull();
  expect(screen.getAllByLabelText("Image URL")).toHaveLength(1);
  expect(screen.getByLabelText("Image URL")).toHaveProperty("value", "");
  expect(screen.getByLabelText("Alt text")).toHaveProperty("value", "");
  expect(images).toHaveLength(1);
  expect(images[0]?.hasAttribute("src")).toBe(false);
  expect(images[0]?.getAttribute("alt")).toBe("Slide 1");
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(frames("slides")[0]?.style.aspectRatio).toBe("1 / 1");
}

/**
 * Asserts appending while the last slide is in view reveals the new end.
 *
 * Purpose: the new slide comes after the current one, and the carousel does not jump back to the first.
 * Inputs: none.
 * Side effects: renders the shell, moves to the last slide, and activates Add image.
 */
async function expectAddingAtTheEndToEnableTheNextControl(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  await user.click(previewControl("slides", NEXT_IMAGE_LABEL));
  await user.click(screen.getByRole("button", { name: "Add image" }));
  // The view stays off the first slide, and Next image can reach the blank slide.
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(false);
  expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
    null,
  ]);
  expect(slideImages("slides")[2]?.getAttribute("alt")).toBe("Slide 3");
  expect(screen.getAllByLabelText("Alt text")[2]).toHaveProperty("value", "");
}

/**
 * Asserts an alt edit changes that image's name only.
 *
 * Purpose: surrounding spaces stay in the accessible name, and a cleared alt becomes Slide n without a caption.
 * Inputs: none.
 * Side effects: renders the shell and types into Alt text.
 */
async function expectAnAltEditToChangeThatImageNameOnly(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "portrait", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  const alts = screen.getAllByLabelText("Alt text");
  const firstAlt = alts[0];
  if (firstAlt === undefined) {
    throw new Error("Missing the first Alt text field.");
  }
  await user.clear(firstAlt);
  await user.type(firstAlt, "  Window  ");
  // The spaces are part of the name. The list hint uses that same alt, and the address stays.
  expect(slideImages("slides")[0]?.getAttribute("alt")).toBe("  Window  ");
  expect(slideImages("slides")[0]?.getAttribute("src")).toBe("https://example.com/one.jpg");
  expect(slideImages("slides")[1]?.getAttribute("alt")).toBe("Second slide");
  expect(previewBlock("slides").getAttribute("data-preview-hint")).toBe("  Window  ");
  expect(document.getElementById("section-select-slides")?.getAttribute("aria-label")).toBe(
    "Select Carousel,   Window  ",
  );
  await user.clear(firstAlt);
  // A cleared alt is Slide 1 on the image only. The row hint falls back, and the second slide is unchanged.
  expect(slideImages("slides")[0]?.getAttribute("alt")).toBe("Slide 1");
  expect(previewBlock("slides").textContent?.includes("Slide 1")).toBe(false);
  expect(previewBlock("slides").getAttribute("data-preview-hint")).toBe("Empty carousel");
  expect(slideImages("slides")[1]?.getAttribute("alt")).toBe("Second slide");
  expect(slideImages("slides")[1]?.getAttribute("src")).toBe("https://example.com/two.jpg");
  expect(screen.getAllByLabelText("Image URL")[0]).toHaveProperty("value", "https://example.com/one.jpg");
}

/**
 * Asserts unsafe and unfinished addresses stay out of the image request.
 *
 * Purpose: a script URL, embedded credentials, a missing host, spaces, and an over-long URL name the field and are not src.
 * An empty value clears the error. An http URL is requested as typed. The other slide stays valid.
 * Inputs: none.
 * Side effects: renders the shell and types into Image URL.
 */
async function expectUnsafeUrlsToStayOffTheImage(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  const fields = screen.getAllByLabelText("Image URL");
  const first = fields[0];
  const second = fields[1];
  if (first === undefined || second === undefined) {
    throw new Error("Missing an Image URL field.");
  }
  await user.clear(first);
  await user.type(first, "javascript:alert(1)");
  // The script URL stays typed. It is not assigned to src, and the second slide is still valid.
  expect(first).toHaveProperty("value", "javascript:alert(1)");
  expect(first.getAttribute("aria-invalid")).toBe("true");
  expect(first.getAttribute("aria-describedby")).toBe("carousel-url-slides-one-error");
  expect(screen.getAllByText(IMAGE_URL_ERROR)).toHaveLength(1);
  expect(slideImages("slides")[0]?.hasAttribute("src")).toBe(false);
  expect(second.getAttribute("aria-invalid")).toBe("false");
  expect(slideImages("slides")[1]?.getAttribute("src")).toBe("https://example.com/two.jpg");
  await user.clear(first);
  // Empty clears the error and still does not request the page.
  expect(first).toHaveProperty("value", "");
  expect(first.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(IMAGE_URL_ERROR)).toBeNull();
  expect(slideImages("slides")[0]?.hasAttribute("src")).toBe(false);
  await user.type(first, "https://user:pass@example.com/secret.jpg");
  expect(first).toHaveProperty("value", "https://user:pass@example.com/secret.jpg");
  expect(screen.getByText(IMAGE_URL_ERROR)).toBeTruthy();
  expect(slideImages("slides")[0]?.hasAttribute("src")).toBe(false);
  await user.clear(first);
  await user.type(first, "http://");
  // A missing host is invalid. Spaces are invalid too, and they are not treated as an empty field.
  expect(screen.getByText(IMAGE_URL_ERROR)).toBeTruthy();
  expect(slideImages("slides")[0]?.hasAttribute("src")).toBe(false);
  await user.clear(first);
  await user.type(first, "   ");
  expect(first).toHaveProperty("value", "   ");
  expect(screen.getByText(IMAGE_URL_ERROR)).toBeTruthy();
  expect(slideImages("slides")[0]?.hasAttribute("src")).toBe(false);
  await user.clear(first);
  const longUrl = `https://example.com/${"a".repeat(2048)}`;
  await user.click(first);
  await user.paste(longUrl);
  // The over-long address is kept and is not requested.
  expect(first).toHaveProperty("value", longUrl);
  expect(first.getAttribute("aria-invalid")).toBe("true");
  expect(slideImages("slides")[0]?.hasAttribute("src")).toBe(false);
  await user.clear(first);
  await user.type(first, "http://example.com/plain.jpg");
  // http is requested as typed. The second slide can then fail on its own.
  expect(screen.queryByText(IMAGE_URL_ERROR)).toBeNull();
  expect(first.getAttribute("aria-invalid")).toBe("false");
  expect(slideImages("slides")[0]?.getAttribute("src")).toBe("http://example.com/plain.jpg");
  await user.clear(second);
  await user.type(second, "javascript:alert(2)");
  expect(second).toHaveProperty("value", "javascript:alert(2)");
  expect(second.getAttribute("aria-invalid")).toBe("true");
  expect(first.getAttribute("aria-invalid")).toBe("false");
  expect(slideImages("slides")[0]?.getAttribute("src")).toBe("http://example.com/plain.jpg");
  expect(slideImages("slides")[1]?.hasAttribute("src")).toBe(false);
  expect(slideImages("slides")[0]?.getAttribute("alt")).toBe("First slide");
}

/**
 * Asserts each carousel keeps its own place in the list.
 *
 * Purpose: Next image on one carousel does not move the other carousel's controls, slides, or ratio.
 * Inputs: none.
 * Side effects: renders the shell and activates Next image on each carousel.
 */
async function expectEachCarouselToKeepItsOwnPlace(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("first", "landscape", [
      { id: "a1", url: "https://example.com/a-one.jpg", alt: "Alpha one" },
      { id: "a2", url: "https://example.com/a-two.jpg", alt: "Alpha two" },
    ]),
    carouselSection("second", "portrait", [
      { id: "b1", url: "https://example.com/b-one.jpg", alt: "Beta one" },
      { id: "b2", url: "https://example.com/b-two.jpg", alt: "Beta two" },
    ]),
  ]);
  await user.click(previewControl("first", NEXT_IMAGE_LABEL));
  // The first carousel is at its end. The second is still on its first slide.
  expect(previewControl("first", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("first", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("second", PREVIOUS_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("second", NEXT_IMAGE_LABEL).disabled).toBe(false);
  expect(frames("first").every((frame) => frame.style.aspectRatio === "16 / 9")).toBe(true);
  expect(frames("second").every((frame) => frame.style.aspectRatio === "3 / 4")).toBe(true);
  await user.click(previewControl("second", NEXT_IMAGE_LABEL));
  // Moving the second carousel does not bring the first one back to its start.
  expect(previewControl("second", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("second", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("first", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("first", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(slideImages("first").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/a-one.jpg",
    "https://example.com/a-two.jpg",
  ]);
  expect(slideImages("second").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/b-one.jpg",
    "https://example.com/b-two.jpg",
  ]);
}

/**
 * Asserts the inspector edits the carousel that is selected.
 *
 * Purpose: choosing the second carousel and changing its address leaves the first carousel's slides and ratio.
 * Inputs: none.
 * Side effects: renders the shell, selects the second carousel, and types a URL.
 */
async function expectTheSelectedCarouselToBeTheOneThatChanges(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("first", "landscape", [
      { id: "a1", url: "https://example.com/a-one.jpg", alt: "Alpha one" },
      { id: "a2", url: "https://example.com/a-two.jpg", alt: "Alpha two" },
    ]),
    carouselSection("second", "square", [
      { id: "b1", url: "https://example.com/b-one.jpg", alt: "Beta one" },
      { id: "b2", url: "https://example.com/b-two.jpg", alt: "Beta two" },
    ]),
  ]);
  await user.click(screen.getByRole("button", { name: "Select Carousel, Beta one" }));
  const fields = screen.getAllByLabelText("Image URL");
  const selectedUrl = fields[0];
  if (selectedUrl === undefined) {
    throw new Error("Missing the selected carousel's Image URL field.");
  }
  // The inspector is the second carousel. Square is selected, and its slides are the fields.
  expect(fields.map((field) => (field as HTMLInputElement).value)).toEqual([
    "https://example.com/b-one.jpg",
    "https://example.com/b-two.jpg",
  ]);
  expect(screen.getByRole("radio", { name: "Square" })).toHaveProperty("checked", true);
  expect(screen.getByRole("radio", { name: "Landscape" })).toHaveProperty("checked", false);
  await user.clear(selectedUrl);
  await user.type(selectedUrl, "https://example.com/b-changed.jpg");
  // The selected address changed. The first carousel still has both of its slides and the landscape frames.
  expect(slideImages("second")[0]?.getAttribute("src")).toBe("https://example.com/b-changed.jpg");
  expect(slideImages("second")[1]?.getAttribute("src")).toBe("https://example.com/b-two.jpg");
  expect(frames("second").every((frame) => frame.style.aspectRatio === "1 / 1")).toBe(true);
  expect(slideImages("first").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/a-one.jpg",
    "https://example.com/a-two.jpg",
  ]);
  expect(frames("first").every((frame) => frame.style.aspectRatio === "16 / 9")).toBe(true);
}

/**
 * Asserts a scroll event moves the controls, and Next image ignores the scroll it causes.
 *
 * Purpose: dragging to a slide disables the matching end, and the control's own event does not bounce backward.
 * Inputs: none.
 * Side effects: renders the shell, dispatches scroll events, and activates Next image.
 */
async function expectADragToMoveTheControlsWithoutBouncing(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  const leftEdges = [0, 300];
  reportSlidePositions("slides", leftEdges);
  const region = scroller("slides");
  region.scrollTo = () => {
    // The control scrolls while the boxes still show the first slide. That event must not win.
    region.dispatchEvent(new Event("scroll"));
  };
  await user.click(previewControl("slides", NEXT_IMAGE_LABEL));
  // Next image stored the second slide even though its scroll event still measured the first.
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  dispatchScrollerScroll("slides");
  // A later drag back to the first slide is honored once that control's event has finished.
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(true);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(false);
  leftEdges[0] = -300;
  leftEdges[1] = 0;
  dispatchScrollerScroll("slides");
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
  expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/one.jpg",
    "https://example.com/two.jpg",
  ]);
}

/**
 * Asserts an unmoved region does not undo Next image.
 *
 * Purpose: a scroll event that cannot reveal another slide keeps the button index.
 * Inputs: none.
 * Side effects: renders the shell, activates Next image, and dispatches a scroll event.
 */
async function expectAnUnmovedScrollToKeepTheButtonIndex(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  await user.click(previewControl("slides", NEXT_IMAGE_LABEL));
  dispatchScrollerScroll("slides");
  // The region has no overflow in this environment. The second slide stays the selected end.
  expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(false);
  expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(true);
}

/**
 * Asserts the slides do not advance on a timer.
 *
 * Purpose: the carousel has no automatic motion. Ten seconds leaves the first slide selected.
 * Inputs: none.
 * Side effects: renders the shell and advances fake timers.
 */
async function expectTheCarouselToStayStillWithoutATimer(): Promise<void> {
  vi.useFakeTimers();
  try {
    renderEditor([
      carouselSection("slides", "landscape", [
        { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
        { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
      ]),
    ]);
    await act(async () => {
      // A timer-based carousel would leave the first slide during this wait.
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(previewControl("slides", PREVIOUS_IMAGE_LABEL).disabled).toBe(true);
    expect(previewControl("slides", NEXT_IMAGE_LABEL).disabled).toBe(false);
    expect(slideImages("slides").map((image) => image.getAttribute("src"))).toEqual([
      "https://example.com/one.jpg",
      "https://example.com/two.jpg",
    ]);
  } finally {
    // Later cases use real timers and user events.
    vi.useRealTimers();
  }
}

/**
 * Renders one carousel to an HTML string.
 *
 * Purpose: the server markup can be checked before the client buttons are live.
 * Inputs: sections, the ordered sections.
 * Side effects: none.
 */
function carouselServerHtml(sections: Section[]): string {
  const configuration = carouselConfiguration(sections);
  // Effects do not run. data-carousel-ready stays false in this string.
  return renderToString(
    <EditorProvider initialConfiguration={configuration} initialEtag={'"1"'}>
      <EditorShell title="Editor" />
    </EditorProvider>,
  );
}

/**
 * Asserts the server paints the slides and the empty message before the client mounts.
 *
 * Purpose: the scroll controls wait for the client, and the phone still shows the images or the empty sentence.
 * Inputs: none.
 * Side effects: renders the shell on the client after reading the server strings.
 */
function expectTheServerMarkupToShowTheCarouselBeforeTheClientIsReady(): void {
  const populated = carouselServerHtml([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
  ]);
  // The buttons are in the HTML, and they are not marked ready until the client effect runs.
  expect(populated).toContain('data-carousel-ready="false"');
  expect(populated).toContain("https://example.com/one.jpg");
  expect(populated).toContain("https://example.com/two.jpg");
  expect(populated).toContain("16 / 9");
  expect(populated).toContain("First slide");
  expect(populated).toContain("Second slide");
  expect(populated).not.toContain(EMPTY_CAROUSEL_MESSAGE);
  const empty = carouselServerHtml([carouselSection("slides", "square", [])]);
  // An empty list is a sentence in the server HTML. It does not throw and it does not wait for the client.
  expect(empty).toContain(EMPTY_CAROUSEL_MESSAGE);
  expect(empty).toContain('data-carousel-ready="false"');
  expect(empty).not.toContain("https://example.com");
  renderEditor([
    carouselSection("slides", "portrait", [{ id: "only", url: "https://example.com/only.jpg", alt: "Only slide" }]),
  ]);
  // The client effect marks the same preview ready, and the portrait frame is present.
  expect(previewBlock("slides").getAttribute("data-carousel-ready")).toBe("true");
  expect(frames("slides")[0]?.style.aspectRatio).toBe("3 / 4");
}

/**
 * Asserts the static registry points carousel at the carousel components.
 *
 * Purpose: the shell reads this entry for the inspector and the phone.
 * Inputs: none.
 * Side effects: none.
 */
function expectTheRegistryToRegisterTheCarousel(): void {
  // The keys are the three stored types. Carousel is no longer the pending sentence.
  expect(Object.keys(sectionUiRegistry)).toEqual(["carousel", "text", "cta"]);
  expect(sectionUiRegistry.carousel.Inspector).toBe(CarouselInspector);
  expect(sectionUiRegistry.carousel.Preview).toBe(CarouselPreview);
}

/**
 * Reads one slide image.
 *
 * Purpose: a failure test can name the image it is about to break.
 * Inputs: sectionId, the draft id. index, the zero-based position.
 * Side effects: none. Throws when that image is missing.
 */
function requireSlideImage(sectionId: string, index: number): HTMLImageElement {
  const image = slideImages(sectionId)[index];
  if (!(image instanceof HTMLImageElement)) {
    // The caller expected a mounted img at this position.
    throw new Error(`Missing image ${index} for ${sectionId}.`);
  }
  return image;
}

/**
 * Reads one slide frame.
 *
 * Purpose: the placeholder and the aspect ratio are checked on that frame.
 * Inputs: sectionId, the draft id. index, the zero-based position.
 * Side effects: none. Throws when that frame is missing.
 */
function requireFrame(sectionId: string, index: number): HTMLElement {
  const frame = frames(sectionId)[index];
  if (!(frame instanceof HTMLElement)) {
    // The caller expected a frame at this position.
    throw new Error(`Missing frame ${index} for ${sectionId}.`);
  }
  return frame;
}

/**
 * Reads one image URL field.
 *
 * Purpose: a failed load must leave the typed address in that field.
 * Inputs: sectionId, the carousel id. imageId, the slide id.
 * Side effects: none. Throws when the field is missing.
 */
function requireUrlField(sectionId: string, imageId: string): HTMLInputElement {
  const field = document.getElementById(`carousel-url-${sectionId}-${imageId}`);
  if (!(field instanceof HTMLInputElement)) {
    // The inspector renders this id for the selected carousel.
    throw new Error(`Missing Image URL for ${sectionId} ${imageId}.`);
  }
  return field;
}

/**
 * Asserts a frame keeps its ratio before the image has loaded.
 *
 * Purpose: https://example.com/missing.png renders, and the portrait frame is 3 / 4 without a successful decode.
 * Inputs: none.
 * Side effects: renders the shell.
 */
function expectAFrameToKeepItsRatioBeforeTheImageLoads(): void {
  const html = carouselServerHtml([
    carouselSection("slides", "portrait", [
      { id: "missing", url: "https://example.com/missing.png", alt: "Missing product" },
    ]),
  ]);
  // The server markup includes the missing address and the portrait ratio. Rendering it does not throw.
  expect(html).toContain("https://example.com/missing.png");
  expect(html).toContain("3 / 4");
  expect(html).not.toContain(IMAGE_UNAVAILABLE_LABEL);
  renderEditor([
    carouselSection("slides", "portrait", [
      { id: "missing", url: "https://example.com/missing.png", alt: "Missing product" },
    ]),
  ]);
  const frame = requireFrame("slides", 0);
  const image = requireSlideImage("slides", 0);
  // The frame is reserved before a load event. The image is still the typed URL.
  expect(frame.style.aspectRatio).toBe("3 / 4");
  expect(frame.style.position).toBe("relative");
  expect(frame.style.backgroundColor).toBe("#f3efe6");
  expect(image.getAttribute("src")).toBe("https://example.com/missing.png");
  expect(image.outerHTML.toLowerCase()).not.toContain("authorization");
  expect(screen.queryByText(IMAGE_UNAVAILABLE_LABEL)).toBeNull();
}

/**
 * Asserts the first image is eager and the second image is lazy.
 *
 * Purpose: later slides can wait. The first slide in the carousel does not use lazy loading.
 * Inputs: none.
 * Side effects: renders the shell.
 */
function expectLaterImagesToLoadLazily(): void {
  renderEditor([
    carouselSection("slides", "landscape", [
      { id: "one", url: "https://example.com/one.jpg", alt: "First slide" },
      { id: "two", url: "https://example.com/two.jpg", alt: "Second slide" },
      { id: "three", url: "https://example.com/missing.png", alt: "Third slide" },
    ]),
  ]);
  const first = requireSlideImage("slides", 0);
  const second = requireSlideImage("slides", 1);
  const third = requireSlideImage("slides", 2);
  // The first image loads now. The later images are allowed to wait.
  expect(first.getAttribute("loading")).toBe("eager");
  expect(first.getAttribute("loading")).not.toBe("lazy");
  expect(second.getAttribute("loading")).toBe("lazy");
  expect(third.getAttribute("loading")).toBe("lazy");
  expect(first.outerHTML.toLowerCase()).not.toContain("authorization");
  expect(second.outerHTML.toLowerCase()).not.toContain("authorization");
}

/**
 * Asserts a failed image stays in its frame and the rest of the editor stays usable.
 *
 * Purpose: the error event shows Image unavailable, leaves the other carousel mounted, and keeps the URL.
 * A 404 address stays a valid document. The inspector can still edit both slides.
 * Inputs: none.
 * Side effects: renders the shell, dispatches error, and types into Image URL fields.
 */
async function expectABrokenImageToShowThePlaceholder(): Promise<void> {
  const user = userEvent.setup();
  const missingUrl = "https://example.com/missing.png";
  renderEditor([
    carouselSection("broken", "landscape", [
      { id: "missing", url: missingUrl, alt: "Missing product" },
      { id: "second", url: "https://example.com/two.jpg", alt: "Second slide" },
    ]),
    carouselSection("other", "square", [{ id: "kept", url: "https://example.com/kept.jpg", alt: "Kept slide" }]),
  ]);
  const failingImage = requireSlideImage("broken", 0);
  const secondImage = requireSlideImage("broken", 1);
  const otherImage = requireSlideImage("other", 0);
  const failingField = requireUrlField("broken", "missing");
  // The frame is 16 / 9 before the failure. The typed URL is already in the field.
  expect(requireFrame("broken", 0).style.aspectRatio).toBe("16 / 9");
  expect(failingField).toHaveProperty("value", missingUrl);
  fireEvent.error(failingImage);
  const failedFrame = requireFrame("broken", 0);
  // The placeholder is inside the same frame. The ratio and the other images stay.
  expect(failedFrame.style.aspectRatio).toBe("16 / 9");
  expect(within(failedFrame).getByText(IMAGE_UNAVAILABLE_LABEL)).toBeTruthy();
  expect(within(failedFrame).getByText("Missing product")).toBeTruthy();
  expect(failedFrame.querySelector("img")).toBeNull();
  expect(slideImages("broken")[0]).toBe(secondImage);
  expect(slideImages("other")[0]).toBe(otherImage);
  expect(otherImage.getAttribute("src")).toBe("https://example.com/kept.jpg");
  expect(requireUrlField("broken", "missing")).toHaveProperty("value", missingUrl);
  expect(failingField.getAttribute("aria-invalid")).toBe("false");
  expect(screen.queryByText(IMAGE_URL_ERROR)).toBeNull();
  expect(document.getElementById("section-select-broken")).toBeTruthy();
  expect(document.getElementById("section-select-other")).toBeTruthy();
  const validity = validateDraft({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: {
      sections: [
        carouselSection("broken", "landscape", [
          { id: "missing", url: missingUrl, alt: "Missing product" },
          { id: "second", url: "https://example.com/two.jpg", alt: "Second slide" },
        ]),
      ],
    },
  });
  // A syntactically valid URL that fails to load is still a valid document.
  expect(validity.ok).toBe(true);
  const secondField = requireUrlField("broken", "second");
  await user.clear(secondField);
  await user.type(secondField, "https://example.com/second-edited.jpg");
  // The second slide accepts an edit while the failed slide still shows the placeholder.
  expect(secondImage.getAttribute("src")).toBe("https://example.com/second-edited.jpg");
  expect(within(requireFrame("broken", 0)).getByText(IMAGE_UNAVAILABLE_LABEL)).toBeTruthy();
  expect(requireUrlField("broken", "missing")).toHaveProperty("value", missingUrl);
  await user.clear(failingField);
  await user.type(failingField, "https://example.com/repaired.jpg");
  // The repaired address is requested again. The second slide and the other carousel stay.
  expect(requireUrlField("broken", "missing")).toHaveProperty("value", "https://example.com/repaired.jpg");
  expect(requireFrame("broken", 0).querySelector("[data-image-placeholder]")).toBeNull();
  expect(slideImages("broken").map((image) => image.getAttribute("src"))).toEqual([
    "https://example.com/repaired.jpg",
    "https://example.com/second-edited.jpg",
  ]);
  expect(slideImages("other")[0]).toBe(otherImage);
  expect(requireFrame("broken", 0).style.aspectRatio).toBe("16 / 9");
  expect(requireFrame("broken", 1).style.aspectRatio).toBe("16 / 9");
  expect(requireFrame("other", 0).style.aspectRatio).toBe("1 / 1");
}

/**
 * Asserts a failed blank alt shows Image unavailable and no Slide n caption.
 *
 * Purpose: alt text is included only when the author wrote some. The frame ratio stays.
 * Inputs: none.
 * Side effects: renders the shell and dispatches error.
 */
function expectAFailedBlankAltToOmitTheSlideCaption(): void {
  renderEditor([
    carouselSection("slides", "square", [{ id: "blank", url: "https://example.com/missing.png", alt: "   " }]),
  ]);
  fireEvent.error(requireSlideImage("slides", 0));
  const frame = requireFrame("slides", 0);
  // The placeholder is the failure sentence. Slide 1 remains an accessible name only, and this frame has no img now.
  expect(within(frame).getByText(IMAGE_UNAVAILABLE_LABEL)).toBeTruthy();
  expect(frame.textContent?.includes("Slide 1")).toBe(false);
  expect(frame.style.aspectRatio).toBe("1 / 1");
  expect(requireUrlField("slides", "blank")).toHaveProperty("value", "https://example.com/missing.png");
}

/**
 * Asserts a finished image with no pixels is a failure outside Happy DOM.
 *
 * Purpose: an eager 404 can finish before the error listener. Happy-dom's zero width is not that failure.
 * Inputs: none.
 * Side effects: none.
 */
function expectAFinishedEmptyImageToCountAsUnavailable(): void {
  const failed = { complete: true, naturalWidth: 0, src: "https://example.com/missing.png" };
  // A real browser that finished with no pixels shows the placeholder.
  expect(imageFinishedWithoutPixels(failed, "Mozilla/5.0")).toBe(true);
  // Happy-dom reports the same numbers without fetching the image.
  expect(imageFinishedWithoutPixels(failed, "Mozilla/5.0 HappyDOM/20.14.6")).toBe(false);
  // A request that is still running, a decoded image, and an empty src stay off the placeholder.
  expect(imageFinishedWithoutPixels({ complete: false, naturalWidth: 0, src: failed.src }, "Mozilla/5.0")).toBe(false);
  expect(imageFinishedWithoutPixels({ complete: true, naturalWidth: 320, src: failed.src }, "Mozilla/5.0")).toBe(false);
  expect(imageFinishedWithoutPixels({ complete: true, naturalWidth: 0, src: "" }, "Mozilla/5.0")).toBe(false);
}

/**
 * Registers the carousel cases.
 *
 * Purpose: each case covers one editing or rendering behavior from this prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerCarouselCases(): void {
  // Order, edits, the empty list, ratios, independence, and the scroll controls.
  it("renders three carousel images in order", expectThreeImagesToRenderInOrder);
  it("changes only the second image URL", expectEditingTheSecondUrlToChangeThatImageOnly);
  it("shows the empty message when the last image is removed", expectRemovingTheLastImageToShowTheEmptyMessage);
  it("appends an image after the existing ones", expectAddingAnImageToAppendIt);
  it("sets portrait, landscape, and square frame ratios", expectAspectRatiosToSetTheFrameStyle);
  it("keeps a second carousel unchanged", expectTwoCarouselsToStayIndependent);
  it("uses previous and next buttons that stop at the ends", expectPreviousAndNextToBeButtons);
  it("moves one slide at a time through three images", expectTheControlsToMoveOneSlideAtATime);
  it("disables both controls when a carousel has one image", expectOneImageToDisableBothControls);
  it("keeps the current slide when the aspect ratio changes", expectARatioChangeToKeepTheCurrentSlide);
  it("removes only the middle image", expectRemovingTheMiddleImageToLeaveTheOthers);
  it("stops on the new last slide when the viewed tail is removed", expectRemovingTheViewedTailToStopOnTheNewEnd);
  it("restores one slide when an image is added to an empty carousel", expectAddingToAnEmptyCarouselToRestoreOneSlide);
  it("enables the next control when an image is added at the end", expectAddingAtTheEndToEnableTheNextControl);
  it("changes only the edited alt text", expectAnAltEditToChangeThatImageNameOnly);
  it("names an invalid image URL and allows an empty one", expectAnInvalidUrlToStayInTheField);
  it("keeps a script, credential, or unfinished URL off the image", expectUnsafeUrlsToStayOffTheImage);
  it("uses Slide n as the accessible name when alt is blank", expectABlankAltToUseTheSlideName);
  it("keeps each carousel at its own place", expectEachCarouselToKeepItsOwnPlace);
  it("edits the carousel that is selected", expectTheSelectedCarouselToBeTheOneThatChanges);
  it("follows a drag and ignores the scroll caused by the next control", expectADragToMoveTheControlsWithoutBouncing);
  it("keeps the button index when the region cannot scroll", expectAnUnmovedScrollToKeepTheButtonIndex);
  it("does not advance on a timer", expectTheCarouselToStayStillWithoutATimer);
  it("paints the carousel on the server before the client controls are ready", expectTheServerMarkupToShowTheCarouselBeforeTheClientIsReady);
  it("registers the carousel inspector and preview", expectTheRegistryToRegisterTheCarousel);
  it("reserves the frame ratio before a missing image loads", expectAFrameToKeepItsRatioBeforeTheImageLoads);
  it("loads the first image eagerly and later images lazily", expectLaterImagesToLoadLazily);
  it("shows a placeholder when an image fails and keeps the document editable", expectABrokenImageToShowThePlaceholder);
  it("omits the slide caption when a failed image has a blank alt", expectAFailedBlankAltToOmitTheSlideCaption);
  it("treats a finished image with no pixels as unavailable", expectAFinishedEmptyImageToCountAsUnavailable);
}

afterEach(() => {
  cleanup();
});

describe("carousel section", registerCarouselCases);
