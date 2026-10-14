import { expect, test, type Locator, type Page } from "@playwright/test";

/** Phone, tablet, and desktop widths from the responsive check. Heights are tall enough to use the editor. */
const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

/** Desktop split from the shell stylesheet. Below this width the Editor / Preview switch is the layout. */
const DESKTOP_SPLIT = 1024;

/**
 * Reads document overflow and the element that extends farthest to the right.
 *
 * Purpose: the assertion can name the node that widened the page.
 * Inputs: none. This function runs in the browser.
 * Side effects: none.
 */
function readPageHorizontalOverflow(): { overflow: number; widest: string } {
  // The document element is the page scroll width compared with the viewport.
  const root = document.documentElement;
  const overflow = root.scrollWidth - root.clientWidth;
  let widest = "document";
  let widestRight = 0;
  for (const node of document.body.querySelectorAll("*")) {
    if (!(node instanceof HTMLElement)) {
      // Text nodes are not in this list. Non-elements are skipped.
      continue;
    }
    const box = node.getBoundingClientRect();
    if (box.right > widestRight) {
      // Keep the rightmost box so a failure names that element.
      widestRight = box.right;
      const id = node.id === "" ? "" : `#${node.id}`;
      const className = typeof node.className === "string" && node.className !== "" ? `.${node.className.split(" ").join(".")}` : "";
      widest = `${node.tagName.toLowerCase()}${id}${className}`;
    }
  }
  return { overflow, widest };
}

/**
 * Measures how far the document extends past the viewport, and which element reaches farthest right.
 *
 * Purpose: a failing width check can name the control that caused the page to scroll sideways.
 * Inputs: page, the editor page.
 * Side effects: none.
 */
async function pageHorizontalOverflow(page: Page): Promise<{ overflow: number; widest: string }> {
  // Layout is read in the browser after the viewport and the editor have settled.
  return page.evaluate(readPageHorizontalOverflow);
}

/**
 * Asserts the page does not scroll horizontally.
 *
 * Purpose: F11 allows one pixel of rounding and rejects a sideways page scroll.
 * Inputs: page, the editor page.
 * Side effects: none. Throws when the document is wider than the viewport.
 */
async function expectNoPageHorizontalScroll(page: Page): Promise<void> {
  // scrollWidth and clientWidth are CSS pixels on the document element.
  const measured = await pageHorizontalOverflow(page);
  expect(measured.overflow, measured.widest).toBeLessThanOrEqual(1);
}

/**
 * Asserts one control is on screen and inside the viewport width.
 *
 * Purpose: Save, export, and import have to be reachable without a sideways scroll.
 * Inputs: page, the editor page. control, the button or file input.
 * Side effects: none. Throws when the control is hidden or past the right edge.
 */
async function expectControlInView(page: Page, control: Locator): Promise<void> {
  // The header actions sit at the top. Partial visibility is not enough if the box runs past the viewport.
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) {
    throw new Error("The control has no layout box.");
  }
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

/**
 * Asserts Save, Export JSON, and Import JSON are on screen.
 *
 * Purpose: those three controls stay in the header while either pane is showing.
 * Inputs: page, the editor page.
 * Side effects: none. Throws when a control is missing or wider than the viewport.
 */
async function expectDocumentActionsInView(page: Page): Promise<void> {
  // Save and Export JSON are buttons. Import JSON is the file input named by its label.
  await expectControlInView(page, page.getByRole("button", { name: "Save", exact: true }));
  await expectControlInView(page, page.getByRole("button", { name: "Export JSON" }));
  await expectControlInView(page, page.getByLabel("Import JSON"));
}

/**
 * Asserts a labelled field in the editor can be scrolled into view without widening the page.
 *
 * Purpose: the inspector fields stay reachable at each width.
 * Inputs: page, the editor page.
 * Side effects: may scroll the field into view.
 */
async function expectEditorFieldReachable(page: Page): Promise<void> {
  // The fixture selects the carousel, so Image URL is the first field.
  const field = page.getByLabel("Image URL").first();
  await field.scrollIntoViewIfNeeded();
  await expect(field).toBeInViewport();
  await expectNoPageHorizontalScroll(page);
}

