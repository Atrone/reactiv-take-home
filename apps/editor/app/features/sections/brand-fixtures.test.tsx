// @vitest-environment happy-dom

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { createHarborDocument, createMarketDocument, type EditableDocument, type Section } from "@reactiv/contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { DraftCtaSection } from "../editor/draft-document.js";
import { draftSectionFromStored } from "../editor/draft-document.js";
import { CtaPreview } from "./cta-preview.js";
import { SectionPreview } from "./section-ui-registry.js";

/** Colors painted only when a draft color is empty or invalid. */
const INVALID_INPUT_DEFAULTS = ["#112233", "#334455", "#ffffff"] as const;

/** Slide fill in the carousel frame. It is not a text color or a button color. */
const FRAME_FILL = "#f3efe6";

/**
 * Returns the one section of a type.
 *
 * Purpose: each brand fixture has one text block, one carousel, and one button.
 * Inputs: document, a brand fixture. type, the section discriminator.
 * Side effects: none. Throws when that type is missing or repeated.
 */
function onlySection<T extends Section["type"]>(
  document: EditableDocument,
  type: T,
): Extract<Section, { type: T }> {
  // One pass keeps the screen order and counts how many blocks share this type.
  const matches = document.data.sections.filter((section) => section.type === type);
  if (matches.length !== 1) {
    throw new Error(`Expected one ${type} section.`);
  }
  const section = matches[0];
  if (section === undefined || section.type !== type) {
    throw new Error(`Expected one ${type} section.`);
  }
  // The type parameter is the discriminator this filter already required.
  return section as Extract<Section, { type: T }>;
}

/**
 * Renders one brand document through the shared preview registry.
 *
 * Purpose: harbor and market use the same components. This does not load the demo seed.
 * Inputs: document, a parsed editable document.
 * Side effects: mounts the preview list.
 */
function renderDocument(document: EditableDocument): void {
  // Stored sections become draft sections. The colors are copied, not replaced.
  const sections = document.data.sections.map((section) => draftSectionFromStored(section));
  render(
    <ol>
      {sections.map((section) => (
        <SectionPreview key={section.id} section={section} />
      ))}
    </ol>,
  );
}

/**
 * Reads preview section ids in DOM order.
 *
 * Purpose: the phone order is the document array order.
 * Inputs: none. The current document is the rendered preview.
 * Side effects: none.
 */
function renderedSectionIds(): string[] {
  // Each preview block carries its section id. The list order is the screen order.
  return [...document.querySelectorAll("[data-section-id]")].map((element) => element.getAttribute("data-section-id") ?? "");
}

/**
 * Reads one preview title.
 *
 * Purpose: the title assertion stays on that text section.
 * Inputs: sectionId, the text section id.
 * Side effects: none. Throws when the title is missing.
 */
function previewTitle(sectionId: string): HTMLElement {
  const title = document.querySelector(`[data-section-id="${sectionId}"] .preview-text-title`);
  if (!(title instanceof HTMLElement)) {
    throw new Error(`Missing title for ${sectionId}.`);
  }
  return title;
}

/**
 * Reads one preview description.
 *
 * Purpose: the description color assertion stays on that text section.
 * Inputs: sectionId, the text section id.
 * Side effects: none. Throws when the description is missing.
 */
function previewDescription(sectionId: string): HTMLElement {
  const description = document.querySelector(`[data-section-id="${sectionId}"] .preview-text-description`);
  if (!(description instanceof HTMLElement)) {
    throw new Error(`Missing description for ${sectionId}.`);
  }
  return description;
}

/**
 * Reads the preview button for one CTA.
 *
 * Purpose: color assertions stay on that section's button.
 * Inputs: sectionId, the CTA id.
 * Side effects: none. Throws when the button is missing.
 */
