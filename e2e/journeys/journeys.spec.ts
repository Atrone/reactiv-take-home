import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page, type Route } from "@playwright/test";
import { CONTROL_PORT, SERVICE_TOKEN } from "./journey-env.mjs";

/** A 1 by 1 PNG. Slide requests are fulfilled with these bytes so example.com is not contacted. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** First carousel on the seeded screen. */
const FIRST_CAROUSEL_ID = "section-carousel-1";

/** Second carousel on the seeded screen. */
const SECOND_CAROUSEL_ID = "section-carousel-2";

/** First text section on the seeded screen. */
const FIRST_TEXT_ID = "section-text-1";

/** Second text section on the seeded screen. */
const SECOND_TEXT_ID = "section-text-2";

/** First button on the seeded screen. */
const FIRST_CTA_ID = "section-cta-1";

/** Seeded title. A rejected import must leave this on the preview. */
const SEEDED_TITLE = "New this week";

/** The other text title. Reordering must keep it on its own section. */
const SECOND_TITLE = "From the floor";

/** First slide description on the first carousel. */
const FIRST_CAROUSEL_FIRST_ALT = "Shop window with a new arrival display";

/** Second slide description on the first carousel. */
const FIRST_CAROUSEL_SECOND_ALT = "Front table stacked with featured books";

/** First slide description on the second carousel. */
const SECOND_CAROUSEL_FIRST_ALT = "Staff picks stacked on a wooden counter";

/** Second slide description on the second carousel. */
const SECOND_CAROUSEL_SECOND_ALT = "Chair in a quiet corner of the shop";

/** Image address used when the first slide is edited. The test fulfills it locally. */
const JOURNEY_IMAGE_URL = "https://example.com/demo/journey-live.jpg";

/** Image address that the test answers with 404. */
const MISSING_IMAGE_URL = "https://example.com/demo/missing-journey.png";

/** Title written before export so the saved screen is not only the seed copy. */
const EXPORTED_TITLE = "Exported journey title";

/** Title typed after export. Import must replace it with the exported title. */
const DISCARDED_TITLE = "Discarded draft title";

/** Title typed while one save is forced to fail. */
const KEPT_TITLE = "Kept during the outage";

/** Title typed after a broken image is showing. */
const TITLE_BESIDE_BROKEN_IMAGE = "Title beside a broken image";

/**
 * Builds the control URL for the journey fixture.
 *
 * Purpose: tests reset the row and close the data port without sharing a draft.
 * Inputs: path, the control path, beginning with a slash.
 * Side effects: none.
 */
function controlUrl(path: string): string {
  // The control port is loopback. It does not return the fixture token.
  return `http://127.0.0.1:${CONTROL_PORT}${path}`;
}

/**
 * Restores the seeded document before a test.
 *
 * Purpose: a saved title from an earlier test must not be the next test's screen.
 * A new browser context already drops unsaved drafts and localStorage.
 * Inputs: request, the Playwright API context.
 * Side effects: posts to the fixture control port.
 */
async function resetJourneyStore({ request }: { request: APIRequestContext }): Promise<void> {
  // Reset replaces the in-memory row and opens the data port if a previous test closed it.
  const response = await request.post(controlUrl("/reset"));
  expect(response.ok()).toBeTruthy();
}

test.beforeEach(resetJourneyStore);

/**
 * Fulfills one slide request with a local PNG.
 *
 * Purpose: the journeys do not depend on example.com being reachable.
 * Inputs: route, the browser request for a slide.
 * Side effects: completes that request with a 1 by 1 PNG.
 */
async function fulfillSlide(route: Route): Promise<void> {
  // The bytes are a valid PNG. The URL stays the address on the img element.
  await route.fulfill({
    status: 200,
    contentType: "image/png",
    body: TINY_PNG,
  });
}

/**
 * Fulfills one slide request with 404.
 *
 * Purpose: a missing image shows Image unavailable without contacting example.com.
 * Inputs: route, the browser request for the missing slide.
 * Side effects: completes that request with status 404.
 */
async function fulfillMissingSlide(route: Route): Promise<void> {
  // No image bytes. The preview treats the finished request as unavailable.
  await route.fulfill({
    status: 404,
    contentType: "text/plain",
    body: "missing",
  });
}

