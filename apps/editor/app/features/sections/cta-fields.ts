import { isAbsoluteHttpUrl } from "@reactiv/contracts";

/** Inline error for a blank CTA label. The draft keeps the characters the author typed. */
export const LABEL_REQUIRED_ERROR = "Enter a label.";

/** Inline error for a non-empty link that is not an absolute HTTP(S) URL. */
export const LINK_ERROR = "Link must be an absolute HTTP(S) URL.";

/** Inline error for a non-empty button color that is not #RGB or #RRGGBB. */
export const BUTTON_COLOR_ERROR = "Button color must be a hex color like #112233.";

/** Inline error for a non-empty label color that is not #RGB or #RRGGBB. */
export const LABEL_COLOR_ERROR = "Label color must be a hex color like #112233.";

/** Preview button background when that field has never held a valid hex color. */
export const DEFAULT_CTA_BACKGROUND_COLOR = "#112233";

/** Preview label color when that field has never held a valid hex color. */
export const DEFAULT_CTA_LABEL_COLOR = "#ffffff";

/** Visible name of the anchor that opens the destination in a new tab. */
export const OPEN_DESTINATION_LABEL = "Open destination";

/**
 * Returns the inline error for a blank CTA label.
 *
 * Purpose: an empty or whitespace-only label is named, and rendering it does not throw.
 * Inputs: value, the raw draft label.
 * Side effects: none.
 */
export function labelFieldError(value: string): string | null {
  // Trim only the ends. A label with internal spaces is still a label.
  if (value.trim() === "") {
    return LABEL_REQUIRED_ERROR;
  }
  // A non-blank label stays in the draft, including surrounding spaces.
  return null;
}

/**
 * Returns the inline error for a CTA link, or null while the field may stay as it is.
 *
 * Purpose: an empty link is unfinished. A non-empty invalid link names the field and stays in the draft.
 * Inputs: value, the raw draft URL.
 * Side effects: none.
 */
export function linkFieldError(value: string): string | null {
  if (value === "") {
    // Empty is in progress. The preview omits Open destination until the URL is absolute http(s).
    return null;
  }
  if (isAbsoluteHttpUrl(value)) {
    // http and https are accepted. The draft keeps the characters the author typed.
    return null;
  }
  // notaurl, a missing host, and a script URL name the Link field.
  return LINK_ERROR;
}

/**
 * Formats the destination line the preview shows after the button is activated.
 *
 * Purpose: the revealed text is the draft URL, including a URL the schema would reject.
 * Inputs: url, the raw draft link.
 * Side effects: none.
 */
export function destinationLine(url: string): string {
  // The prefix is fixed. The URL is not rewritten and is not turned into a link.
  return `Destination: ${url}`;
}

/**
 * Returns the href for Open destination, or null when that anchor must stay hidden.
 *
 * Purpose: the anchor is the only control that navigates, and an invalid URL must not be an anchor.
 * Inputs: url, the raw draft link.
 * Side effects: none.
 */
export function openDestinationHref(url: string): string | null {
  if (!isAbsoluteHttpUrl(url)) {
    // An empty link, notaurl, and a javascript URL stay off the anchor. The preview button remains.
    return null;
  }
  // The href is the typed URL. The caller opens it in a new tab.
  return url;
}
