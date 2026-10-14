import { assertNever, getSectionRegistryEntry } from "@reactiv/contracts";
import type { DraftSection } from "./draft-document.js";

/** Shown when a carousel has no slide, or the first slide has no alt text. */
export const EMPTY_CAROUSEL_HINT = "Empty carousel";

/** Shown when a text section has a blank title. */
export const EMPTY_TEXT_HINT = "Untitled";

/** Shown when a button section has a blank label. */
export const EMPTY_BUTTON_HINT = "Untitled button";

/**
 * Reads the add-menu label for one section.
 *
 * Purpose: the list, the move buttons, and the preview share the registry name.
 * Inputs: section, the draft row.
 * Side effects: none.
 */
export function sectionLabel(section: DraftSection): string {
  // Carousel, Text, or Button. The stored type for a button stays `cta`.
  return getSectionRegistryEntry(section.type).label;
}

/**
 * Reads the short content hint for one section.
 *
 * Purpose: two rows of the same type stay distinguishable in the list and the preview.
 * Inputs: section, the draft row.
 * Side effects: none.
 */
export function sectionHint(section: DraftSection): string {
  switch (section.type) {
    case "carousel": {
      // The first slide's alt text is the hint. Later slides stay on that carousel.
      const first = section.images[0];
      if (first === undefined || first.alt.trim() === "") {
        return EMPTY_CAROUSEL_HINT;
      }
      return first.alt;
    }
    case "text": {
      // A blank title still leaves a row the author can select.
      if (section.title.trim() === "") {
        return EMPTY_TEXT_HINT;
      }
      return section.title;
    }
    case "cta": {
      // The button label is the hint. The URL stays in the draft for a later field.
      if (section.label.trim() === "") {
        return EMPTY_BUTTON_HINT;
      }
      return section.label;
    }
    default:
      // A fourth section type fails here until the hint switch learns a branch.
      return assertNever(section);
  }
}

/**
 * Builds an accessible name that includes the section label and its hint.
 *
 * Purpose: Reorder, Remove, and Select name the row they affect.
 * Inputs: action, the verb such as "Reorder". section, the draft row.
 * Side effects: none.
 */
export function sectionControlName(action: string, section: DraftSection): string {
  // The label is the registry name. The hint separates two carousels or two text blocks.
  return `${action} ${sectionLabel(section)}, ${sectionHint(section)}`;
}

/**
 * Finds the section the editor currently has selected.
 *
 * Purpose: the inspector reads one row from the same array the preview renders.
 * Inputs: sections, the draft list. selectedSectionId, the id from editor state, or null.
 * Side effects: none.
 */
export function findSelectedSection(
  sections: readonly DraftSection[],
  selectedSectionId: string | null,
): DraftSection | undefined {
  if (selectedSectionId === null) {
    // An empty document has nothing to inspect.
    return undefined;
  }
  for (const section of sections) {
    // The first matching id is the row. A duplicate later in the list is left alone.
    if (section.id === selectedSectionId) {
      return section;
    }
  }
  return undefined;
}