function previewButton(sectionId: string): HTMLButtonElement {
  const button = document.querySelector(`[data-section-id="${sectionId}"] .preview-cta-button`);
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Missing preview button for ${sectionId}.`);
  }
  return button;
}

/**
 * Reads the CSS aspect ratio of one carousel frame.
 *
 * Purpose: landscape and square come from the section, not from a second component.
 * Inputs: sectionId, the carousel id.
 * Side effects: none. Throws when the frame is missing.
 */
function frameAspectRatio(sectionId: string): string {
  const frame = document.querySelector(`[data-section-id="${sectionId}"] .carousel-frame`);
  if (!(frame instanceof HTMLElement)) {
    throw new Error(`Missing frame for ${sectionId}.`);
  }
  // The inline ratio is the stored name mapped to 16 / 9 or 1 / 1.
  return frame.style.aspectRatio;
}

/**
 * Reads image addresses in slide order.
 *
 * Purpose: the img src is the configured URL.
 * Inputs: sectionId, the carousel id.
 * Side effects: none.
 */
function imageSources(sectionId: string): string[] {
  // The first slide is eager and the later slide is lazy. Both keep the fixture URL.
  return [...document.querySelectorAll(`[data-section-id="${sectionId}"] img`)].map(
    (image) => image.getAttribute("src") ?? "",
  );
}

/**
 * Reads a painted color as lowercase #rrggbb.
 *
 * Purpose: the style attribute may store hex or rgb(), and both should match the draft color.
 * Inputs: element, the painted node. property, the CSS color property.
 * Side effects: none.
 */
function paintColor(element: HTMLElement, property: "color" | "backgroundColor"): string {
  // Drop spaces so rgb(16, 32, 48) and rgb(16,32,48) share one pattern.
  const color = element.style[property].replaceAll(" ", "").toLowerCase();
  const match = /^rgba?\((\d+),(\d+),(\d+)/.exec(color);
  if (match === null) {
    return color;
  }
  const red = match[1];
  const green = match[2];
  const blue = match[3];
  if (red === undefined || green === undefined || blue === undefined) {
    return color;
  }
  // Each channel becomes two hex digits so the result matches the normalized draft color.
  const channels = [red, green, blue].map((channel) => Number.parseInt(channel, 10).toString(16).padStart(2, "0"));
  return `#${channels.join("")}`;
}

/**
 * Reports whether the style attribute or the computed style carries a draft color.
 *
 * Purpose: a valid configured color is visible on the element, as hex or as the same rgb().
 * Inputs: element, the painted node. property, the CSS property. hex, the expected #rrggbb color.
 * Side effects: none.
 */
function styleCarriesColor(element: HTMLElement, property: "color" | "backgroundColor", hex: string): boolean {
  // The attribute is what React wrote. Computed style is what the element resolves.
  const attribute = (element.getAttribute("style") ?? "").toLowerCase().replaceAll(" ", "");
  const computedName = property === "backgroundColor" ? "background-color" : "color";
  const computed = getComputedStyle(element).getPropertyValue(computedName).toLowerCase().replaceAll(" ", "");
  if (attribute.includes(hex) || computed.includes(hex)) {
    return true;
  }
  // rgb() is the same color when the engine rewrites the hex.
  return paintColor(element, property) === hex && (attribute.length > 0 || computed.length > 0);
}

/**
 * Asserts the harbor document renders its own colors, copy, images, and order.
 *
 * Purpose: the deep-blue button and the short title come from the fixture, not from a built-in brand.
 * Inputs: none.
 * Side effects: renders the shared preview.
 */