/**
 * Stubs example.com slides and opens the editor.
 *
 * Purpose: every journey that shows the seeded screen starts from the same loaded document.
 * Inputs: page, the Playwright page.
 * Side effects: registers the image route and navigates to the editor.
 */
async function openSeededEditor(page: Page): Promise<void> {
  // Slide bytes stay in the browser. The loader reads the journey fixture.
  await page.route("https://example.com/**", fulfillSlide);
  await page.goto("/");
  // The shell heading is the loaded editor. The load-error page uses the same heading with an alert.
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.locator("#preview-pane [data-carousel-ready='true']")).toHaveCount(2);
}

/**
 * Measures how much of one slide sits inside its carousel scroller.
 *
 * Purpose: a layout box outside the scrollport can still be on the page, so the scrollport is the check.
 * Inputs: page, the editor page. sectionId, the carousel. alt, the slide's accessible name.
 * Side effects: none.
 */
async function slideOverlap(page: Page, sectionId: string, alt: string): Promise<number> {
  // The image and its scroller are measured in the browser, after layout.
  return page.evaluate(({ sectionId: id, alt: imageAlt }) => {
    // The scroller is the scrollport. Overlap is the visible width of this slide.
    const root = document.querySelector(`#preview-pane li[data-section-id="${id}"]`);
    const image = root?.querySelector(`img[alt="${imageAlt}"]`);
    const scroller = image?.closest("[data-carousel-scroller]");
    if (!(image instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
      return 0;
    }
    const imageBox = image.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    const left = Math.max(imageBox.left, scrollerBox.left);
    const right = Math.min(imageBox.right, scrollerBox.right);
    return Math.max(0, right - left);
  }, { sectionId, alt });
}

/**
 * Scrolls one carousel to its second slide with Next image.
 *
 * Purpose: both seeded carousels can be moved with their own next control.
 * Inputs: page, the editor page. sectionId, the carousel. firstAlt and secondAlt, the two slide names.
 * Side effects: clicks Next image.
 */
async function scrollCarouselToTheSecondSlide(page: Page, sectionId: string, firstAlt: string, secondAlt: string): Promise<void> {
  // The controls belong to this carousel. The other carousel has its own buttons.
  const carousel = page.locator(`#preview-pane li[data-section-id="${sectionId}"]`);
  const next = carousel.getByRole("button", { name: "Next image", exact: true });
  const previous = carousel.getByRole("button", { name: "Previous image", exact: true });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  // The first slide fills the scrollport. The second is outside that port.
  await expect.poll(async () => slideOverlap(page, sectionId, firstAlt)).toBeGreaterThan(40);
  expect(await slideOverlap(page, sectionId, secondAlt)).toBeLessThan(8);
  await next.click();
  await expect.poll(async () => slideOverlap(page, sectionId, secondAlt)).toBeGreaterThan(40);
  expect(await slideOverlap(page, sectionId, firstAlt)).toBeLessThan(8);
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
}

/**
 * Reads the preview section ids from top to bottom.
 *
 * Purpose: reorder is proven on the phone, not only on the section list.
 * Inputs: page, the editor page.
 * Side effects: none.
 */
async function previewSectionIds(page: Page): Promise<string[]> {
  // Each preview row carries its section id. The array order is the screen order.
  return page.locator("#preview-pane li[data-section-id]").evaluateAll((nodes) => {
    // Empty attributes stay in the list so a missing id fails the order check.
    return nodes.map((node) => node.getAttribute("data-section-id") ?? "");
  });
}

/**
 * Replaces one exact inspector field.
 *
 * Purpose: Label does not match Label color, and the typed value stays in the control.
 * Inputs: page, the editor page. label, the accessible name. value, the replacement text.
 * Side effects: fills the field.
 */
async function replaceField(page: Page, label: string, value: string): Promise<void> {
  // The exact name keeps Title color off a Title lookup.
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  await expect(field).toHaveValue(value);
}

/**
 * Moves one section down one place and waits until the preview follows.
 *
 * Purpose: a second arrow must see the index from the updated list.
 * Inputs: page, the editor page. sectionId, the section to move.
 * Side effects: focuses that section's drag handle and presses ArrowDown.
 */
async function moveSectionDown(page: Page, sectionId: string): Promise<void> {
  // The id stays on the handle when the title changes. The preview order is the check.
  const before = await previewSectionIds(page);
  const handle = page.locator(`#section-drag-${sectionId}`);
  await handle.focus();
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => previewSectionIds(page)).not.toEqual(before);
}

