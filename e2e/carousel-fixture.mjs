/** Local carousel document for the Playwright scroll test. It is not a service credential. */

/** Loopback port for the editor started by Playwright. */
export const EDITOR_PORT = 4187;

/** Loopback port for the fixture configuration server. */
export const FIXTURE_PORT = 4188;

/** Configuration id the editor loader requests. */
export const CONFIGURATION_ID = "cfg_playwright";

/** Tenant id the editor process expects. The fixture server does not read it. */
export const TENANT_ID = "ten_playwright";

/**
 * Bearer token the editor sends to this fixture only.
 *
 * It is a test double. It is not the configuration service credential.
 */
export const SERVICE_TOKEN = "playwright-fixture-token";

/** First slide address. Playwright fulfills it without using the network. */
export const FIRST_IMAGE_URL = "https://example.com/carousel/first.png";

/** Second slide address. Playwright fulfills it without using the network. */
export const SECOND_IMAGE_URL = "https://example.com/carousel/second.png";

/** Accessible name of the first slide. */
export const FIRST_IMAGE_ALT = "First slide";

/** Accessible name of the second slide. */
export const SECOND_IMAGE_ALT = "Second slide";

/**
 * Builds the configuration the fixture server returns.
 *
 * Purpose: give the editor two slides so Next image has somewhere to scroll.
 * Inputs: none.
 * Side effects: none.
 */
export function carouselFixtureConfiguration() {
  // Two slides, in order. Landscape is 16 / 9 in the preview, and the stored name stays landscape.
  return {
    schemaVersion: 1,
    id: CONFIGURATION_ID,
    revision: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
    data: {
      sections: [
        {
          id: "carousel_playwright",
          type: "carousel",
          aspectRatio: "landscape",
          images: [
            {
              id: "image_first",
              url: FIRST_IMAGE_URL,
              alt: FIRST_IMAGE_ALT,
            },
            {
              id: "image_second",
              url: SECOND_IMAGE_URL,
              alt: SECOND_IMAGE_ALT,
            },
          ],
        },
      ],
    },
  };
}
