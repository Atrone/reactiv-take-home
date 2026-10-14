import { memo, useEffect, useRef, useState, type JSX } from "react";
import type { DraftCarouselSection, DraftImage } from "../editor/draft-document.js";
import { sectionHint, sectionLabel } from "../editor/section-summary.js";
import {
  EMPTY_CAROUSEL_MESSAGE,
  IMAGE_UNAVAILABLE_LABEL,
  NEXT_IMAGE_LABEL,
  PREVIOUS_IMAGE_LABEL,
  frameAspectRatio,
  imageFinishedWithoutPixels,
  imageLoadingMode,
  imageSource,
  slideAccessibleName,
  unavailableAltText,
} from "./carousel-fields.js";
import "./carousel-section.css";

/**
 * Fill behind a slide so a slow or failed image does not show an empty gap.
 *
 * This is not a merchant color. Text and button colors come from the draft.
 */
const FRAME_BACKGROUND = "#f3efe6";

/**
 * Keeps a slide index inside a carousel.
 *
 * Purpose: previous and next stop at the ends instead of wrapping.
 * Inputs: index, the requested position. count, the number of slides.
 * Side effects: none.
 */
function clampSlideIndex(index: number, count: number): number {
  if (count <= 0) {
    // An empty carousel has no slide to select.
    return 0;
  }
  if (index < 0) {
    // The first slide is the start. There is no wrap to the last slide.
    return 0;
  }
  if (index >= count) {
    // The last slide is the end. There is no wrap to the first slide.
    return count - 1;
  }
  return index;
}

/**
 * Scrolls one carousel so the chosen slide starts at the left of its own scroller.
 *
 * Purpose: Previous image and Next image move by one slide. The motion is this control's scroll, not an automatic timer.
 * Inputs: scroller, the horizontal region for one carousel. index, the slide to show.
 * Side effects: sets scrollLeft on that element only.
 */
function scrollCarouselToIndex(scroller: HTMLElement, index: number): void {
  const slide = scroller.querySelectorAll("[data-carousel-slide]").item(index);
  if (!(slide instanceof HTMLElement)) {
    // The slide is not in the document yet. The caller still stores the index.
    return;
  }
  // The distance from the scroller's left edge to the slide, plus the current scroll, is the next scrollLeft.
  const delta = slide.getBoundingClientRect().left - scroller.getBoundingClientRect().left;
  scroller.scrollTo({ left: scroller.scrollLeft + delta, behavior: "auto" });
}

/**
 * Reads which slide is nearest the left edge of one scroller.
 *
 * Purpose: a trackpad scroll can disable Previous or Next without wrapping.
 * Inputs: scroller, the horizontal region. count, the number of slides.
 * Side effects: none.
 */
function slideIndexFromScroll(scroller: HTMLElement, count: number): number {
  if (count <= 0) {
    // Nothing is in view. The controls stay at the empty position.
    return 0;
  }
  const scrollerBox = scroller.getBoundingClientRect();
  const slides = scroller.querySelectorAll("[data-carousel-slide]");
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides.item(index);
    if (!(slide instanceof HTMLElement)) {
      // A non-element child is not a slide.
      continue;
    }
    // The slide closest to the scroller's left edge is the one the controls report.
    const distance = Math.abs(slide.getBoundingClientRect().left - scrollerBox.left);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  }
  return clampSlideIndex(nearestIndex, count);
}

/**
 * Renders the fallback inside one slide frame.
 *
 * Purpose: the broken icon is replaced by Image unavailable and the alt text, inside the same frame.
 * Inputs: alt, the raw draft alt text.
 * Side effects: none.
 */
function ImageUnavailable({ alt }: { alt: string }): JSX.Element {
  // A blank alt stays off the caption. A written alt is the second line.
  const description = unavailableAltText(alt);
  return (
    <p
      className="carousel-placeholder"
      data-image-placeholder="unavailable"
      style={{ position: "absolute", inset: 0, margin: 0, overflow: "hidden" }}
    >
      {/* The sentence names the failure. The frame around this text keeps its aspect ratio. */}
      <span>{IMAGE_UNAVAILABLE_LABEL}</span>
      {description === "" ? null : (
        // The written alt identifies the slide. A blank alt adds no caption.
        <span className="carousel-placeholder-alt">{description}</span>
      )}
    </p>
  );
}