/**
 * Asserts one preview text block shows a title and a description color.
 *
 * Purpose: the phone, not the draft object, is the evidence for a text edit.
 * Inputs: page, the editor page. sectionId, the text section. title, the visible title.
 * description, the visible description. titleColor and descriptionColor, the computed colors.
 * Side effects: none.
 */
async function expectTextPreview(
  page: Page,
  sectionId: string,
  title: string,
  description: string,
  titleColor: string,
  descriptionColor: string,
): Promise<void> {
  // The preview row is the section id. The inspector is not this assertion.
  const row = page.locator(`#preview-pane li[data-section-id="${sectionId}"]`);
  await expect(row.locator(".preview-text-title")).toHaveText(title);
  await expect(row.locator(".preview-text-description")).toHaveText(description);
  await expect(row.locator(".preview-text-title")).toHaveCSS("color", titleColor);
  await expect(row.locator(".preview-text-description")).toHaveCSS("color", descriptionColor);
}

/**
 * Plays the seeded-screen journey.
 *
 * Purpose: edit the required field types, scroll both carousels, select every aspect ratio, and reorder two text sections.
 * Inputs: page, the editor page.
 * Side effects: drives the browser. Does not save.
 */
async function expectTheSeededScreenJourney({ page }: { page: Page }): Promise<void> {
  // Images are local. The fixture document is the six-section seed.
  await openSeededEditor(page);
  await scrollCarouselToTheSecondSlide(page, FIRST_CAROUSEL_ID, FIRST_CAROUSEL_FIRST_ALT, FIRST_CAROUSEL_SECOND_ALT);
  await scrollCarouselToTheSecondSlide(page, SECOND_CAROUSEL_ID, SECOND_CAROUSEL_FIRST_ALT, SECOND_CAROUSEL_SECOND_ALT);
  // The first carousel is the selected section, so its image fields are the inspector.
  const imageUrl = page.getByLabel("Image URL", { exact: true }).first();
  await imageUrl.fill(JOURNEY_IMAGE_URL);
  await expect(imageUrl).toHaveValue(JOURNEY_IMAGE_URL);
  const alt = page.getByLabel("Alt text", { exact: true }).first();
  await alt.fill("Journey slide");
  await expect(alt).toHaveValue("Journey slide");
  const firstSlide = page.locator(`#preview-pane li[data-section-id="${FIRST_CAROUSEL_ID}"] img`).first();
  await expect(firstSlide).toHaveAttribute("src", JOURNEY_IMAGE_URL);
  await expect(firstSlide).toHaveAttribute("alt", "Journey slide");
  // Each ratio is selected on this carousel. The other carousel stays portrait.
  const firstFrame = page.locator(`#preview-pane li[data-section-id="${FIRST_CAROUSEL_ID}"] [data-carousel-frame]`).first();
  const secondFrame = page.locator(`#preview-pane li[data-section-id="${SECOND_CAROUSEL_ID}"] [data-carousel-frame]`).first();
  await page.getByRole("radio", { name: "Portrait", exact: true }).check();
  await expect(firstFrame).toHaveCSS("aspect-ratio", "3 / 4");
  await page.getByRole("radio", { name: "Landscape", exact: true }).check();
  await expect(firstFrame).toHaveCSS("aspect-ratio", "16 / 9");
  await page.getByRole("radio", { name: "Square", exact: true }).check();
  await expect(firstFrame).toHaveCSS("aspect-ratio", "1 / 1");
  await expect(secondFrame).toHaveCSS("aspect-ratio", "3 / 4");
  // Title, description, and both colors are this text section. The other title stays.
  await page.getByRole("button", { name: `Select Text, ${SEEDED_TITLE}`, exact: true }).click();
  await replaceField(page, "Title", "Journey title");
  await replaceField(page, "Description", "Journey description");
  await replaceField(page, "Title color", "#010101");
  await replaceField(page, "Description color", "#020202");
  await expectTextPreview(page, FIRST_TEXT_ID, "Journey title", "Journey description", "rgb(1, 1, 1)", "rgb(2, 2, 2)");
  await expect(page.locator(`#preview-pane li[data-section-id="${SECOND_TEXT_ID}"] .preview-text-title`)).toHaveText(SECOND_TITLE);
  // Label, link, and both button colors are this CTA.
  await page.getByRole("button", { name: "Select Button, Continue", exact: true }).click();
  await replaceField(page, "Label", "Journey continue");
  await replaceField(page, "Link", "https://example.com/journey-continue");
  await replaceField(page, "Button color", "#030303");
  await replaceField(page, "Label color", "#040404");
  const button = page.locator(`#preview-pane li[data-section-id="${FIRST_CTA_ID}"] .preview-cta-button`);
  await expect(button).toHaveText("Journey continue");
  await expect(button).toHaveCSS("background-color", "rgb(3, 3, 3)");
  await expect(button).toHaveCSS("color", "rgb(4, 4, 4)");
  await expect(page.locator(`#preview-pane li[data-section-id="${FIRST_CTA_ID}"] a.preview-cta-open`)).toHaveAttribute(
    "href",
    "https://example.com/journey-continue",
  );
  await expect(page.locator("#preview-pane").getByRole("button", { name: "See the list", exact: true })).toBeVisible();
  // Three steps move the first text section past the second text section.
  await moveSectionDown(page, FIRST_TEXT_ID);
  await moveSectionDown(page, FIRST_TEXT_ID);
  await moveSectionDown(page, FIRST_TEXT_ID);
  await expect.poll(async () => previewSectionIds(page)).toEqual([
    FIRST_CAROUSEL_ID,
    FIRST_CTA_ID,
    SECOND_CAROUSEL_ID,
    SECOND_TEXT_ID,
    FIRST_TEXT_ID,
    "section-cta-2",
  ]);
  // The moved section keeps the title and colors from before the move.
  await expectTextPreview(page, FIRST_TEXT_ID, "Journey title", "Journey description", "rgb(1, 1, 1)", "rgb(2, 2, 2)");
  await expect(page.locator(`#preview-pane li[data-section-id="${SECOND_TEXT_ID}"] .preview-text-title`)).toHaveText(SECOND_TITLE);
  await expect(firstFrame).toHaveCSS("aspect-ratio", "1 / 1");
}