function expectHarborToRenderItsConfiguration(): void {
  const harbor = createHarborDocument();
  const market = createMarketDocument();
  renderDocument(harbor);
  const text = onlySection(harbor, "text");
  const button = onlySection(harbor, "cta");
  const slides = onlySection(harbor, "carousel");
  const preview = previewButton(button.id);
  // The phone lists the fixture ids. The market title is not on this screen.
  expect(renderedSectionIds()).toEqual(harbor.data.sections.map((section) => section.id));
  expect(renderedSectionIds()).not.toEqual(market.data.sections.map((section) => section.id));
  expect(previewTitle(text.id).textContent).toBe("Harbor");
  expect(previewDescription(text.id).textContent).toBe("A short list from the dock.");
  expect(document.body.textContent).not.toContain("Saturday market");
  expect(preview.textContent).toBe("See the pier");
  expect(paintColor(preview, "backgroundColor")).toBe("#102030");
  expect(paintColor(preview, "backgroundColor")).not.toBe("#112233");
  expect(styleCarriesColor(preview, "backgroundColor", "#102030")).toBe(true);
  expect(paintColor(preview, "color")).toBe("#ffffff");
  expect(paintColor(previewTitle(text.id), "color")).toBe("#14324c");
  expect(paintColor(previewTitle(text.id), "color")).not.toBe("#112233");
  expect(paintColor(previewDescription(text.id), "color")).toBe("#4d6578");
  expect(paintColor(previewDescription(text.id), "color")).not.toBe("#334455");
  expect(frameAspectRatio(slides.id)).toBe("16 / 9");
  expect(imageSources(slides.id)).toEqual(["https://example.com/harbor/pier.jpg", "https://example.com/harbor/boats.jpg"]);
}

/**
 * Asserts the market document renders its own colors, copy, images, and a different order.
 *
 * Purpose: the warm button and the market title come from that fixture alone.
 * Inputs: none.
 * Side effects: renders the shared preview.
 */
function expectMarketToRenderItsConfiguration(): void {
  const harbor = createHarborDocument();
  const market = createMarketDocument();
  renderDocument(market);
  const text = onlySection(market, "text");
  const button = onlySection(market, "cta");
  const slides = onlySection(market, "carousel");
  const preview = previewButton(button.id);
  const renderedTypes = renderedSectionIds().map((id) => market.data.sections.find((section) => section.id === id)?.type);
  // The market order is button, carousel, title. Harbor is title, carousel, button.
  expect(renderedSectionIds()).toEqual(["market-button", "market-stalls", "market-sign"]);
  expect(renderedTypes).toEqual(["cta", "carousel", "text"]);
  expect(renderedTypes).not.toEqual(harbor.data.sections.map((section) => section.type));
  expect(previewTitle(text.id).textContent).toBe("Saturday market");
  expect(document.body.textContent).not.toContain("Harbor");
  expect(preview.textContent).toBe("Browse the stalls");
  expect(paintColor(preview, "backgroundColor")).toBe("#8c3a12");
  expect(paintColor(preview, "backgroundColor")).not.toBe("#102030");
  expect(paintColor(preview, "backgroundColor")).not.toBe("#112233");
  expect(styleCarriesColor(preview, "backgroundColor", "#8c3a12")).toBe(true);
  expect(paintColor(preview, "color")).toBe("#fff4e8");
  expect(paintColor(preview, "color")).not.toBe("#ffffff");
  expect(paintColor(previewTitle(text.id), "color")).toBe("#6e3014");
  expect(frameAspectRatio(slides.id)).toBe("1 / 1");
  expect(imageSources(slides.id)).toEqual(["https://example.com/market/stall.jpg", "https://example.com/market/crates.jpg"]);
  expect(imageSources(slides.id)).not.toEqual([
    "https://example.com/harbor/pier.jpg",
    "https://example.com/harbor/boats.jpg",
  ]);
}

/**
 * Asserts a valid draft button color is painted instead of the invalid-input default.
 *
 * Purpose: #102030 is a configured color, so the button must not fall back to #112233.
 * Inputs: none.
 * Side effects: renders the CTA preview twice.
 */