/**
 * Renders one snap item.
 *
 * Purpose: the frame keeps this carousel's ratio and a background before the image decodes.
 * A load error replaces that image with Image unavailable and the alt text when it is present.
 * The first slide loads eagerly. Later slides use lazy loading.
 * Inputs: image, the slide. index, its zero-based position. ratio, the CSS aspect-ratio for every frame in this carousel.
 * Side effects: records a failed address in this slide. It does not change the draft or call the configuration service.
 */
function CarouselSlide({
  image,
  index,
  ratio,
}: {
  image: DraftImage;
  index: number;
  ratio: string;
}): JSX.Element {
  // One address that failed in this slide. A different URL is a new request.
  const [failedSource, setFailedSource] = useState<string | null>(null);
  // A valid http(s) URL is requested. An empty or invalid address stays off src.
  const source = imageSource(image.url);
  // The failure belongs to one address. Editing the URL shows the image for the new address.
  const failed = source !== null && failedSource === source;
  // The first slide is eager. Every later slide in this carousel is lazy.
  const loading = imageLoadingMode(index);
  // The effect reads the element after commit, including a response that finished first.
  const imageRef = useRef<HTMLImageElement | null>(null);

  /**
   * Keeps the mounted image for the failure check.
   *
   * Purpose: a request can finish before the error listener runs.
   * Inputs: node, the img element, or null when it unmounts.
   * Side effects: stores the element on this slide.
   */
  function rememberImage(node: HTMLImageElement | null): void {
    // The next effect reads this node. Unmount clears it.
    imageRef.current = node;
  }

  /**
   * Records a response that already failed.
   *
   * Purpose: an eager image can 404 before React attaches the error listener.
   * Inputs: none. The stored img and the current src are the request.
   * Side effects: may store the failed address. It does not change the draft.
   */
  function recordFinishedFailure(): void {
    const node = imageRef.current;
    if (node === null || source === null) {
      // There is no requested image in this slide.
      return;
    }
    if (
      imageFinishedWithoutPixels(
        { complete: node.complete, naturalWidth: node.naturalWidth, src: node.src },
        navigator.userAgent,
      )
    ) {
      // The response already failed. Show the placeholder in this frame.
      setFailedSource(source);
    }
  }

  useEffect(recordFinishedFailure, [source]);

  /**
   * Records that the browser could not load this slide.
   *
   * Purpose: the frame stays, the draft URL stays, and the placeholder replaces the broken icon.
   * Inputs: none. The current src is the address that failed.
   * Side effects: stores that address in this slide. It does not dispatch an editor command.
   */
  function markImageUnavailable(): void {
    if (source === null) {
      // Nothing was requested. The empty frame stays as it is.
      return;
    }
    // Remember this address. The section, the URL field, and document validity stay unchanged.
    setFailedSource(source);
  }

  return (
    <div
      className="carousel-slide"
      data-carousel-slide={image.id}
      style={{ flex: "0 0 100%", width: "100%", minWidth: 0, maxWidth: "100%", scrollSnapAlign: "start" }}
    >
      <div
        className="carousel-frame"
        data-carousel-frame="true"
        style={{
          aspectRatio: ratio,
          width: "100%",
          position: "relative",
          overflow: "hidden",
          backgroundColor: FRAME_BACKGROUND,
        }}
      >
        {failed ? (
          <ImageUnavailable alt={image.alt} />
        ) : (
          // The browser loads src from the image host. This img does not set an Authorization header.
          // Image bytes are not a configuration-service request and do not include the service token.
          <img
            ref={rememberImage}
            alt={slideAccessibleName(image.alt, index)}
            loading={loading}
            onError={markImageUnavailable}
            {...(source === null ? {} : { src: source })}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Renders one carousel in the phone preview.
 *
 * The region scrolls horizontally with scroll-snap-type x mandatory. Each frame uses the
 * section's aspect ratio and object-fit cover. Previous image and Next image are buttons.
 * They scroll by one slide and are disabled at the ends. There is no automatic motion.
 * An empty list shows "No images in this carousel" and does not throw.
 * A failed image shows "Image unavailable" in that frame. The section and the URL stay.
 * The first image loads eagerly. Later images use lazy loading.
 * Inputs: section, the carousel row from the draft.
 * Side effects: after mount, records that the client buttons are live. A control then scrolls this carousel's own region.
 */
function CarouselPreviewView({ section }: { section: DraftCarouselSection }): JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const [clientReady, setClientReady] = useState(false);
  // A button scroll should not immediately replace the index it just stored.
  const ignoreNextScroll = useRef(false);

  /**
   * Marks this preview as mounted in the browser.
   *
   * Purpose: Previous image and Next image scroll only after the client handlers are attached.
   * Inputs: none.
   * Side effects: stores that this preview has mounted.
   */
  function markClientReady(): void {
    // Effects do not run during server render. The flag means these buttons are live.
    setClientReady(true);
  }

  useEffect(markClientReady, []);
  // A removed tail slide must not leave the index past the new end.
  const boundedIndex = clampSlideIndex(activeIndex, section.images.length);
  if (boundedIndex !== activeIndex) {
    // Adjust during render so the disabled state matches the slides that are left.
    setActiveIndex(boundedIndex);
  }
  const ratio = frameAspectRatio(section.aspectRatio);
  const atStart = section.images.length === 0 || boundedIndex <= 0;
  const atEnd = section.images.length === 0 || boundedIndex >= section.images.length - 1;
  const label = sectionLabel(section);
  const hint = sectionHint(section);
  const scrollerId = `carousel-scroller-${section.id}`;

  /**
   * Shows one slide in this carousel.
   *
   * Purpose: the buttons move one position and stop at the ends.
   * Inputs: index, the slide to show.
   * Side effects: stores the index and scrolls this carousel's region.
   */
  function showSlide(index: number): void {
    const nextIndex = clampSlideIndex(index, section.images.length);
    // Store the position even when the region cannot scroll yet.
    ignoreNextScroll.current = true;
    setActiveIndex(nextIndex);
    const scroller = document.getElementById(scrollerId);
    if (scroller instanceof HTMLElement) {
      // Move this carousel only. The ignored scroll event is the one this call causes.
      scrollCarouselToIndex(scroller, nextIndex);
    }
    queueMicrotask(() => {
      // A later drag can update the index again. This click's event has already been skipped.
      ignoreNextScroll.current = false;
    });
  }

  /**
   * Aligns the button index with a scroll the person performed.
   *
   * Purpose: dragging the scroller updates which end control is disabled.
   * Inputs: event, the scroll event from this carousel's region.
   * Side effects: may store a new index. It does not scroll a different carousel.
   */
  function syncIndexFromScroll(event: { currentTarget: HTMLElement }): void {
    if (ignoreNextScroll.current) {
      // This event came from Previous or Next. The stored index already matches that control.
      ignoreNextScroll.current = false;
      return;
    }
    const scroller = event.currentTarget;
    if (scroller.scrollWidth <= scroller.clientWidth + 1) {
      // The region cannot move a slide. Keep the index the buttons already stored.
      return;
    }
    // Read the region that scrolled. Another carousel has its own element.
    const nextIndex = slideIndexFromScroll(scroller, section.images.length);
    setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
  }

  return (
    <li
      className="preview-carousel"
      data-section-id={section.id}
      data-preview-label={label}
      data-preview-hint={hint}
      data-carousel-ready={clientReady ? "true" : "false"}
    >
      <div className="carousel-controls">
        <button
          type="button"
          disabled={atStart}
          aria-controls={scrollerId}
          onClick={() => {
            // One slide toward the start. The button is disabled on the first slide.
            showSlide(boundedIndex - 1);
          }}
        >
          {PREVIOUS_IMAGE_LABEL}
        </button>
        <button
          type="button"
          disabled={atEnd}
          aria-controls={scrollerId}
          onClick={() => {
            // One slide toward the end. The button is disabled on the last slide.
            showSlide(boundedIndex + 1);
          }}
        >
          {NEXT_IMAGE_LABEL}
        </button>
      </div>
      {section.images.length === 0 ? (
        <p className="carousel-empty">{EMPTY_CAROUSEL_MESSAGE}</p>
      ) : (
        <div
          id={scrollerId}
          className="carousel-scroller"
          data-carousel-scroller={section.id}
          style={{
            display: "flex",
            width: "100%",
            minWidth: 0,
            maxWidth: "100%",
            overflowX: "auto",
            scrollSnapType: "x mandatory",
            position: "relative",
          }}
          onScroll={(event) => {
            // A person can also drag this region. The buttons follow that position.
            syncIndexFromScroll(event);
          }}
        >
          {section.images.map((image, index) => (
            <CarouselSlide key={image.id} image={image} index={index} ratio={ratio} />
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Memoized carousel preview.
 *
 * Each carousel keeps its own scroller and its own aspect ratio.
 */
export const CarouselPreview = memo(CarouselPreviewView);