/**
 * Reads the file Export JSON downloaded.
 *
 * Purpose: the round trip uses the exported text, and the token check reads that same text.
 * Inputs: page, the editor page.
 * Side effects: clicks Export JSON and reads the download.
 */
async function readExportedJson(page: Page): Promise<string> {
  // The download event is the file the button writes. The service token must not be inside it.
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  const filePath = await download.path();
  if (filePath === null) {
    throw new Error("Export JSON did not produce a file.");
  }
  return readFile(filePath, "utf8");
}

/**
 * Plays export, import, save, and reload.
 *
 * Purpose: the exported file restores the draft, Save stores it, and a reload without localStorage shows that screen.
 * Inputs: page, the editor page.
 * Side effects: drives the browser and writes through the fixture.
 */
async function expectExportImportSaveAndReload({ page }: { page: Page }): Promise<void> {
  // The edit happens before export so the saved title and order are not the untouched seed.
  await openSeededEditor(page);
  await page.getByRole("button", { name: `Select Text, ${SEEDED_TITLE}`, exact: true }).click();
  await replaceField(page, "Title", EXPORTED_TITLE);
  await moveSectionDown(page, FIRST_TEXT_ID);
  await moveSectionDown(page, FIRST_TEXT_ID);
  await moveSectionDown(page, FIRST_TEXT_ID);
  const exportedOrder = await previewSectionIds(page);
  const exported = await readExportedJson(page);
  // The file is the portable document. The fixture token and the configuration id stay out of it.
  expect(exported).toContain(EXPORTED_TITLE);
  expect(exported).not.toContain(SERVICE_TOKEN);
  expect(exported).not.toContain("Bearer");
  expect(exported).not.toContain("cfg_journey");
  await replaceField(page, "Title", DISCARDED_TITLE);
  await expect(page.locator(`#preview-pane li[data-section-id="${FIRST_TEXT_ID}"] .preview-text-title`)).toHaveText(DISCARDED_TITLE);
  // Import replaces the discarded title with the exported document.
  await page.getByLabel("Import JSON").setInputFiles({
    name: "home-screen.json",
    mimeType: "application/json",
    buffer: Buffer.from(exported, "utf8"),
  });
  await expect(page.locator("#document-status")).toHaveText("Imported, not saved.");
  await expect(page.locator(`#preview-pane li[data-section-id="${FIRST_TEXT_ID}"] .preview-text-title`)).toHaveText(EXPORTED_TITLE);
  await expect.poll(async () => previewSectionIds(page)).toEqual(exportedOrder);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  // A browser-only value is cleared. The reload must come from the fixture, not from localStorage.
  await page.evaluate(() => {
    // The decoy is browser storage. Clearing it must not remove the saved title.
    localStorage.setItem("journey-draft", "browser only");
    localStorage.clear();
  });
  expect(await page.evaluate(() => {
    // The decoy key must be gone before the reload.
    return localStorage.getItem("journey-draft");
  })).toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.locator(`#preview-pane li[data-section-id="${FIRST_TEXT_ID}"] .preview-text-title`)).toHaveText(EXPORTED_TITLE);
  await expect.poll(async () => previewSectionIds(page)).toEqual(exportedOrder);
  await page.getByRole("button", { name: `Select Text, ${EXPORTED_TITLE}`, exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(EXPORTED_TITLE);
}

/**
 * Imports one file and asserts the seeded title stayed.
 *
 * Purpose: a rejected file shows an error and does not replace the preview.
 * Inputs: page, the editor page. name, the file name. contents, the file text. error, text the status must contain.
 * Side effects: chooses the file.
 */
async function expectRejectedImport(page: Page, name: string, contents: string, error: string): Promise<void> {
  // The control accepts the file. The draft changes only when the file is valid.
  await page.getByLabel("Import JSON").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(contents, "utf8"),
  });
  await expect(page.locator("#document-status")).toContainText(error);
  await expect(page.locator(`#preview-pane li[data-section-id="${FIRST_TEXT_ID}"] .preview-text-title`)).toHaveText(SEEDED_TITLE);
  await expect(page.getByText("Version two title")).toHaveCount(0);
}