/**
 * Asserts the phone frame's width sits inside the viewport and the frame itself does not scroll sideways.
 *
 * Purpose: the preview can be tall, and its horizontal edges still belong on the page.
 * Inputs: page, the editor page.
 * Side effects: none. Throws when the frame is clipped or wider than the viewport.
 */
async function expectPhoneFrameFits(page: Page): Promise<void> {
  const frame = page.locator(".phone-frame");
  // The frame is in the preview pane. A hidden pane has no box to measure.
  await expect(frame).toBeVisible();
  const box = await frame.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) {
    throw new Error("The phone frame has no layout box.");
  }
  expect(box.width).toBeGreaterThan(200);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  const frameOverflow = await frame.evaluate((node) => node.scrollWidth - node.clientWidth);
  expect(frameOverflow).toBeLessThanOrEqual(1);
}

/**
 * Asserts carousel slides scroll inside the phone and do not widen the page.
 *
 * Purpose: horizontal overflow belongs to the carousel scroller.
 * Inputs: page, the editor page. The preview pane must already be showing.
 * Side effects: none. Throws when the slides escape the frame or the page grows sideways.
 */
async function expectCarouselOverflowInsidePhone(page: Page): Promise<void> {
  // The client preview marks the carousel ready after it can scroll.
  await expect(page.locator("[data-carousel-ready='true']")).toBeVisible();
  const metrics = await page.evaluate(() => {
    const scroller = document.querySelector("[data-carousel-scroller]");
    const frame = document.querySelector(".phone-frame");
    const root = document.documentElement;
    if (!(scroller instanceof HTMLElement) || !(frame instanceof HTMLElement)) {
      return null;
    }
    const scrollerBox = scroller.getBoundingClientRect();
    const frameBox = frame.getBoundingClientRect();
    return {
      scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
      frameOverflow: frame.scrollWidth - frame.clientWidth,
      pageOverflow: root.scrollWidth - root.clientWidth,
      insideFrame: scrollerBox.left >= frameBox.left - 1 && scrollerBox.right <= frameBox.right + 1,
    };
  });
  if (metrics === null) {
    throw new Error("The carousel scroller or the phone frame is missing.");
  }
  // Two slides make the scroller wider than its port. That extra width stays inside the frame.
  expect(metrics.scrollerOverflow).toBeGreaterThan(1);
  expect(metrics.insideFrame).toBe(true);
  expect(metrics.frameOverflow).toBeLessThanOrEqual(1);
  expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
}

/**
 * Scrolls the editor page back to the top.
 *
 * Purpose: phone and header measurements start from the unscrolled page.
 * Inputs: none. This function runs in the browser.
 * Side effects: sets the window scroll position.
 */
function scrollEditorToTop(): void {
  // Horizontal and vertical scroll both return to the origin.
  window.scrollTo(0, 0);
}

/**
 * Shows the preview pane when the width uses the Editor / Preview switch.
 *
 * Purpose: below the desktop split the phone is hidden until Preview is pressed.
 * Inputs: page, the editor page. width, the viewport width in CSS pixels.
 * Side effects: may click Preview.
 */
async function showPreviewIfStacked(page: Page, width: number): Promise<void> {
  if (width >= DESKTOP_SPLIT) {
    // Desktop already shows the phone beside the inspector.
    return;
  }
  // Editor starts pressed. Preview reveals the phone without removing the header actions.
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.locator("#preview-pane")).toBeVisible();
}

/**
 * Reads the section-select ids in list order.
 *
 * Purpose: reorder is proven by the row order, not by a status message.
 * Inputs: page, the editor page.
 * Side effects: none.
 */
async function sectionSelectIds(page: Page): Promise<string[]> {
  // Each row button id ends with the section id and stays with that row when it moves.
  return page.locator(".section-list .section-select").evaluateAll((nodes) => nodes.map((node) => node.id));
}

/**
 * Asserts one viewport can reach the actions, the fields, and a phone that does not widen the page.
 *
 * Purpose: F11 is the same check at 375, 768, and 1440 CSS pixels.
 * Inputs: page, the editor page. width and height, the viewport in CSS pixels.
 * Side effects: loads the editor and may switch to Preview.
 */