function expectAValidDraftColorToBeatTheDefault(): void {
  const valid: DraftCtaSection = {
    id: "valid-button",
    type: "cta",
    label: "Open",
    url: "https://example.com/harbor",
    backgroundColor: "#102030",
    labelColor: "#fff4e8",
  };
  const view = render(
    <ol>
      <CtaPreview section={valid} />
    </ol>,
  );
  const painted = previewButton(valid.id);
  // The draft color is valid, so the default background and the default label stay unused.
  expect(paintColor(painted, "backgroundColor")).toBe("#102030");
  expect(paintColor(painted, "backgroundColor")).not.toBe("#112233");
  expect(styleCarriesColor(painted, "backgroundColor", "#102030")).toBe(true);
  expect(paintColor(painted, "color")).toBe("#fff4e8");
  expect(paintColor(painted, "color")).not.toBe("#ffffff");
  view.unmount();

  const empty: DraftCtaSection = {
    id: "empty-button",
    type: "cta",
    label: "Open",
    url: "https://example.com/harbor",
    backgroundColor: "",
    labelColor: "",
  };
  render(
    <ol>
      <CtaPreview section={empty} />
    </ol>,
  );
  const fallback = previewButton(empty.id);
  // An empty color has never been valid, so the preview uses the documented defaults.
  expect(paintColor(fallback, "backgroundColor")).toBe("#112233");
  expect(paintColor(fallback, "color")).toBe("#ffffff");
}

/**
 * Finds the section component directory.
 *
 * Purpose: the hex check can run from the editor package or from the workspace root.
 * Inputs: none.
 * Side effects: none.
 */
function sectionsDirectory(): string {
  const cwd = process.cwd();
  const fromPackage = path.join(cwd, "app", "features", "sections");
  // The editor test script uses apps/editor as the working directory.
  if (existsSync(path.join(fromPackage, "cta-preview.tsx"))) {
    return fromPackage;
  }
  // A workspace-root run still stores the components under apps/editor.
  return path.join(cwd, "apps", "editor", "app", "features", "sections");
}

/**
 * Lists section component sources, skipping tests and stylesheets.
 *
 * Purpose: the hex check reads the components that paint a section.
 * Inputs: none.
 * Side effects: reads those files.
 */
function sectionComponentSources(): { name: string; source: string }[] {
  const directory = sectionsDirectory();
  const sources: { name: string; source: string }[] = [];
  const entries = readdirSync(directory);
  for (const name of entries) {
    // Tests carry fixture colors. Stylesheets are checked separately for the preview rules.
    if (!name.endsWith(".ts") && !name.endsWith(".tsx")) {
      continue;
    }
    if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) {
      continue;
    }
    sources.push({
      name,
      source: readFileSync(path.join(directory, name), "utf8"),
    });
  }
  return sources;
}

/**
 * Collects #RGB and #RRGGBB literals in source order.
 *
 * Purpose: a merchant color written into a component is visible to the hex check.
 * Inputs: source, the file text.
 * Side effects: none.
 */
function hexLiterals(source: string): string[] {
  // Six digits are tried first so #112233 is not also recorded as #112.
  const found = source.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) ?? [];
  return found.map((color) => color.toLowerCase());
}

/**
 * Sorts the unique colors from one file.
 *
 * Purpose: repeated mentions of one default count once.
 * Inputs: colors, the literals in source order.
 * Side effects: none.
 */
function uniqueSorted(colors: readonly string[]): string[] {
  // A set drops repeats. Sort makes the expected list order stable.
  return [...new Set(colors)].sort();
}

/**
 * Returns the colors a section file is allowed to contain.
 *
 * Purpose: text and button files may mention the invalid-input defaults. The carousel frame has its own fill.
 * Inputs: fileName, the component file name.
 * Side effects: none.
 */
function allowedHexLiterals(fileName: string): string[] {
  if (fileName === "carousel-preview.tsx") {
    // The frame fill is not a draft color and is not one of the three defaults.
    return [FRAME_FILL];
  }
  // Every other section component may mention only the invalid-input defaults.
  return [...INVALID_INPUT_DEFAULTS].sort();
}

/**
 * Reads the body of one CSS rule.
 *
 * Purpose: the preview button and title rules must not paint a merchant color.
 * Inputs: css, the stylesheet. selector, the exact selector that opens the rule.
 * Side effects: none. Throws when the rule is missing.
 */
function cssRuleBody(css: string, selector: string): string {
  // Escape the class dot so the selector is literal.
  const pattern = new RegExp(`${selector.replaceAll(".", "\\.")}\\s*\\{([^}]*)\\}`);
  const match = pattern.exec(css);
  const body = match?.[1];
  if (body === undefined) {
    throw new Error(`Missing CSS rule ${selector}.`);
  }
  return body;
}