/**
 * Plays the four rejected imports.
 *
 * Purpose: malformed JSON, an empty file, a semantically invalid file, and schema version 2 leave the preview title.
 * Inputs: page, the editor page.
 * Side effects: chooses four files.
 */
async function expectRejectedImportsToKeepTheTitle({ page }: { page: Page }): Promise<void> {
  // The seeded title is the previous preview. None of these files may replace it.
  await openSeededEditor(page);
  await expectRejectedImport(page, "malformed.json", "{", "This file is not valid JSON.");
  await expectRejectedImport(page, "empty.json", "", "This file is not valid JSON.");
  const semantic = JSON.stringify({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "bad-button",
          type: "cta",
          label: "Nope",
          url: "javascript:alert(1)",
          backgroundColor: "#112233",
          labelColor: "#ffffff",
        },
      ],
    },
  });
  await expectRejectedImport(page, "semantic.json", semantic, "Use an absolute HTTP(S) URL.");
  const versionTwo = JSON.stringify({
    schemaVersion: 2,
    data: {
      sections: [
        {
          id: "version-two-text",
          type: "text",
          title: "Version two title",
          description: "Should not replace the preview.",
          titleColor: "#112233",
          descriptionColor: "#334455",
        },
      ],
    },
  });
  await expectRejectedImport(page, "version-two.json", versionTwo, "schema version 2");
}

/**
 * Plays a closed port, then Retry.
 *
 * Purpose: a refused connection shows the load error, and opening the port lets Retry show the seeded screen.
 * Inputs: page, the editor page. request, the API context that closes and opens the fixture.
 * Side effects: closes the fixture port, loads the editor, opens the port, and clicks Retry.
 */