async function expectEditorToFitViewport(page: Page, width: number, height: number): Promise<void> {
  // The fixture loader is the editor origin. Image hosts are not required for the frame measurement.
  await page.setViewportSize({ width, height });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
  await expectNoPageHorizontalScroll(page);
  await expectDocumentActionsInView(page);
  const editorPane = page.locator("#editor-pane");
  const previewPane = page.locator("#preview-pane");
  if (width >= DESKTOP_SPLIT) {
    // The switch is not the desktop layout. Both panes stay on screen.
    await expect(page.locator(".pane-switch")).toBeHidden();
    await expect(editorPane).toBeVisible();
    await expect(previewPane).toBeVisible();
    const frame = page.locator(".phone-frame");
    const box = await frame.boundingBox();
    if (box === null) {
      throw new Error("The desktop phone frame has no layout box.");
    }
    // The whole frame, including its height, sits in this desktop viewport.
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  } else {
    // The switch is the layout. Editor is pressed, so the phone is not taking page width.
    await expect(page.getByRole("button", { name: "Editor", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview", exact: true })).toBeVisible();
    await expect(editorPane).toBeVisible();
    await expect(previewPane).toBeHidden();
  }
  await expectEditorFieldReachable(page);
  // The field check scrolls. The phone and the header actions are measured from the top of the page.
  await page.evaluate(scrollEditorToTop);
  await showPreviewIfStacked(page, width);
  await expectPhoneFrameFits(page);
  await expectCarouselOverflowInsidePhone(page);
  await expectNoPageHorizontalScroll(page);
  if (width < DESKTOP_SPLIT) {
    // The header still holds the actions after the phone is the visible pane.
    await expectDocumentActionsInView(page);
  }
}

/**
 * Asserts ArrowDown reorders a section and leaves focus on that section's drag handle.
 *
 * Purpose: keyboard reorder must not send focus to the top of the page.
 * Inputs: page, the editor page. The viewport is the narrow phone width.
 * Side effects: adds two sections and presses ArrowDown on the carousel handle.
 */
async function expectArrowDownToKeepFocusOnThatSection(page: Page): Promise<void> {
  // A narrow window is the keyboard check. The fixture starts with one carousel, so a neighbor has to be added first.
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByRole("button", { name: "Add button" }).click();
  await expect(page.getByRole("button", { name: "Move down Carousel, First slide" })).toHaveCount(0);
  const handle = page.getByRole("button", { name: "Reorder Carousel, First slide" });
  const handleId = await handle.getAttribute("id");
  if (handleId === null) {
    throw new Error("The drag handle has no id.");
  }
  const sectionId = handleId.replace(/^section-drag-/, "");
  const before = await sectionSelectIds(page);
  // ArrowDown moves the carousel one row. Three rows leave that handle able to move again.
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => sectionSelectIds(page)).not.toEqual(before);
  const after = await sectionSelectIds(page);
  expect(after[0]).not.toBe(`section-select-${sectionId}`);
  expect(after).toContain(`section-select-${sectionId}`);
  await expect.poll(async () => page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.id : ""))).toBe(handleId);
  // The focused control is still the drag handle for the carousel, not the page heading.
  const activeId = await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.id : ""));
  expect(activeId).toContain(sectionId);
  expect(activeId.startsWith("section-")).toBe(true);
  await expect(page.locator(`#${handleId}`)).toBeInViewport();
}

/**
 * Drags a handle to the lower half of another row.
 *
 * Purpose: the pointer path is the same press, move, and release the editor treats as a drag.
 * Inputs: page, the editor page. handle, the drag control. target, the row that should end up above the dragged section.
 * Side effects: moves the mouse.
 */
async function dragHandleToLowerHalf(page: Page, handle: Locator, target: Locator): Promise<void> {
  // Both ends of the gesture have to be in view before their boxes are read.
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const handleBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (handleBox === null || targetBox === null) {
    throw new Error("A drag target has no layout box.");
  }
  // The press starts in the middle of the handle.
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  // Two pixels inside the bottom edge is the lower half, which inserts after that row.
  const endX = targetBox.x + Math.min(24, targetBox.width / 2);
  const endY = targetBox.y + targetBox.height - 2;
  // Press on the handle, move onto the target, then release so the editor can place the section.
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();
}

