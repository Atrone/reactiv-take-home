import { describe, expect, it } from "vitest";
import type { DraftSection } from "./draft-document.js";
import {
  EMPTY_BUTTON_HINT,
  EMPTY_CAROUSEL_HINT,
  EMPTY_TEXT_HINT,
  findSelectedSection,
  sectionControlName,
  sectionHint,
  sectionLabel,
} from "./section-summary.js";

/**
 * Builds a carousel row for a hint check.
 *
 * Purpose: the hint tests can vary the slides without a configuration parse.
 * Inputs: id, the section id. alts, the alt text of each slide, in screen order.
 * Side effects: none.
 */
function carousel(id: string, alts: string[]): DraftSection {
  // Image ids only need to be distinct inside this fixture.
  return {
    id,
    type: "carousel",
    aspectRatio: "landscape",
    images: alts.map((alt, index) => ({
      id: `${id}-image-${index + 1}`,
      url: `https://example.com/${id}-${index + 1}.jpg`,
      alt,
    })),
  };
}

/**
 * Builds a text row for a hint check.
 *
 * Purpose: the title and the description can be set independently.
 * Inputs: id, the section id. title, the title string. description, the body string.
 * Side effects: none.
 */
function text(id: string, title: string, description: string): DraftSection {
  // Colors are unused by the hint. They keep the draft row complete.
  return {
    id,
    type: "text",
    title,
    description,
    titleColor: "#112233",
    descriptionColor: "#334455",
  };
}

/**
 * Builds a button row for a hint check.
 *
 * Purpose: a blank label is not a valid configuration, but it can sit in the draft.
 * Inputs: id, the section id. label, the button label.
 * Side effects: none.
 */
function button(id: string, label: string): DraftSection {
  // The URL is present so a hint that used the link would be visible in the result.
  return {
    id,
    type: "cta",
    label,
    url: "https://example.com/not-the-hint",
    backgroundColor: "#112233",
    labelColor: "#ffffff",
  };
}

/**
 * Asserts a carousel hint uses the first slide only.
 *
 * Purpose: a later slide must not stand in when the first alt is blank.
 * Inputs: none.
 * Side effects: none.
 */
function expectCarouselHintToUseTheFirstAlt(): void {
  const labeled = carousel("slides", ["First slide", "Second slide"]);
  const blankFirst = carousel("blank", ["", "Second slide"]);
  const spacedFirst = carousel("spaces", ["   ", "Second slide"]);
  const keptSpaces = carousel("kept", ["  Window  ", "Second slide"]);
  const empty = carousel("empty", []);
  // The first alt is the hint, including surrounding spaces the author typed.
  expect(sectionHint(labeled)).toBe("First slide");
  expect(sectionHint(blankFirst)).toBe("Empty carousel");
  expect(sectionHint(spacedFirst)).toBe("Empty carousel");
  expect(sectionHint(keptSpaces)).toBe("  Window  ");
  expect(sectionHint(empty)).toBe("Empty carousel");
  expect(EMPTY_CAROUSEL_HINT).toBe("Empty carousel");
  expect(sectionLabel(labeled)).toBe("Carousel");
}

/**
 * Asserts a text hint uses the title and not the description.
 *
 * Purpose: a blank or whitespace-only title falls back, and a real title is not trimmed.
 * Inputs: none.
 * Side effects: none.
 */
function expectTextHintToUseTheTitle(): void {
  const titled = text("titled", "Visible title", "Hidden description");
  const blank = text("blank", "", "Hidden description");
  const whitespace = text("whitespace", "   ", "Hidden description");
  const spaced = text("spaced", "  Kept spaces  ", "Hidden description");
  // The description is never the row hint.
  expect(sectionHint(titled)).toBe("Visible title");
  expect(sectionHint(blank)).toBe("Untitled");
  expect(sectionHint(whitespace)).toBe("Untitled");
  expect(EMPTY_TEXT_HINT).toBe("Untitled");
  expect(sectionHint(spaced)).toBe("  Kept spaces  ");
  expect(sectionLabel(titled)).toBe("Text");
}

/**
 * Asserts a button hint uses the label and not the URL.
 *
 * Purpose: a blank label is allowed on the draft while the author is typing.
 * Inputs: none.
 * Side effects: none.
 */
function expectButtonHintToUseTheLabel(): void {
  const labeled = button("shop", "Shop now");
  const blank = button("blank", "");
  const whitespace = button("whitespace", "   ");
  const spaced = button("spaced", "  Shop  ");
  // The stored type stays cta. The visible name is Button.
  expect(sectionHint(labeled)).toBe("Shop now");
  expect(sectionHint(blank)).toBe("Untitled button");
  expect(sectionHint(whitespace)).toBe("Untitled button");
  expect(EMPTY_BUTTON_HINT).toBe("Untitled button");
  expect(sectionHint(spaced)).toBe("  Shop  ");
  expect(sectionLabel(labeled)).toBe("Button");
  expect(sectionControlName("Reorder", labeled)).toBe("Reorder Button, Shop now");
}

/**
 * Asserts selection resolves to the first matching row.
 *
 * Purpose: a missing id and a null id leave the inspector empty, and a duplicate id does not skip ahead.
 * Inputs: none.
 * Side effects: none.
 */
function expectFindSelectedSectionToReturnTheFirstMatch(): void {
  const first = text("dup", "First copy", "");
  const second = text("dup", "Later copy", "");
  const other = text("other", "Other", "");
  const sections = [first, second, other];
  // Null and unknown ids select nothing. The first duplicate wins.
  expect(findSelectedSection([], null)).toBeUndefined();
  expect(findSelectedSection(sections, null)).toBeUndefined();
  expect(findSelectedSection(sections, "missing")).toBeUndefined();
  expect(findSelectedSection([], "dup")).toBeUndefined();
  expect(findSelectedSection(sections, "dup")).toBe(first);
  expect(findSelectedSection(sections, "other")).toBe(other);
}

/**
 * Registers the summary cases.
 *
 * Purpose: each case covers one hint or selection rule the shell displays.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerSummaryCases(): void {
  // Hints for each section type, and the first matching selected id.
  it("uses the first carousel alt as the hint", expectCarouselHintToUseTheFirstAlt);
  it("uses the text title as the hint", expectTextHintToUseTheTitle);
  it("uses the button label as the hint", expectButtonHintToUseTheLabel);
  it("returns the first section with the selected id", expectFindSelectedSectionToReturnTheFirstMatch);
}

describe("section summary", registerSummaryCases);
