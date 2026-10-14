import { editableDocumentSchema } from "./document.js";
import type { EditableDocument, Image, Section } from "./document.js";
import { createStableId } from "./ids.js";
import { SUPPORTED_SCHEMA_VERSION } from "./versions.js";

type DemoImageSpec = {
  url: string;
  alt: string;
};

type DemoCarouselSpec = {
  aspectRatio: "portrait" | "landscape" | "square";
  images: readonly [DemoImageSpec, DemoImageSpec];
};

type DemoTextSpec = {
  title: string;
  description: string;
  titleColor: string;
  descriptionColor: string;
};

type DemoCtaSpec = {
  label: string;
  url: string;
  backgroundColor: string;
  labelColor: string;
};

/** First carousel: landscape, two slides on example.com. */
const FIRST_CAROUSEL: DemoCarouselSpec = {
  aspectRatio: "landscape",
  images: [
    {
      url: "https://example.com/demo/arrival-window.jpg",
      alt: "Shop window with a new arrival display",
    },
    {
      url: "https://example.com/demo/reading-table.jpg",
      alt: "Front table stacked with featured books",
    },
  ],
};

/** First text block. Colors match the text-section defaults; the copy does not. */
const FIRST_TEXT: DemoTextSpec = {
  title: "New this week",
  description: "A short list from the front table.",
  titleColor: "#112233",
  descriptionColor: "#334455",
};

/** First CTA. The label matches the button default. The link and background do not. */
const FIRST_CTA: DemoCtaSpec = {
  label: "Continue",
  url: "https://example.com/continue",
  backgroundColor: "#243044",
  labelColor: "#ffffff",
};

/** Second carousel: portrait, with different URLs and alt text from the first. */
const SECOND_CAROUSEL: DemoCarouselSpec = {
  aspectRatio: "portrait",
  images: [
    {
      url: "https://example.com/demo/staff-stack.jpg",
      alt: "Staff picks stacked on a wooden counter",
    },
    {
      url: "https://example.com/demo/quiet-corner.jpg",
      alt: "Chair in a quiet corner of the shop",
    },
  ],
};

/** Second text block. Title, description, and both colors differ from the first text block. */
const SECOND_TEXT: DemoTextSpec = {
  title: "From the floor",
  description: "Notes from the people who unpack the boxes.",
  titleColor: "#3d2b1f",
  descriptionColor: "#5c6b73",
};

/** Second CTA. Label, link, and both colors differ from the first CTA. */
const SECOND_CTA: DemoCtaSpec = {
  label: "See the list",
  url: "https://example.com/list",
  backgroundColor: "#1f4d3a",
  labelColor: "#f7f3ea",
};

/**
 * Builds one demo slide.
 *
 * Purpose: give a fixture image its own id while keeping the URL and alt from the spec.
 * Inputs: generateId, the id source. spec, the URL and alt text.
 * Side effects: calls generateId once.
 */
function createDemoImage(generateId: () => string, spec: DemoImageSpec): Image {
  // One id for this slide. The array index is not the id.
  const id = createStableId(generateId);
  return {
    id,
    url: spec.url,
    alt: spec.alt,
  };
}

/**
 * Builds one demo carousel.
 *
 * Purpose: two slides with distinct URLs, issued after the section id.
 * Inputs: generateId, the id source. spec, the aspect ratio and two slides.
 * Side effects: calls generateId three times: section, first slide, second slide.
 */
function createDemoCarousel(generateId: () => string, spec: DemoCarouselSpec): Section {
  // The section id is issued before either slide id.
  const id = createStableId(generateId);
  // Read both slides before issuing their ids, so a short spec fails before any image id is spent.
  const firstImage = spec.images[0];
  const secondImage = spec.images[1];
  // The tuple type already has two slides. This guard keeps a bad spec out of the schema.
  if (firstImage === undefined || secondImage === undefined) {
    throw new Error("A demo carousel needs two images.");
  }
  // Slide ids follow the section id. The positions 0 and 1 are not the ids.
  const images = [createDemoImage(generateId, firstImage), createDemoImage(generateId, secondImage)];
  return {
    id,
    type: "carousel",
    images,
    aspectRatio: spec.aspectRatio,
  };
}

/**
 * Builds one demo text section.
 *
 * Purpose: place the fixture copy on a new section id.
 * Inputs: generateId, the id source. spec, the title, description, and both colors.
 * Side effects: calls generateId once.
 */
function createDemoText(generateId: () => string, spec: DemoTextSpec): Section {
  // One id for this block. The copy comes from the spec.
  const id = createStableId(generateId);
  return {
    id,
    type: "text",
    title: spec.title,
    description: spec.description,
    titleColor: spec.titleColor,
    descriptionColor: spec.descriptionColor,
  };
}

/**
 * Builds one demo CTA.
 *
 * Purpose: place the fixture button on a new section id.
 * Inputs: generateId, the id source. spec, the label, link, and both colors.
 * Side effects: calls generateId once.
 */
function createDemoCta(generateId: () => string, spec: DemoCtaSpec): Section {
  // One id for this button. The label and link come from the spec.
  const id = createStableId(generateId);
  return {
    id,
    type: "cta",
    label: spec.label,
    url: spec.url,
    backgroundColor: spec.backgroundColor,
    labelColor: spec.labelColor,
  };
}

/**
 * Builds the demo home-screen document.
 *
 * Purpose: one serializable document for tests and the later seed. Screen order is the array order.
 * Call order for generateId is: first carousel id, its two image ids, first text id, first CTA id,
 * second carousel id, its two image ids, second text id, second CTA id. That is ten calls.
 * Inputs: generateId, the id source. A repeated section id, or a repeated image id inside one carousel, fails the schema.
 * Side effects: calls generateId ten times. No network and no database.
 */
export function createDemoDocument(generateId: () => string): EditableDocument {
  // carousel, text, CTA, carousel, text, CTA. There is no position field.
  const sections: Section[] = [
    createDemoCarousel(generateId, FIRST_CAROUSEL),
    createDemoText(generateId, FIRST_TEXT),
    createDemoCta(generateId, FIRST_CTA),
    createDemoCarousel(generateId, SECOND_CAROUSEL),
    createDemoText(generateId, SECOND_TEXT),
    createDemoCta(generateId, SECOND_CTA),
  ];
  // schemaVersion is the document format. This fixture is an EditableDocument, not a Configuration.
  const document = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: {
      sections,
    },
  };
  // Fail closed when a fixture field drifts outside schema version 1.
  return editableDocumentSchema.parse(document);
}
