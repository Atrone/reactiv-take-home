import type { ComponentType, JSX } from "react";
import { assertNever } from "@reactiv/contracts";
import type { DraftSection } from "../editor/draft-document.js";
import { CarouselInspector } from "./carousel-inspector.js";
import { CarouselPreview } from "./carousel-preview.js";
import { CtaInspector } from "./cta-inspector.js";
import { CtaPreview } from "./cta-preview.js";
import { TextInspector } from "./text-inspector.js";
import { TextPreview } from "./text-preview.js";

/**
 * The inspector and preview for one section type.
 *
 * The components are static. The editor does not download a renderer from configuration.
 */
type SectionUiEntry<T extends DraftSection> = {
  Inspector: ComponentType<{ section: T }>;
  Preview: ComponentType<{ section: T }>;
};

/**
 * Static UI registry for carousel, text, and button.
 *
 * A fourth draft type fails this map until an inspector and a preview are added.
 */
export type SectionUiRegistry = {
  [Type in DraftSection["type"]]: SectionUiEntry<Extract<DraftSection, { type: Type }>>;
};

/**
 * Freezes the UI registry and each entry.
 *
 * Purpose: the three component pairs stay the ones this module registered.
 * Inputs: registry, carousel, text, and button entries.
 * Side effects: freezes that object and each entry.
 */
function freezeSectionUiRegistry(registry: SectionUiRegistry): SectionUiRegistry {
  // Freeze each pair so its components cannot be swapped after import.
  Object.freeze(registry.carousel);
  Object.freeze(registry.text);
  Object.freeze(registry.cta);
  // Freeze the map so a fourth type cannot be attached at runtime.
  Object.freeze(registry);
  return registry;
}

/**
 * Inspectors and previews for the three section types.
 *
 * Text edits title, description, and both colors. A button edits its label, link, and both colors.
 * A carousel edits its ratio and its image list.
 */
export const sectionUiRegistry: SectionUiRegistry = freezeSectionUiRegistry({
  carousel: {
    Inspector: CarouselInspector,
    Preview: CarouselPreview,
  },
  text: {
    Inspector: TextInspector,
    Preview: TextPreview,
  },
  cta: {
    Inspector: CtaInspector,
    Preview: CtaPreview,
  },
});

/**
 * Renders the inspector body for the selected section.
 *
 * Purpose: the shell asks the registry instead of switching on the type itself.
 * Inputs: section, the selected draft row.
 * Side effects: none until an inspector dispatches a change.
 */
export function SectionInspectorBody({ section }: { section: DraftSection }): JSX.Element {
  switch (section.type) {
    case "carousel":
      // Aspect ratio and the image list. The values come from this section only.
      return <sectionUiRegistry.carousel.Inspector section={section} />;
    case "text":
      // Title, description, and both colors. The values come from this section only.
      return <sectionUiRegistry.text.Inspector section={section} />;
    case "cta":
      // Label, link, and both colors. The stored type stays cta.
      return <sectionUiRegistry.cta.Inspector section={section} />;
    default:
      // A fourth section type fails here until the registry grows.
      return assertNever(section);
  }
}

/**
 * Renders one phone block for a draft section.
 *
 * Purpose: the phone lists the registry preview in array order.
 * Inputs: section, the draft row.
 * Side effects: none.
 */
export function SectionPreview({ section }: { section: DraftSection }): JSX.Element {
  switch (section.type) {
    case "carousel":
      // Horizontal slides for this carousel. Another carousel has its own scroller.
      return <sectionUiRegistry.carousel.Preview section={section} />;
    case "text":
      // Title and description text, with the last valid color on each.
      return <sectionUiRegistry.text.Preview section={section} />;
    case "cta":
      // The button uses the draft label and the last valid colors. Activation reveals the URL.
      return <sectionUiRegistry.cta.Preview section={section} />;
    default:
      // A fourth section type fails here until the registry grows.
      return assertNever(section);
  }
}
