# 17 — Image resilience

13 October 2026. Prompt 18 was not started.

## Frames and failure

Each slide frame keeps the carousel's aspect ratio and a `#f3efe6` background before the image decodes. The image sits inside that frame, so a slow response does not set the phone preview's height. Portrait stays `3 / 4`, landscape `16 / 9`, and square `1 / 1`.

The browser `error` event replaces that image with `Image unavailable` and the alt text when the author wrote some. A blank alt does not add a `Slide n` caption. The frame's aspect ratio stays. The section stays in the list. The Image URL field keeps the failing address and stays editable. `validateDraft` still accepts a syntactically valid URL such as `https://example.com/missing.png`. A 404 is not a document error. URL syntax validation is unchanged.

An eager image can finish before React attaches the listener. After commit, a finished image with no pixels uses the same placeholder. Happy-dom reports every image that way without fetching, so that check ignores a HappyDOM user agent. Component tests dispatch `error` directly.

The first image in each carousel uses `loading="eager"`. Later images use `loading="lazy"`.

## Who loads the bytes

The browser loads image bytes from the image host. The `<img>` does not set an `Authorization` header. Those requests are not configuration-service requests and do not include the service token. There is no image proxy.

## Checks

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 266 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- In the browser, on `http://127.0.0.1:5173/`, the first slide of the first carousel was `https://placehold.co/640x360.jpg` and the second was `https://example.com/missing.png`. Both frames measured 319 by 179 with `aspect-ratio: 16 / 9`. The loaded slide showed the image. Next image showed `Image unavailable` and `Missing landscape` in a frame of the same size. Both URL fields and both alt fields stayed editable. The second carousel stayed portrait at 319 by 425.

## Acceptance progress

The exit gate for this prompt passes. Frames reserve the selected aspect ratio while images load. A broken URL shows a bounded `Image unavailable` placeholder and does not collapse the frame. Later images can load lazily. The first image does not. A failed image does not block editing and does not make the document invalid.

R06 is not fully passed yet. The criterion also says a failed image does not block export or Save. Those controls are still disabled. Prompt 20 must add the test that a syntactically valid image URL which 404s can still be exported and saved. This prompt does not add a validity rule that would block that.

Page 1, carousel display, now includes the image failure state. Page 4, graceful handling, is met for a broken image inside an otherwise valid section. The page does not throw for `https://example.com/missing.png`.
