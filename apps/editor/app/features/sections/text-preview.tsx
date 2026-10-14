import { memo, useState, type JSX } from "react";
import { normalizeHexColor } from "@reactiv/contracts";
import type { DraftTextSection } from "../editor/draft-document.js";
import { sectionHint, sectionLabel } from "../editor/section-summary.js";
import {
  DEFAULT_TEXT_DESCRIPTION_COLOR,
  DEFAULT_TEXT_TITLE_COLOR,
} from "./text-contrast.js";
import "./text-section.css";

/** The last valid paint color remembered for one text section. */
type PreviewColorMemory = {
  sectionId: string;
  color: string;
};

/**
 * Remembers the last valid color for one field and returns the color the preview paints.
 *
 * Purpose: an incomplete string such as "#" stays out of the paint color without resetting the input.
 * Inputs: sectionId, the section this preview belongs to. current, the raw draft color.
 * fallback, #112233 or #334455 when this field has never been valid.
 * Side effects: may store a new valid color in state so the next incomplete keystroke can read it.
 */
function usePreviewColor(sectionId: string, current: string, fallback: string): string {
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
 * Renders one text section as title and description text.
 *
 * Purpose: the phone shows the draft copy and the last valid color for each field.
 * Inputs: section, the text row from the draft.
 * Side effects: none. The color memory lives in this component and is not written back to the draft.
 */
function TextPreviewView({ section }: { section: DraftTextSection }): JSX.Element {
  // Title and description remember their colors separately.
  const titleColor = usePreviewColor(section.id, section.titleColor, DEFAULT_TEXT_TITLE_COLOR);
  const descriptionColor = usePreviewColor(section.id, section.descriptionColor, DEFAULT_TEXT_DESCRIPTION_COLOR);
  // The row hint stays on the attribute. The visible title is the draft string, including a blank one.
  const label = sectionLabel(section);
  const hint = sectionHint(section);
  return (
    <li className="preview-text" data-section-id={section.id} data-preview-label={label} data-preview-hint={hint}>
      {/* React text nodes. Markup in the title is shown as characters. */}
      <p className="preview-text-title" style={{ color: titleColor, overflowWrap: "anywhere" }}>
        {section.title}
      </p>
      {/* pre-wrap keeps the author's newlines and still wraps a long line. */}
      <p
        className="preview-text-description"
        style={{ color: descriptionColor, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
      >
        {section.description}
      </p>
    </li>
  );
}

/** Memoized text preview. An untouched section keeps its last valid colors. */
export const TextPreview = memo(TextPreviewView);
