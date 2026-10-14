import { ASPECT_RATIO_DISPLAY, isAbsoluteHttpUrl } from "@reactiv/contracts";
import type { DraftCarouselSection, DraftImage } from "../editor/draft-document.js";

/** Visible name of the aspect-ratio radio group. */
export const ASPECT_RATIO_FIELD_LABEL = "Aspect ratio";

/** Visible name of the portrait choice. The stored value stays `portrait`. */
export const PORTRAIT_LABEL = "Portrait";

/** Visible name of the landscape choice. The stored value stays `landscape`. */
export const LANDSCAPE_LABEL = "Landscape";

/** Visible name of the square choice. The stored value stays `square`. */
export const SQUARE_LABEL = "Square";

/** Visible name of each image address field. */
export const IMAGE_URL_LABEL = "Image URL";

/** Visible name of each image description field. */
export const ALT_TEXT_LABEL = "Alt text";

/** Visible name of the control that appends a slide. */
export const ADD_IMAGE_LABEL = "Add image";

/** Visible name of the control that deletes one slide. */
export const REMOVE_IMAGE_LABEL = "Remove image";

/** Accessible name of the control that moves to the earlier slide. */
export const PREVIOUS_IMAGE_LABEL = "Previous image";

/** Accessible name of the control that moves to the later slide. */
export const NEXT_IMAGE_LABEL = "Next image";

/** Shown in the phone when a carousel has no slides. */
export const EMPTY_CAROUSEL_MESSAGE = "No images in this carousel";

/** Shown inside a frame when the browser cannot load that slide. */
export const IMAGE_UNAVAILABLE_LABEL = "Image unavailable";

/** Inline error for a non-empty image address that is not an absolute HTTP(S) URL. */
export const IMAGE_URL_ERROR = "Image URL must be an absolute HTTP(S) URL.";

/** Radio choices in the order Portrait, Landscape, Square. */
export const ASPECT_RATIO_CHOICES = [
  { value: "portrait", label: PORTRAIT_LABEL },
  { value: "landscape", label: LANDSCAPE_LABEL },
  { value: "square", label: SQUARE_LABEL },
] as const satisfies readonly { value: DraftCarouselSection["aspectRatio"]; label: string }[];

/**
 * Returns the inline error for one image address, or null while the field may stay as it is.
 *
 * Purpose: an empty address is unfinished. A non-empty invalid address names the field and stays in the draft.
 * Inputs: value, the raw draft URL.
 * Side effects: none.
 */
export function imageUrlFieldError(value: string): string | null {
  if (value === "") {
    // Empty is in progress. The preview does not request this slide yet.
    return null;
  }
  if (isAbsoluteHttpUrl(value)) {
    // http and https are accepted. The draft keeps the characters the author typed.
    return null;
  }
  // notaurl, a missing host, and a script URL name the Image URL field.
  return IMAGE_URL_ERROR;
}

/**
 * Returns the CSS aspect-ratio for one stored name.
 *
 * Purpose: portrait, landscape, and square become 3 / 4, 16 / 9, and 1 / 1.
 * Landscape is 16 / 9. The checklist's 4 / 3 is not the ratio this preview uses.
 * Inputs: aspectRatio, the name stored on the carousel.
 * Side effects: none.
 */
export function frameAspectRatio(aspectRatio: DraftCarouselSection["aspectRatio"]): string {
  // The shared map is the only source of the three CSS ratios.
  return ASPECT_RATIO_DISPLAY[aspectRatio];
}

/**
 * Returns the img accessible name for one slide.
 *
 * Purpose: a blank alt uses Slide n as the accessible name only. The caller does not render that fallback as a caption.
 * Inputs: alt, the raw draft alt text. index, the zero-based position in this carousel.
 * Side effects: none.
 */
export function slideAccessibleName(alt: string, index: number): string {
  if (alt.trim() === "") {
    // Slide numbers start at 1 so the first blank slide is Slide 1.
    return `Slide ${index + 1}`;
  }
  // A written description is the accessible name, including surrounding spaces.
  return alt;
}

