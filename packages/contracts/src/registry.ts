import { ASPECT_RATIOS, sectionSchema } from "./document.js";
import type { Section } from "./document.js";
import { createStableId } from "./ids.js";

/**
 * One registry entry.
 *
 * `create` builds a valid section for an id the caller already generated.
 * `label` is the add-menu name: Carousel, Text, or Button.
 */
export type SectionRegistryEntry = {
  label: string;
  create: (id: string) => Section;
};

/**
 * CSS aspect-ratio values for the three stored names.
 *
 * The document stores portrait, landscape, or square. A later renderer reads this map.
 * A new aspect-ratio name lands in the `never` branch until this map learns a value for it.
 */
export type AspectRatioDisplay = {
  [Ratio in (typeof ASPECT_RATIOS)[number]]: Ratio extends "portrait"
    ? "3 / 4"
    : Ratio extends "landscape"
      ? "16 / 9"
      : Ratio extends "square"
        ? "1 / 1"
        : never;
};

/**
 * Builds the default carousel.
 *
 * Purpose: the add menu inserts an empty landscape carousel.
 * Inputs: id, the section id assigned by the caller.
 * Side effects: none.
 */
function createCarouselSection(id: string): Section {
  // A new image list each call, so two carousels do not share slides.
  const images: [] = [];
  // Landscape is the stored name. The CSS ratio 16 / 9 lives in the display map.
  return sectionSchema.parse({
    id,
    type: "carousel",
    images,
    aspectRatio: "landscape",
  });
}

/**
 * Builds the default text block.
 *
 * Purpose: the add menu inserts a title with an empty description and two colors.
 * Inputs: id, the section id assigned by the caller.
 * Side effects: none.
 */
function createTextSection(id: string): Section {
  // The description starts empty. Title color and description color are separate fields.
  return sectionSchema.parse({
    id,
    type: "text",
    title: "Title",
    description: "",
    titleColor: "#112233",
    descriptionColor: "#334455",
  });
}

/**
 * Builds the default CTA.
 *
 * Purpose: the add menu inserts a button. The stored discriminator stays `cta`.
 * Inputs: id, the section id assigned by the caller.
 * Side effects: none.
 */
function createCtaSection(id: string): Section {
  // Label, link, background, and label color are all present, so the section parses.
  return sectionSchema.parse({
    id,
    type: "cta",
    label: "Continue",
    url: "https://example.com",
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  });
}

/**
 * Checks that a registry covers every section type and no other key.
 *
 * Purpose: a fourth union member or a fourth key fails this parameter.
 * Inputs: registry, the carousel, text, and CTA entries.
 * Side effects: freezes the registry and each entry.
 */
function defineSectionRegistry<const T extends Record<Section["type"], SectionRegistryEntry>>(
  registry: T & Record<Exclude<keyof T, Section["type"]>, never>,
): T {
  // Own keys only. The parameter type already rejected a fourth key.
  const keys = Object.keys(registry) as (keyof T)[];
  for (const key of keys) {
    const entry = registry[key];
    // Freeze the entry so its factory cannot be replaced after import.
    Object.freeze(entry);
  }
  // Freeze the map so a fourth type cannot be attached at runtime.
  Object.freeze(registry);
  return registry;
}

/**
 * Freezes the aspect-ratio display map.
 *
 * Purpose: keep the architecture ratios on the three stored names.
 * Inputs: display, portrait, landscape, and square. A fourth key fails this parameter.
 * Side effects: freezes that object.
 */
function freezeAspectRatioDisplay(display: AspectRatioDisplay): AspectRatioDisplay {
  // Freeze the table so a caller cannot add a ratio at runtime.
  Object.freeze(display);
  return display;
}

/** Display ratios for portrait, landscape, and square. Names stay in the document. */
export const ASPECT_RATIO_DISPLAY: AspectRatioDisplay = freezeAspectRatioDisplay({
  portrait: "3 / 4",
  landscape: "16 / 9",
  square: "1 / 1",
});

/** Factories and add-menu labels for carousel, text, and CTA. */
export const sectionRegistry = defineSectionRegistry({
  carousel: {
    label: "Carousel",
    create: createCarouselSection,
  },
  text: {
    label: "Text",
    create: createTextSection,
  },
  cta: {
    label: "Button",
    create: createCtaSection,
  },
});

/**
 * Fails when a switch is missing a union member.
 *
 * Purpose: a new section type fails typecheck in the registry switch until a case handles it.
 * Inputs: value, the leftover member. The argument type is `never` when the switch is complete.
 * Side effects: throws if a value reaches here at runtime.
 */
export function assertNever(value: never): never {
  // Runtime guard for a value TypeScript already excluded.
  throw new Error(`Unexpected value: ${String(value)}`);
}

/**
 * Returns the registry entry for one section type.
 *
 * Purpose: adding a fourth union member fails this switch until the registry grows.
 * Inputs: type, the section discriminator.
 * Side effects: none.
 */
export function getSectionRegistryEntry(type: Section["type"]): SectionRegistryEntry {
  switch (type) {
    case "carousel":
      // Empty landscape carousel. The menu label is Carousel.
      return sectionRegistry.carousel;
    case "text":
      // Default title block. The menu label is Text.
      return sectionRegistry.text;
    case "cta":
      // Default button. The menu label is Button, and the stored type is cta.
      return sectionRegistry.cta;
    default:
      // `type` is `never` while the union is carousel, text, and cta. A fourth member fails here.
      return assertNever(type);
  }
}

/**
 * Builds one default section and assigns its id once.
 *
 * Purpose: the add path calls this. The factory stores the id and does not call the generator.
 * Inputs: type, the section discriminator. generateId, the id source. When omitted, createStableId calls crypto.randomUUID.
 * Side effects: calls the id source once.
 */
export function createSection(type: Section["type"], generateId?: () => string): Section {
  // The id is fixed before the factory runs. Reading the section does not call the generator.
  const id = generateId === undefined ? createStableId() : createStableId(generateId);
  // The switch selects the factory. create stores that id and does not call the generator.
  const entry = getSectionRegistryEntry(type);
  return entry.create(id);
}