async function expectAClosedPortToRecover({ page, request }: { page: Page; request: APIRequestContext }): Promise<void> {
  // The data port is closed. The editor process stays up and calls that port.
  const closed = await request.post(controlUrl("/close"));
  expect(closed.ok()).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("alert")).toHaveText("The saved home screen could not be loaded.");
  await expect(page.getByText(SEEDED_TITLE)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  // Opening the port does not by itself reload. Retry asks the loader again.
  const opened = await request.post(controlUrl("/open"));
  expect(opened.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  await expect(page.getByText(SEEDED_TITLE).first()).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
}

/**
 * Plays one failed save and a successful retry.
 *
 * Purpose: the typed title stays when the save fails, and Retry save shows Saved after the service accepts the write.
 * Inputs: page, the editor page. request, the API context that fails and then clears the next save.
 * Side effects: edits the title, fails one save, and retries it.
 */
async function expectAFailedSaveToRetry({ page, request }: { page: Page; request: APIRequestContext }): Promise<void> {
  // The service is up. One PUT is flagged to fail before the title is submitted.
  await openSeededEditor(page);
  await page.getByRole("button", { name: `Select Text, ${SEEDED_TITLE}`, exact: true }).click();
  await replaceField(page, "Title", KEPT_TITLE);
  await expect(page.locator(`#preview-pane li[data-section-id="${FIRST_TEXT_ID}"] .preview-text-title`)).toHaveText(KEPT_TITLE);
  const failing = await request.post(controlUrl("/fail-next-put"));
  expect(failing.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("The draft was not saved.")).toBeVisible();
  await expect(page.getByText("Saved.", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(KEPT_TITLE);
  // The failure was consumed. Clearing it is the restore step before Retry save.
  const restored = await request.post(controlUrl("/clear-save-failure"));
  expect(restored.ok()).toBeTruthy();
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator(`#preview-pane li[data-section-id="${FIRST_TEXT_ID}"] .preview-text-title`)).toHaveText(KEPT_TITLE);
  await page.getByRole("button", { name: `Select Text, ${KEPT_TITLE}`, exact: true }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue(KEPT_TITLE);
}

/**
 * Plays a 404 image beside an editable title.
 *
 * Purpose: Image unavailable is visible in the browser, and the title field still accepts text.
 * Inputs: page, the editor page.
 * Side effects: stubs one 404, edits the image URL, and types a title.
 */
async function expectABrokenImageToLeaveTheTitleEditable({ page }: { page: Page }): Promise<void> {
  // The catch-all PNG is registered first. The 404 route is registered last so that one URL misses.
  await page.route("https://example.com/**", fulfillSlide);
  await page.route(MISSING_IMAGE_URL, fulfillMissingSlide);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  // The client preview has mounted, so a 404 can replace the slide.
  await expect(page.locator("#preview-pane [data-carousel-ready='true']")).toHaveCount(2);
  const imageUrl = page.getByLabel("Image URL", { exact: true }).first();
  await imageUrl.fill(MISSING_IMAGE_URL);
  await expect(page.getByText("Image unavailable").first()).toBeVisible();
  // The title belongs to the text section. The broken slide stays in the preview.
  await page.getByRole("button", { name: `Select Text, ${SEEDED_TITLE}`, exact: true }).click();
  await replaceField(page, "Title", TITLE_BESIDE_BROKEN_IMAGE);
  await expect(page.locator(`#preview-pane li[data-section-id="${FIRST_TEXT_ID}"] .preview-text-title`)).toHaveText(
    TITLE_BESIDE_BROKEN_IMAGE,
  );
  await expect(page.getByText("Image unavailable").first()).toBeVisible();
}

test("T01 edits the seeded screen, scrolls both carousels, and reorders two text sections", expectTheSeededScreenJourney);
test("T02 exports, imports that file, saves, and reloads without localStorage", expectExportImportSaveAndReload);
test("T03 rejects malformed, empty, invalid, and schema version 2 imports", expectRejectedImportsToKeepTheTitle);
test("T06 shows a load error while the service port is closed, then retry shows the seeded screen", expectAClosedPortToRecover);
test("T06 keeps the typed title when one save fails, then retry shows Saved", expectAFailedSaveToRetry);
test("T07 shows Image unavailable for a 404 image and the title input still accepts text", expectABrokenImageToLeaveTheTitleEditable);