/**
 * Asserts section components do not replace a valid draft color with a built-in brand.
 *
 * Purpose: the only hex literals are the invalid-input defaults, plus the carousel frame fill.
 * Inputs: none.
 * Side effects: reads the section component sources and two stylesheets.
 */
function expectSectionComponentsToKeepDraftColors(): void {
  const files = sectionComponentSources();
  const names = files.map((file) => file.name);
  // The preview files are present, so an empty directory cannot pass this check.
  expect(names).toContain("cta-preview.tsx");
  expect(names).toContain("text-preview.tsx");
  expect(names).toContain("carousel-preview.tsx");
  expect(names).toContain("cta-fields.ts");
  expect(names).toContain("text-contrast.ts");
  const unexpected: string[] = [];
  for (const file of files) {
    const colors = uniqueSorted(hexLiterals(file.source));
    const allowed = new Set(allowedHexLiterals(file.name));
    for (const color of colors) {
      if (!allowed.has(color)) {
        // A fixture color or a demo brand in a component is the failure this check exists to catch.
        unexpected.push(`${file.name} ${color}`);
      }
    }
  }
  expect(unexpected).toEqual([]);

  const ctaPreview = files.find((file) => file.name === "cta-preview.tsx")?.source ?? "";
  const textPreview = files.find((file) => file.name === "text-preview.tsx")?.source ?? "";
  // The button paints the hook result. The default is only the fallback argument.
  expect(ctaPreview).toContain("useLastValidColor(section.id, section.backgroundColor, DEFAULT_CTA_BACKGROUND_COLOR)");
  expect(ctaPreview).toContain("useLastValidColor(section.id, section.labelColor, DEFAULT_CTA_LABEL_COLOR)");
  expect(ctaPreview).toContain("style={{ backgroundColor, color: labelColor }}");
  expect(ctaPreview).not.toContain('backgroundColor: "#');
  expect(ctaPreview).not.toContain("backgroundColor: DEFAULT_CTA_BACKGROUND_COLOR");
  expect(textPreview).toContain("usePreviewColor(section.id, section.titleColor, DEFAULT_TEXT_TITLE_COLOR)");
  expect(textPreview).toContain("usePreviewColor(section.id, section.descriptionColor, DEFAULT_TEXT_DESCRIPTION_COLOR)");
  expect(textPreview).toContain("color: titleColor");
  expect(textPreview).toContain("color: descriptionColor");
  expect(textPreview).not.toContain('color: "#');
  expect(textPreview).not.toContain("color: DEFAULT_TEXT_TITLE_COLOR");

  const directory = sectionsDirectory();
  const ctaCss = readFileSync(path.join(directory, "cta-section.css"), "utf8");
  const textCss = readFileSync(path.join(directory, "text-section.css"), "utf8");
  // Class rules do not paint the button or the title. Those colors stay on the inline style from the draft.
  expect(cssRuleBody(ctaCss, ".preview-cta-button")).not.toMatch(/#|!important/);
  expect(cssRuleBody(textCss, ".preview-text-title")).not.toMatch(/#|!important/);
  expect(cssRuleBody(textCss, ".preview-text-description")).not.toMatch(/#|!important/);
}

/**
 * Registers the brand-fixture render tests.
 *
 * Purpose: R04 evidence is the two renders, the default-color check, and the hex-literal check.
 * Inputs: none.
 * Side effects: registers Vitest cases.
 */
function registerBrandFixtureRenderTests(): void {
  it("renders the harbor title and deep-blue button from the fixture", expectHarborToRenderItsConfiguration);
  it("renders the market title, warm button, and a different section order", expectMarketToRenderItsConfiguration);
  it("paints a valid draft button color instead of the default", expectAValidDraftColorToBeatTheDefault);
  it("keeps section-component hex literals to invalid-input defaults and the frame fill", expectSectionComponentsToKeepDraftColors);
}

afterEach(() => {
  cleanup();
});

describe("brand fixtures", registerBrandFixtureRenderTests);
