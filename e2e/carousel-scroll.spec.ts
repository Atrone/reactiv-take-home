import { test, expect, type Page, type Route } from "@playwright/test";
import { FIRST_IMAGE_ALT, FIRST_IMAGE_URL, SECOND_IMAGE_ALT, SECOND_IMAGE_URL } from "./carousel-fixture.mjs";

/** A 1 by 1 PNG. The carousel test fulfills slide requests with these bytes. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Measures how much of an image sits inside its carousel scroller.
 *
 * Purpose: a layout box outside the scrollport can still be "visible" to the page, so the scrollport is the check.
 * Inputs: page, the editor page. alt, the image's accessible name.
 * Side effects: none.
 */
async function overlapWithScroller(page: Page, alt: string): Promise<number> {
  // The image and its scroller are measured in the browser, after layout.
  return page.evaluate((imageAlt) => {
    const image = document.querySelector(`img[alt="${imageAlt}"]`);
    const scroller = image?.closest("[data-carousel-scroller]");
    if (!(image instanceof HTMLElement) || !(scroller instanceof HTMLElement)) {
      return 0;
    }
    const imageBox = image.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    const left = Math.max(imageBox.left, scrollerBox.left);
    const right = Math.min(imageBox.right, scrollerBox.right);
    return Math.max(0, right - left);
  }, alt);
}

/**
 * Fulfills one carousel image request with a local PNG.
 *
 * Purpose: the scroll check does not depend on example.com or any other network image.
 * Inputs: route, the browser request for a fixture slide.
 * Side effects: completes that request with a 1 by 1 PNG.
 */
async function fulfillCarouselImage(route: Route): Promise<void> {
  // The bytes are a valid PNG. The URL stays the fixture address on the img element.
  await route.fulfill({
    status: 200,
    contentType: "image/png",
    body: TINY_PNG,
  });
}

/**
 * Opens the editor and scrolls to the second carousel image.
 *
 * Purpose: prove a person can reach the second slide with the Next image control.
 * Inputs: page, the Playwright page. The loader is the fixture server, not Postgres.
 * Side effects: drives the browser.
 */
async function expectTheNextControlToRevealTheSecondImage({ page }: { page: Page }): Promise<void> {
  // Slide bytes stay in the browser. The loader reads the fixture server, not Postgres.
  await page.route("https://example.com/carousel/**", fulfillCarouselImage);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
  const first = page.getByRole("img", { name: FIRST_IMAGE_ALT });
  const second = page.getByRole("img", { name: SECOND_IMAGE_ALT });
  await expect(first).toHaveAttribute("src", FIRST_IMAGE_URL);
  await expect(second).toHaveAttribute("src", SECOND_IMAGE_URL);
  // The client preview has mounted, so Next image runs its scroll handler.
  await expect(page.locator("[data-carousel-ready='true']")).toBeVisible();
  // The first slide fills the scrollport. The second is in the document and outside that port.
  await expect.poll(async () => overlapWithScroller(page, FIRST_IMAGE_ALT)).toBeGreaterThan(40);
  expect(await overlapWithScroller(page, SECOND_IMAGE_ALT)).toBeLessThan(8);
  const next = page.getByRole("button", { name: "Next image" });
  const previous = page.getByRole("button", { name: "Previous image" });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  // Enter activates the button. The control does not wrap and does not start a timer.
  await next.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => overlapWithScroller(page, SECOND_IMAGE_ALT)).toBeGreaterThan(40);
  expect(await overlapWithScroller(page, FIRST_IMAGE_ALT)).toBeLessThan(8);
  await expect(second).toBeVisible();
  await expect(next).toBeDisabled();
  await expect(previous).toBeEnabled();
  // Previous image scrolls back one slide and stops. The second slide leaves the scrollport.
  await previous.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => overlapWithScroller(page, FIRST_IMAGE_ALT)).toBeGreaterThan(40);
  expect(await overlapWithScroller(page, SECOND_IMAGE_ALT)).toBeLessThan(8);
  await expect(first).toBeVisible();
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
}

test("scrolls a carousel to the second image with the next control", expectTheNextControlToRevealTheSecondImage);
