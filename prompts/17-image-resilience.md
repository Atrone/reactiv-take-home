# Prompt 17 — Image resilience

Implement only this prompt. Preconditions: prompt 16 is done. Live preview tests pass.

## Read first

- Architecture section 6, reserved media space, lazy loading, first visible media, broken images
- Acceptance criteria R06. The frame, placeholder, and lazy-loading behavior is the exit gate. R06 fully passes in prompt 20, when a broken image still allows export and Save
- Take-home PDF page 4, graceful error handling, as it applies to a broken image inside an otherwise valid section

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- A broken image must not prevent editing, export, or a later Save. Export and Save may not be wired yet; do not block them in advance, and do not add a rule that treats a failed image response as an invalid document.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/17-image-resilience.md`.
- URL syntax validation stays as it is. A URL can be syntactically valid and still 404.

## Goal

Carousel frames keep their aspect ratio while images load and when images fail. A failed image shows a bounded placeholder. Off-screen images can load lazily. The editor remains usable.

## Implement

1. Each slide's frame has the selected aspect ratio before the image decodes. The frame has a background and a fixed aspect ratio so a slow image does not collapse the phone preview's height.
2. On the image `error` event, replace the broken icon with a visible placeholder inside that same frame: text `Image unavailable` and the alt text if present. The frame's aspect ratio stays.
3. The first image in a carousel uses eager loading. Later images use `loading="lazy"`. Do not lazy-load the first image.
4. A broken image does not remove the section, does not clear the URL field, and does not mark the document invalid by itself.
5. Tests:
   - a slide frame has the expected aspect-ratio style before you need a successful load
   - firing `error` on an image shows `Image unavailable` inside that frame and leaves the other carousel's images mounted
   - the URL input still shows the failing URL
   - the second image element has `loading="lazy"` and the first does not
   - the page does not throw when the fixture contains `https://example.com/missing.png`

Playwright is optional here if the component test can dispatch `error`. Use Playwright only if jsdom cannot fire the error event reliably.

## Out of scope

- A server-side image proxy, SSRF protections for fetching remote images, and a custom CDN. The browser loads image URLs directly. Those requests are not configuration-service requests and must not include the service token. Add a test or a code comment at the `<img>` that no `Authorization` header is set by the app.

## Acceptance criteria

R06 does not fully pass until prompt 20, because the criterion also says a failed image does not block export or Save, and those controls are not both wired yet.

Exit gate required here:

- Frames reserve the selected aspect ratio while images load.
- A broken or slow URL shows a bounded `Image unavailable` placeholder and does not collapse the frame.
- Later images can load lazily. The first image does not.
- A failed image does not block editing and does not make the document invalid.
- Do not add a validity rule that would later block export or Save because an image returned 404.

Prompt 20 must add a test that a syntactically valid image URL which 404s can still be exported and saved.

## Take-home PDF requirements

Page 1, carousel display, now includes a failure state for images. The PDF does not require a proxy. Page 4, graceful handling, is met for this input.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manually point one image at a 404 URL and one at a valid URL. Confirm the frames stay the same size and the inspector still edits both

## Done when

- The exit-gate tests pass.
- The note records that image bytes are loaded by the browser from the image host, not by the configuration service, and that R06 is not fully passed yet.
- You have not started prompt 18.
