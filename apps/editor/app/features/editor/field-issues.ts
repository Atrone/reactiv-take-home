import {
  CAROUSEL_IMAGE_LIMIT_MESSAGE,
  DOCUMENT_IMAGE_LIMIT_MESSAGE,
  LIMITS,
  SECTION_LIMIT_MESSAGE,
  type ErrorIssue,
} from "@reactiv/contracts";
import { validateDraft, type DraftDocument, type DraftSection } from "./draft-document.js";

/** Ending shared by every character-ceiling sentence from `validateDraft`. */
const LENGTH_LIMIT_SUFFIX = "characters or fewer.";

/**
 * Collects the field issues for one draft.
 *
 * Purpose: inspectors read `validateDraft` paths instead of a second limit table.
 * Inputs: draft, the working document. This function does not change it.
 * Side effects: none.
 */
export function draftFieldIssues(draft: DraftDocument): ErrorIssue[] {
  // Colors that already parse are normalized on a copy. The draft strings stay as typed.
  const validity = validateDraft(draft);
  if (validity.ok) {
    // A valid draft has no field sentence to show.
    return [];
  }
  // The issue list uses paths such as `data.sections[0].title`.
  return validity.issues;
}

/**
 * Finds the index of one section id.
 *
 * Purpose: issue paths use the array index, and the inspector knows the id.
 * Inputs: sections, the draft list. sectionId, the row being edited.
 * Side effects: none. Returns -1 when the id is absent.
 */
export function sectionIndexForId(sections: readonly { id: string }[], sectionId: string): number {
  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    // The first match is the path index. A later duplicate is a separate issue.
    if (section !== undefined && section.id === sectionId) {
      return index;
    }
  }
  // The inspector only renders a row that is in the list. A miss shows no schema sentence.
  return -1;
}

/**
 * Returns the validateDraft message for one path.
 *
 * Purpose: the sentence next to a control is the schema sentence for that path.
 * Inputs: issues, the current draft issues. path, a path such as `data.sections[0].title`.
 * Side effects: none.
 */
export function issueMessageForPath(issues: readonly ErrorIssue[], path: string): string | null {
  for (const issue of issues) {
    // The first issue on this path is the one the control describes.
    if (issue.path === path) {
      return issue.message;
    }
  }
  return null;
}

/**
 * Returns the validateDraft message for one section field.
 *
 * Purpose: title, description, label, URL, and color paths share one builder.
 * Inputs: issues, the current draft issues. sectionIndex, the row index. field, the property name.
 * Side effects: none.
 */
export function issueForSectionField(
  issues: readonly ErrorIssue[],
  sectionIndex: number,
  field: string,
): string | null {
  if (sectionIndex < 0) {
    // An unknown row has no path to describe.
    return null;
  }
  // The path matches `issuesFromZodError`, including the brackets around the index.
  return issueMessageForPath(issues, `data.sections[${sectionIndex}].${field}`);
}

/**
 * Returns the validateDraft message for one image field.
 *
 * Purpose: image URL and alt text use the slide index inside the carousel.
 * Inputs: issues, the current draft issues. sectionIndex, the carousel index.
 * imageIndex, the slide index. field, `url` or `alt`.
 * Side effects: none.
 */
export function issueForImageField(
  issues: readonly ErrorIssue[],
  sectionIndex: number,
  imageIndex: number,
  field: string,
): string | null {
  if (sectionIndex < 0 || imageIndex < 0) {
    // A missing slide has no path to describe.
    return null;
  }
  // The path is the slide field, such as `data.sections[0].images[1].alt`.
  return issueMessageForPath(issues, `data.sections[${sectionIndex}].images[${imageIndex}].${field}`);
}

/**
 * Chooses the sentence shown beside one control.
 *
 * Purpose: a character ceiling uses the validateDraft sentence. Other failures keep the field's own sentence.
 * Inputs: schemaMessage, the issue on this path, or null. localMessage, the inspector sentence, or null.
 * Side effects: none.
 */
export function messageBesideField(schemaMessage: string | null, localMessage: string | null): string | null {
  if (schemaMessage !== null && schemaMessage.endsWith(LENGTH_LIMIT_SUFFIX)) {
    // Title, description, label, alt, and URL ceilings stay next to that control.
    return schemaMessage;
  }
  // A blank label, a bad color, and an unfinished URL keep the sentence that already names the field.
  return localMessage;
}

/**
 * Counts carousel images in the draft.
 *
 * Purpose: Add image can stop at the document ceiling as well as the carousel ceiling.
 * Inputs: sections, the draft list.
 * Side effects: none.
 */
export function countDraftImages(sections: readonly DraftSection[]): number {
  let total = 0;
  for (const section of sections) {
    // Text and CTA rows have no slides. Array order is the screen order.
    if (section.type === "carousel") {
      total += section.images.length;
    }
  }
  return total;
}

/**
 * Explains why Add image is unavailable.
 *
 * Purpose: the button stops at 20 slides in one carousel, then at 100 slides in the document.
 * Inputs: carouselCount, the slides already on this carousel. documentCount, the slides in every carousel.
 * Side effects: none. Returns null when another slide can be added.
 */
export function addImageLimitMessage(carouselCount: number, documentCount: number): string | null {
  if (carouselCount >= LIMITS.maxImagesPerCarousel) {
    // This carousel is full. The sentence is the same one the schema returns for a 21st slide.
    return CAROUSEL_IMAGE_LIMIT_MESSAGE;
  }
  if (documentCount >= LIMITS.maxImagesPerDocument) {
    // Other carousels already hold the document ceiling. This carousel can still be under 20.
    return DOCUMENT_IMAGE_LIMIT_MESSAGE;
  }
  // Another slide fits both ceilings.
  return null;
}

/**
 * Explains why the add-section controls are unavailable.
 *
 * Purpose: the buttons stop at the shared section ceiling.
 * Inputs: sectionCount, the rows already in the draft.
 * Side effects: none. Returns null when another section can be added.
 */
export function addSectionLimitMessage(sectionCount: number): string | null {
  if (sectionCount >= LIMITS.maxSections) {
    // The list is full. The sentence is the same one the schema returns for a 101st section.
    return SECTION_LIMIT_MESSAGE;
  }
  // Another section fits the ceiling.
  return null;
}