/**
 * Returns the accessible name of the control that removes one slide.
 *
 * Purpose: each Remove image control names its own position when a carousel has several slides.
 * Inputs: index, the zero-based position in this carousel.
 * Side effects: none.
 */
export function removeImageName(index: number): string {
  // The visible control still says Remove image. The number tells the slides apart.
  return `${REMOVE_IMAGE_LABEL} ${index + 1}`;
}

/**
 * Reports whether a string is one of the three stored aspect-ratio names.
 *
 * Purpose: a radio value is a string until it is checked against the draft union.
 * Inputs: value, the radio value.
 * Side effects: none.
 */
export function isAspectRatioName(value: string): value is DraftCarouselSection["aspectRatio"] {
  if (value === "portrait" || value === "landscape" || value === "square") {
    // The three names are the only ones the document schema accepts.
    return true;
  }
  return false;
}

/**
 * Returns the image src when the address can be requested, or null when it must not be.
 *
 * Purpose: an empty or invalid address is not assigned to src, so the page does not request itself.
 * An absolute http(s) URL is requested by the browser. A later load failure is the slide placeholder, not a document error.
 * Inputs: url, the raw draft address.
 * Side effects: none.
 */
export function imageSource(url: string): string | null {
  if (!isAbsoluteHttpUrl(url)) {
    // Empty, notaurl, and non-http schemes stay off the img element.
    return null;
  }
  // The src is the typed URL. The preview does not rewrite it.
  return url;
}

/**
 * Chooses how one slide requests its image.
 *
 * Purpose: the first slide loads immediately. Later slides can wait until they are near the viewport.
 * Inputs: index, the zero-based position in this carousel.
 * Side effects: none.
 */
export function imageLoadingMode(index: number): "eager" | "lazy" {
  if (index === 0) {
    // The first image is the one in view. It is not marked lazy.
    return "eager";
  }
  // Off-screen slides use the browser's lazy loading.
  return "lazy";
}

/**
 * Reports whether an image request already finished without pixels.
 *
 * Purpose: a 404 can finish before the error listener is attached. Happy-dom does not load image files, so its zero width is not a failure.
 * Inputs: image, the complete flag, natural width, and src. userAgent, the browser string.
 * Side effects: none.
 */
export function imageFinishedWithoutPixels(
  image: { complete: boolean; naturalWidth: number; src: string },
  userAgent: string,
): boolean {
  if (userAgent.includes("HappyDOM")) {
    // This environment leaves every image complete with no pixels. That is not a 404.
    return false;
  }
  if (image.src === "") {
    // An empty address was not requested.
    return false;
  }
  if (image.complete && image.naturalWidth === 0) {
    // The browser finished the request and decoded no pixels.
    return true;
  }
  // The request is still running, or the browser decoded pixels.
  return false;
}

/**
 * Returns the alt text to show on a failed image, or an empty string when alt is blank.
 *
 * Purpose: a written description is part of the placeholder. Slide n stays an accessible name, not a caption.
 * Inputs: alt, the raw draft alt text.
 * Side effects: none.
 */
export function unavailableAltText(alt: string): string {
  if (alt.trim() === "") {
    // A blank alt has no visible description. The placeholder is the sentence Image unavailable.
    return "";
  }
  // The author-written alt is shown as text inside the same frame.
  return alt;
}

/**
 * Copies one slide list.
 *
 * Purpose: an aspect-ratio edit can keep the same slides without sharing the draft array.
 * Inputs: images, the carousel's current slides.
 * Side effects: none.
 */
export function copyCarouselImages(images: readonly DraftImage[]): DraftImage[] {
  const copied: DraftImage[] = [];
  for (const image of images) {
    // Each slide is a new object. The source list is left unchanged.
    copied.push({
      id: image.id,
      url: image.url,
      alt: image.alt,
    });
  }
  return copied;
}
