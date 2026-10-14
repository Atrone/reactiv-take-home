import { editableDocumentSchema } from "./document.js";
import type { EditableDocument, Section } from "./document.js";
import { SUPPORTED_SCHEMA_VERSION } from "./versions.js";

/**
 * Contrasting merchant documents for the same preview components.
 *
 * These fixtures are not the demo seed. `createDemoDocument` stays the seeded screen.
 * Harbor is text, a landscape carousel, then a deep-blue button.
 * Market is a warm button, a square carousel, then a different title.
 */

/**
 * Parses one brand document with the shared schema.
 *
 * Purpose: harbor and market stay valid schema version 1 documents, including normalized colors.
 * Inputs: sections, the ordered sections for one merchant screen.
 * Side effects: none.
 */
function parseBrandDocument(sections: Section[]): EditableDocument {
  // schemaVersion is the document format. This value is an editable document, not a configuration.
  const document = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: {
      sections,
    },
  };
  // Fail closed when a fixture field drifts outside schema version 1.
  return editableDocumentSchema.parse(document);
}

/**
 * Builds the harbor brand document.
 *
 * Purpose: a short title, one landscape carousel, and a deep-blue button whose colors come from this document.
 * Inputs: none. Section ids are fixed so they stay distinct from the market fixture.
 * Side effects: none.
 */
export function createHarborDocument(): EditableDocument {
  // Text, then the landscape carousel, then the button. Array order is the screen order.
  const sections: Section[] = [
    {
      id: "harbor-title",
      type: "text",
      title: "Harbor",
      description: "A short list from the dock.",
      titleColor: "#14324c",
      descriptionColor: "#4d6578",
    },
    {
      id: "harbor-slides",
      type: "carousel",
      aspectRatio: "landscape",
      images: [
        {
          id: "harbor-pier",
          url: "https://example.com/harbor/pier.jpg",
          alt: "Wooden pier in the morning",
        },
        {
          id: "harbor-boats",
          url: "https://example.com/harbor/boats.jpg",
          alt: "Boats tied along the dock",
        },
      ],
    },
    {
      id: "harbor-button",
      type: "cta",
      label: "See the pier",
      url: "https://example.com/harbor",
      backgroundColor: "#102030",
      labelColor: "#ffffff",
    },
  ];
  // The shared schema is the only check. A duplicate id or a bad color does not return a document.
  return parseBrandDocument(sections);
}

/**
 * Builds the market brand document.
 *
 * Purpose: a warm button, one square carousel, and a different title, in a different order from harbor.
 * Inputs: none. Section ids are fixed and do not overlap the harbor ids.
 * Side effects: none.
 */
export function createMarketDocument(): EditableDocument {
  // Button, then the square carousel, then the title. That order is not harbor's order.
  const sections: Section[] = [
    {
      id: "market-button",
      type: "cta",
      label: "Browse the stalls",
      url: "https://example.com/market",
      backgroundColor: "#8c3a12",
      labelColor: "#fff4e8",
    },
    {
      id: "market-stalls",
      type: "carousel",
      aspectRatio: "square",
      images: [
        {
          id: "market-fruit",
          url: "https://example.com/market/stall.jpg",
          alt: "Fruit stall under a canvas roof",
        },
        {
          id: "market-crates",
          url: "https://example.com/market/crates.jpg",
          alt: "Bread crates on the square",
        },
      ],
    },
    {
      id: "market-sign",
      type: "text",
      title: "Saturday market",
      description: "Warm fruit and bread on the square.",
      titleColor: "#6e3014",
      descriptionColor: "#a56a45",
    },
  ];
  // The same schema accepts this screen. The colors and image URLs stay the ones written above.
  return parseBrandDocument(sections);
}
