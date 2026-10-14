import { memo, useState, type JSX } from "react";
import { normalizeHexColor } from "@reactiv/contracts";
import type { DraftCtaSection } from "../editor/draft-document.js";
import { sectionHint, sectionLabel } from "../editor/section-summary.js";
import {
  DEFAULT_CTA_BACKGROUND_COLOR,
  DEFAULT_CTA_LABEL_COLOR,
  OPEN_DESTINATION_LABEL,
  destinationLine,
  openDestinationHref,
} from "./cta-fields.js";
import "./cta-section.css";

/** The last valid paint color remembered for one CTA field. */
type PreviewColorMemory = {
  sectionId: string;
  color: string;
};

/**
 * Remembers the last valid color for one CTA field and returns the color the preview paints.
 *
 * Purpose: an incomplete string such as "#" stays out of the paint color without resetting the input.
 * This is the same last-valid-color rule the text preview uses.
 * Inputs: sectionId, the section this preview belongs to. current, the raw draft color.
 * fallback, #112233 or #ffffff when this field has never been valid.
 * Side effects: may store a new valid color in state so the next incomplete keystroke can read it.
 */
function useLastValidColor(sectionId: string, current: string, fallback: string): string {
  // A valid draft color expands to lowercase #rrggbb. "#" and "#12" stay null.
  const normalized = normalizeHexColor(current);
  const [memory, setMemory] = useState<PreviewColorMemory>(() => ({
    sectionId,
    color: normalized ?? fallback,
  }));
  if (memory.sectionId !== sectionId) {
    // A different section must not reuse the previous section's color.
    const color = normalized ?? fallback;
    setMemory({ sectionId, color });
    return color;
  }
  if (normalized !== null && normalized !== memory.color) {
    // Store the valid color during this render so the next invalid keystroke still has it.
    setMemory({ sectionId, color: normalized });
  }
  if (normalized !== null) {
    // The current string is valid, so the preview uses it immediately.
    return normalized;
  }
  // The draft string is incomplete. The input keeps that string; the paint color does not.
  return memory.color;
}

/**
 * Renders one call-to-action section in the phone preview.
 *
 * Preview activation reveals the URL; Open destination is the explicit navigation.
 * The preview control is a button with type="button", so activating it shows the destination
 * as text and does not leave the editor or submit a form. It does not call location.assign
 * or open a window. Open destination is an anchor with target="_blank" and rel="noreferrer".
 * It is the only control that navigates, and only as a new tab. It is omitted when the URL
 * is not an absolute HTTP(S) URL. The button background and label color follow the last valid
 * color, defaulting to #112233 and #ffffff.
 * Inputs: section, the CTA row from the draft.
 * Side effects: none until the button is activated, which only reveals text in this preview.
 */
function CtaPreviewView({ section }: { section: DraftCtaSection }): JSX.Element {
  // Button color and label color remember their colors separately.
  const backgroundColor = useLastValidColor(section.id, section.backgroundColor, DEFAULT_CTA_BACKGROUND_COLOR);
  const labelColor = useLastValidColor(section.id, section.labelColor, DEFAULT_CTA_LABEL_COLOR);
  // The revealed flag is this section's id, so another section rendered in this instance starts hidden.
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const revealed = revealedFor === section.id;
  // A valid URL is the anchor href. An invalid URL leaves the button and omits the anchor.
  const href = openDestinationHref(section.url);
  // The row hint stays on the attribute. The visible button text is the draft label, including a blank one.
  const label = sectionLabel(section);
  const hint = sectionHint(section);

  /**
   * Shows the draft URL inside this preview.
   *
   * Purpose: activation reveals the destination without navigating or submitting a form.
   * Inputs: none. The URL is read from the current section when the line renders.
   * Side effects: stores this section id so the destination line is shown.
   */
  function revealDestination(): void {
    // Record this section only. Do not assign location or open a window.
    setRevealedFor(section.id);
  }

  return (
    <li className="preview-cta" data-section-id={section.id} data-preview-label={label} data-preview-hint={hint}>
      {/* type="button" so activation cannot navigate and cannot submit the editor form. */}
      <button
        type="button"
        className="preview-cta-button"
        style={{ backgroundColor, color: labelColor }}
        onClick={() => {
          // Show the draft URL as text. This click does not follow a link.
          revealDestination();
        }}
      >
        {/* React text. Markup in the label is shown as characters. */}
        {section.label}
      </button>
      {revealed ? (
        <p className="preview-cta-destination" aria-live="polite">
          {destinationLine(section.url)}
        </p>
      ) : null}
      {href !== null ? (
        <a className="preview-cta-open" href={href} target="_blank" rel="noreferrer">
          {OPEN_DESTINATION_LABEL}
        </a>
      ) : null}
    </li>
  );
}

/**
 * Memoized CTA preview.
 *
 * Preview activation reveals the URL; Open destination is the explicit navigation.
 */
export const CtaPreview = memo(CtaPreviewView);
