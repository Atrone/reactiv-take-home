import {
  assertNever,
  editableDocumentSchema,
  issuesFromZodError,
  normalizeHexColor,
  SUPPORTED_SCHEMA_VERSION,
} from "@reactiv/contracts";
import type { EditableDocument, ErrorIssue, Section } from "@reactiv/contracts";

/**
 * One carousel image while the author is typing.
 *
 * `url` is a plain string. It may be empty or invalid until the field is valid.
 */
export type DraftImage = {
  id: string;
  url: string;
  alt: string;
};

/** Carousel fields stored on the draft. Aspect ratio stays one of the three names. */
export type DraftCarouselSection = {
  id: string;
  type: "carousel";
  images: DraftImage[];
  aspectRatio: "portrait" | "landscape" | "square";
};

/** Text fields stored on the draft. Color strings are not rewritten on each keystroke. */
export type DraftTextSection = {
  id: string;
  type: "text";
  title: string;
  description: string;
  titleColor: string;
  descriptionColor: string;
};

/** CTA fields stored on the draft. The link and both colors may be incomplete while typing. */
export type DraftCtaSection = {
  id: string;
  type: "cta";
  label: string;
  url: string;
  backgroundColor: string;
  labelColor: string;
};

/** One section in the editor draft. The discriminator is the stored `type`. */
export type DraftSection = DraftCarouselSection | DraftTextSection | DraftCtaSection;

/**
 * The editor's working document.
 *
 * It mirrors `EditableDocument`. Color and URL fields stay plain strings so an
 * in-progress value can sit in the draft. Duplicate ids and other constraints
 * are reported by `validateDraft` and are not repaired by the reducer.
 */
export type DraftDocument = {
  schemaVersion: typeof SUPPORTED_SCHEMA_VERSION;
  data: {
    sections: DraftSection[];
  };
};

/** A draft that parsed into a portable document, or the field issues that blocked it. */
export type DraftValidationResult =
  | { ok: true; document: EditableDocument }
  | { ok: false; issues: ErrorIssue[] };

/**
 * Keeps a valid color in stored form and leaves an invalid color untouched.
 *
 * Purpose: normalization happens on the validation copy, not in the draft the author is typing.
 * Inputs: value, the raw color string.
 * Side effects: none.
 */
function colorForSchema(value: string): string {
  const normalized = normalizeHexColor(value);
  // An incomplete string such as "#" stays as typed. The schema reports it.
  if (normalized === null) {
    return value;
  }
  return normalized;
}

/**
 * Copies one stored section into a draft section.
 *
 * Purpose: server and factory sections enter the draft without sharing object identity.
 * Inputs: section, a section that already passed the shared schema.
 * Side effects: none.
 */
export function draftSectionFromStored(section: Section): DraftSection {
  switch (section.type) {
    case "carousel": {
      const images: DraftImage[] = [];
      for (const image of section.images) {
        // Each slide is a new object. A later image edit does not mutate the stored section.
        images.push({
          id: image.id,
          url: image.url,
          alt: image.alt,
        });
      }
      return {
        id: section.id,
        type: "carousel",
        aspectRatio: section.aspectRatio,
        images,
      };
    }
    case "text":
      // Title and description are copied as text. Colors are already normalized on a stored section.
      return {
        id: section.id,
        type: "text",
        title: section.title,
        description: section.description,
        titleColor: section.titleColor,
        descriptionColor: section.descriptionColor,
      };
    case "cta":
      // The link and both colors are copied. The stored type stays `cta`.
      return {
        id: section.id,
        type: "cta",
        label: section.label,
        url: section.url,
        backgroundColor: section.backgroundColor,
        labelColor: section.labelColor,
      };
    default:
      // A fourth section type fails here until this copy learns a branch for it.
      return assertNever(section);
  }
}

/**
 * Copies a portable document into a draft.
 *
 * Purpose: hydrate, import, reload, and a matching save acknowledgement each get their own section objects.
 * Inputs: document, a validated editable document.
 * Side effects: none.
 */
export function draftFromEditable(document: EditableDocument): DraftDocument {
  const sections: DraftSection[] = [];
  for (const section of document.data.sections) {
    // One copy per section. The source document is left unchanged.
    sections.push(draftSectionFromStored(section));
  }
  return {
    schemaVersion: document.schemaVersion,
    data: { sections },
  };
}

/**
 * Copies one draft section and normalizes any color that already parses.
 *
 * Purpose: give the shared schema a copy so a failed or successful parse cannot write back into the draft.
 * Inputs: section, the draft section to copy.
 * Side effects: none.
 */
function sectionWithNormalizedColors(section: DraftSection): DraftSection {
  switch (section.type) {
    case "text":
      // Invalid colors stay on this copy. The schema then reports them.
      return {
        id: section.id,
        type: "text",
        title: section.title,
        description: section.description,
        titleColor: colorForSchema(section.titleColor),
        descriptionColor: colorForSchema(section.descriptionColor),
      };
    case "cta":
      // The URL is not rewritten. Only the two color fields are normalized when they parse.
      return {
        id: section.id,
        type: "cta",
        label: section.label,
        url: section.url,
        backgroundColor: colorForSchema(section.backgroundColor),
        labelColor: colorForSchema(section.labelColor),
      };
    case "carousel": {
      const images: DraftImage[] = [];
      for (const image of section.images) {
        // Image URLs stay as typed. A carousel has no color field.
        images.push({
          id: image.id,
          url: image.url,
          alt: image.alt,
        });
      }
      return {
        id: section.id,
        type: "carousel",
        aspectRatio: section.aspectRatio,
        images,
      };
    }
    default:
      // A fourth section type fails here until color normalization learns a branch for it.
      return assertNever(section);
  }
}

/**
 * Copies a draft and normalizes colors that already parse.
 *
 * Purpose: `validateDraft` can run the shared schema without changing the editor draft.
 * Inputs: draft, the working document.
 * Side effects: none.
 */
function copyWithNormalizedColors(draft: DraftDocument): DraftDocument {
  const sections: DraftSection[] = [];
  for (const section of draft.data.sections) {
    // The copy is discarded after parsing. The caller's draft is not this array.
    sections.push(sectionWithNormalizedColors(section));
  }
  return {
    schemaVersion: draft.schemaVersion,
    data: { sections },
  };
}

/**
 * Checks a draft against the shared editable-document schema.
 *
 * Purpose: Save and export can ask for a portable document, while an in-progress color stays in the draft.
 * Inputs: draft, the working document. This function does not change it.
 * Side effects: none.
 */
export function validateDraft(draft: DraftDocument): DraftValidationResult {
  // Colors that already parse become lowercase #rrggbb on the copy. Invalid strings stay for the schema to reject.
  const normalized = copyWithNormalizedColors(draft);
  const parsed = editableDocumentSchema.safeParse(normalized);
  if (!parsed.success) {
    // The issue list uses the shared path format. The draft is not repaired.
    return { ok: false, issues: issuesFromZodError(parsed.error) };
  }
  return { ok: true, document: parsed.data };
}