/**
 * Asserts dragging the first section down one row updates the section list.
 *
 * Purpose: the pointer reorder is the control the author uses in place of Move down.
 * Inputs: page, the editor page.
 * Side effects: adds two sections and drags the carousel handle onto the text row.
 */
async function expectDraggingTheCarouselDownOneRow(page: Page): Promise<void> {
  // Desktop keeps every row on screen so the drag does not depend on the pane switch.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
  await page.getByRole("button", { name: "Add text" }).click();
  await page.getByRole("button", { name: "Add button" }).click();
  await expect(page.locator(".section-list .section-row")).toHaveCount(3);
  const carouselSelect = "section-select-carousel_playwright";
  const before = await sectionSelectIds(page);
  expect(before[0]).toBe(carouselSelect);
  const handle = page.locator("#section-drag-carousel_playwright");
  const textRow = page.locator(".section-list .section-row").nth(1);
  await dragHandleToLowerHalf(page, handle, textRow);
  await expect.poll(async () => sectionSelectIds(page)).not.toEqual(before);
  const after = await sectionSelectIds(page);
  // The carousel traded places with the text section that was dropped onto.
  expect(after[0]).not.toBe(carouselSelect);
  expect(after[1]).toBe(carouselSelect);
}

/**
 * Asserts the 375 CSS pixel editor fits.
 *
 * Purpose: the phone width is one of the three F11 viewports.
 * Inputs: page, the editor page.
 * Side effects: loads the editor and selects Preview.
 */
async function expectEditorToFitAt375({ page }: { page: Page }): Promise<void> {
  // 375 uses the Editor / Preview switch. The height is a phone screen.
  await expectEditorToFitViewport(page, VIEWPORTS[0].width, VIEWPORTS[0].height);
}

/**
 * Asserts the 768 CSS pixel editor fits.
 *
 * Purpose: the tablet width is one of the three F11 viewports.
 * Inputs: page, the editor page.
 * Side effects: loads the editor and selects Preview.
 */
async function expectEditorToFitAt768({ page }: { page: Page }): Promise<void> {
  // 768 is still below the 1024px split, so the switch is the layout.
  await expectEditorToFitViewport(page, VIEWPORTS[1].width, VIEWPORTS[1].height);
}

/**
 * Asserts the 1440 CSS pixel editor fits.
 *
 * Purpose: the desktop width is one of the three F11 viewports.
 * Inputs: page, the editor page.
 * Side effects: loads the editor.
 */
async function expectEditorToFitAt1440({ page }: { page: Page }): Promise<void> {
  // 1440 shows the inspector and the phone side by side.
  await expectEditorToFitViewport(page, VIEWPORTS[2].width, VIEWPORTS[2].height);
}

/**
 * Runs the narrow-window keyboard reorder check.
 *
 * Purpose: ArrowDown keeps focus on that section.
 * Inputs: page, the editor page.
 * Side effects: adds sections and presses ArrowDown.
 */
async function expectKeyboardReorderToKeepFocus({ page }: { page: Page }): Promise<void> {
  // The helper sets the 375px viewport and presses ArrowDown on the drag handle.
  await expectArrowDownToKeepFocusOnThatSection(page);
}

/**
 * Asserts a pointer drag reorders the first section.
 *
 * Purpose: the browser receives the same press and move the shell listens for.
 * Inputs: page, the editor page.
 * Side effects: adds sections and drags the carousel handle.
 */
async function expectADragToReorderTheFirstSection({ page }: { page: Page }): Promise<void> {
  // The helper uses the desktop viewport so the text row is on screen.
  await expectDraggingTheCarouselDownOneRow(page);
}

test("fits the editor at 375 CSS pixels", expectEditorToFitAt375);
test("fits the editor at 768 CSS pixels", expectEditorToFitAt768);
test("fits the editor at 1440 CSS pixels", expectEditorToFitAt1440);
test("keeps focus on the moved section after ArrowDown", expectKeyboardReorderToKeepFocus);
test("drags a section down one row", expectADragToReorderTheFirstSection);
