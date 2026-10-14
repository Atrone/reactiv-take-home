// @vitest-environment happy-dom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  configurationSchema,
  editableDocumentSchema,
  SUPPORTED_SCHEMA_VERSION,
  type Configuration,
  type Section,
} from "@reactiv/contracts";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { TITLE_COLOR_ERROR } from "../sections/text-contrast.js";
import { validateDraft, type DraftDocument, type DraftSection } from "./draft-document.js";
import { EditorProvider } from "./editor-context.js";
import { EditorShell } from "./editor-shell.js";
import { jsonFileDownload } from "./json-export.js";

/** Service id on the fixture. It must not appear in the exported file. */
const CONFIGURATION_ID = "cfg_export";

/** Title typed into the draft and expected in the file. */
const UNSAVED_TITLE = "Café evening";

/** Shorthand color typed into the draft. The file stores the six-digit form. */
const TYPED_TITLE_COLOR = "#AbC";

/** Six-digit form of `#AbC`. */
const NORMALIZED_TITLE_COLOR = "#aabbcc";

/**
 * Records an export without starting a browser download.
 *
 * Purpose: the spy keeps the filename and the file text for the assertion.
 * Inputs: none. The spy stores the arguments.
 * Side effects: none.
 */
function recordExportWithoutDownloading(): void {
  // The assertion reads mock.calls. This replacement does not touch the document.
}

/**
 * Builds a text section.
 *
 * Purpose: fixtures can choose a title and both colors.
 * Inputs: id, the section id. title, the title string. description, the body string.
 * titleColor and descriptionColor, schema hex colors.
 * Side effects: none.
 */
function textSection(
  id: string,
  title: string,
  description: string,
  titleColor = "#112233",
  descriptionColor = "#334455",
): Section {
  // The colors are valid so the configuration schema can hydrate the provider.
  return {
    id,
    type: "text",
    title,
    description,
    titleColor,
    descriptionColor,
  };
}

/**
 * Builds a carousel section.
 *
 * Purpose: the export fixture can carry image URLs and an aspect ratio.
 * Inputs: id, the section id.
 * Side effects: none.
 */
function carouselSection(id: string): Section {
  // Two slides keep their own URLs. The ratio is landscape.
  return {
    id,
    type: "carousel",
    aspectRatio: "landscape",
    images: [
      { id: `${id}-1`, url: "https://example.com/arrival.jpg", alt: "Arrival window" },
      { id: `${id}-2`, url: "https://example.com/table.jpg", alt: "Front table" },
    ],
  };
}

/**
 * Builds a button section.
 *
 * Purpose: the export fixture can carry a link and both button colors.
 * Inputs: id, the section id.
 * Side effects: none.
 */
function buttonSection(id: string): Section {
  // The label, the link, and the two colors are distinct from the text section.
  return {
    id,
    type: "cta",
    label: "Continue",
    url: "https://example.com/continue",
    backgroundColor: "#243044",
    labelColor: "#ffffff",
  };
}

/**
 * Wraps fixture sections in a configuration.
 *
 * Purpose: the provider hydrates from the loader shape without a network call.
 * Inputs: sections, the ordered sections.
 * Side effects: none. Throws when the sections are not a valid configuration.
 */
function exportConfiguration(sections: Section[]): Configuration {
  // id, revision, and updatedAt are service-owned. The file must leave them out.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: CONFIGURATION_ID,
    revision: 3,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Renders the shell with a fixture document.
 *
 * Purpose: Export JSON reads the hydrated draft, including later field edits.
 * Inputs: sections, the ordered sections.
 * Side effects: mounts the provider and the shell.
 */
function renderEditor(sections: Section[]): ReturnType<typeof render> {
  const configuration = exportConfiguration(sections);
  // The provider copies the fixture into the draft once. The shell does not load it again.
  return render(
    <EditorProvider initialConfiguration={configuration} initialEtag={'"3"'}>
      <EditorShell title="Editor" />
    </EditorProvider>,
  );
}

/**
 * Builds the draft the author has on screen after editing the text section.
 *
 * Purpose: the expected file is `validateDraft` of this draft, not a second copy of the download text.
 * Inputs: sections, the fixture in screen order. title, the unsaved title. titleColor, the typed color.
 * Side effects: none.
 */
function draftAfterTextEdit(sections: readonly Section[], title: string, titleColor: string): DraftDocument {
  const draftSections: DraftSection[] = [];
  for (const section of sections) {
    if (section.type === "text") {
      // The edited title and title color replace the hydrated values. The description color stays.
      draftSections.push({
        id: section.id,
        type: "text",
        title,
        description: section.description,
        titleColor,
        descriptionColor: section.descriptionColor,
      });
      continue;
    }
    // Carousel and button rows are still the fixture. Their order is unchanged.
    draftSections.push(section);
  }
  return {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections: draftSections },
  };
}

/**
 * Reads the arguments from the one download call.
 *
 * Purpose: assertions can parse the file the helper received.
 * Inputs: download, the spy installed for this case.
 * Side effects: none. Throws when Export JSON did not call the helper once.
 */
function requireDownloadedFile(downloadSpy: MockInstance<(filename: string, contents: string) => void>): {
  filename: string;
  contents: string;
} {
  // One click writes one file. A second call would be a second download.
  expect(downloadSpy).toHaveBeenCalledTimes(1);
  const call = downloadSpy.mock.calls[0];
  if (call === undefined) {
    throw new Error("Export did not call the download helper.");
  }
  return { filename: call[0], contents: call[1] };
}

/**
 * Parses an export and returns the object.
 *
 * Purpose: key and section assertions share one parse.
 * Inputs: contents, the file text.
 * Side effects: none. Throws when the text is not JSON.
 */
function parseExport(contents: string): unknown {
  // JSON.parse is the validity check. A trailing comma or a partial file throws.
  return JSON.parse(contents) as unknown;
}

/**
 * Collects every object key in a JSON value.
 *
 * Purpose: a service field nested under `data` is still visible to the assertion.
 * Inputs: value, the parsed JSON. keys, the set that receives each key.
 * Side effects: none. Adds keys to the set.
 */
function collectKeys(value: unknown, keys: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      // Each section and each slide is walked. The array itself has no keys.
      collectKeys(item, keys);
    }
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      // The key is recorded, then the value is walked for nested keys.
      keys.add(key);
      collectKeys(nested, keys);
    }
  }
}

let download: MockInstance<(filename: string, contents: string) => void>;
let fetchSpy: MockInstance<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

/**
 * Replaces the download helper and watches fetch.
 *
 * Purpose: each case can read the file text and fail if Export JSON calls the service.
 * Inputs: none.
 * Side effects: installs two spies.
 */
function installExportSpies(): void {
  // The helper records the file. It does not start a browser download.
  download = vi.spyOn(jsonFileDownload, "save").mockImplementation(recordExportWithoutDownloading);
  // A service call would be visible on this spy. Export must not make one.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
}

/**
 * Restores spies and unmounts the shell.
 *
 * Purpose: a later case does not keep the previous download spy or the previous document.
 * Inputs: none.
 * Side effects: restores mocks and unmounts React.
 */
function cleanupExportCase(): void {
  // restoreAllMocks puts the real download helper back for the next case.
  vi.restoreAllMocks();
  cleanup();
}

beforeEach(installExportSpies);
afterEach(cleanupExportCase);

/**
 * Asserts a dirty draft exports the validated sections, including an unsaved title.
 *
 * Purpose: the file matches `validateDraft`, and the typed title and shorthand color stay in the draft.
 * Inputs: none.
 * Side effects: renders the shell, edits the text section, and clicks Export JSON.
 */
async function expectADirtyDraftToExportTheValidatedSections(): Promise<void> {
  const user = userEvent.setup();
  const sections = [textSection("copy", "Saved title", "A short list."), carouselSection("slides"), buttonSection("go")];
  renderEditor(sections);
  const title = screen.getByLabelText("Title");
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(title);
  await user.type(title, UNSAVED_TITLE);
  await user.clear(titleColor);
  await user.type(titleColor, TYPED_TITLE_COLOR);
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  const file = requireDownloadedFile(download);
  const validity = validateDraft(draftAfterTextEdit(sections, UNSAVED_TITLE, TYPED_TITLE_COLOR));
  if (!validity.ok) {
    throw new Error("Expected the edited draft to be valid.");
  }
  const expected = {
    schemaVersion: validity.document.schemaVersion,
    data: { sections: validity.document.data.sections },
  };
  // The file text is the pretty-printed validated document. Two spaces are the indent.
  expect(file.filename).toBe("home-screen.json");
  expect(file.contents).toBe(JSON.stringify(expected, null, 2));
  expect(parseExport(file.contents)).toEqual(expected);
  const exportedSections = validity.document.data.sections;
  const exportedText = exportedSections[0];
  const exportedCarousel = exportedSections[1];
  const exportedButton = exportedSections[2];
  if (exportedText?.type !== "text" || exportedCarousel?.type !== "carousel" || exportedButton?.type !== "cta") {
    throw new Error("Expected text, carousel, and button sections in that order.");
  }
  // The unsaved title is in the file. The shorthand color is the six-digit form.
  expect(exportedText.title).toBe(UNSAVED_TITLE);
  expect(exportedText.titleColor).toBe(NORMALIZED_TITLE_COLOR);
  expect(exportedCarousel.aspectRatio).toBe("landscape");
  expect(exportedCarousel.images.map((image) => image.url)).toEqual([
    "https://example.com/arrival.jpg",
    "https://example.com/table.jpg",
  ]);
  expect(exportedButton.url).toBe("https://example.com/continue");
  expect(exportedButton.backgroundColor).toBe("#243044");
  expect(exportedButton.labelColor).toBe("#ffffff");
  // The draft still shows the typed title and the shorthand color. Export did not clear them.
  expect(title).toHaveProperty("value", UNSAVED_TITLE);
  expect(titleColor).toHaveProperty("value", TYPED_TITLE_COLOR);
  // A valid dirty draft can be saved. This click only exported it.
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  expect(screen.queryByRole("status")).toBeNull();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(file.contents).not.toContain(CONFIGURATION_ID);
  expect(file.contents).not.toContain("updatedAt");
  expect(file.contents).not.toContain("tenantId");
  expect(file.contents).not.toContain("selectedSectionId");
}

/**
 * Asserts the parsed file has only the portable top-level keys.
 *
 * Purpose: service fields and editor state are not keys anywhere in the file.
 * Inputs: none.
 * Side effects: renders the shell, edits the title, and clicks Export JSON.
 */
async function expectTheExportFileToHaveOnlyPortableKeys(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("copy", "Saved title", "A short list.")]);
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, "Unsaved title");
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  const file = requireDownloadedFile(download);
  const parsed = parseExport(file.contents);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected the export to be a JSON object.");
  }
  // schemaVersion and data are the only top-level keys. Section ids stay nested under data.
  expect(Object.keys(parsed).sort()).toEqual(["data", "schemaVersion"]);
  const keys = new Set<string>();
  collectKeys(parsed, keys);
  const absent = ["revision", "updatedAt", "tenantId", "token", "selectedSectionId", "dirty", "status", "baseEtag"];
  for (const key of absent) {
    // A nested copy of a service field would still be in this set.
    expect(keys.has(key)).toBe(false);
  }
  expect(file.contents).not.toContain(CONFIGURATION_ID);
}

/**
 * Asserts an invalid color does not download and leaves the title in the draft.
 *
 * Purpose: the helper is not called, the inline color error stays, and the status message is shown.
 * Inputs: none.
 * Side effects: renders the shell, edits the title and the title color, and clicks Export JSON.
 */
async function expectAnInvalidColorToBlockTheDownload(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("copy", "Saved title", "A short list.")]);
  const title = screen.getByLabelText("Title");
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(title);
  await user.type(title, "Kept title");
  await user.clear(titleColor);
  await user.type(titleColor, "nope");
  // The inspector already names the bad color before Export JSON is clicked.
  expect(screen.getByText(TITLE_COLOR_ERROR)).toBeTruthy();
  expect(titleColor.getAttribute("aria-invalid")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  // No file is written. The typed title and the invalid color stay in the draft.
  expect(download).not.toHaveBeenCalled();
  expect(title).toHaveProperty("value", "Kept title");
  expect(titleColor).toHaveProperty("value", "nope");
  expect(screen.getByText(TITLE_COLOR_ERROR)).toBeTruthy();
  expect(titleColor.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByRole("status").textContent).toBe("Fix the highlighted fields before exporting.");
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
}

/**
 * Asserts two text sections keep their order and their own colors.
 *
 * Purpose: a shorthand edit on the first section does not repaint the second section's colors.
 * Inputs: none.
 * Side effects: renders the shell, edits the first title color, and clicks Export JSON.
 */
async function expectTwoSectionsOfTheSameTypeToKeepOrderAndColors(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([
    textSection("one", "First", "First body", "#112233", "#334455"),
    textSection("two", "Second", "Second body", "#abcdef", "#654321"),
  ]);
  const titleColor = screen.getByLabelText("Title color");
  await user.clear(titleColor);
  await user.type(titleColor, "#0f0");
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  const file = requireDownloadedFile(download);
  const parsed = parseExport(file.contents);
  const validity = editableDocumentSchema.safeParse(parsed);
  if (!validity.success) {
    throw new Error("Expected the two-section export to match the portable document.");
  }
  const exported = validity.data.data.sections;
  const first = exported[0];
  const second = exported[1];
  if (first?.type !== "text" || second?.type !== "text") {
    throw new Error("Expected two text sections.");
  }
  // Screen order is file order. Each section keeps the colors that belong to it.
  expect(exported.map((section) => section.id)).toEqual(["one", "two"]);
  expect(first.titleColor).toBe("#00ff00");
  expect(first.descriptionColor).toBe("#334455");
  expect(second.titleColor).toBe("#abcdef");
  expect(second.descriptionColor).toBe("#654321");
  expect(titleColor).toHaveProperty("value", "#0f0");
  await user.click(screen.getByRole("button", { name: "Select Text, Second" }));
  // The second section's draft color was not replaced by the first section's shorthand.
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#abcdef");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#654321");
}

/**
 * Asserts the downloaded text is valid JSON for the portable document.
 *
 * Purpose: JSON.parse succeeds and the shared schema accepts the object.
 * Inputs: none.
 * Side effects: renders the shell and clicks Export JSON.
 */
async function expectTheExportFileToBeValidJson(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("copy", "Saved title", "A short list.")]);
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  const file = requireDownloadedFile(download);
  // The text parses, and the parsed object is a schema version 1 document.
  expect(() => JSON.parse(file.contents)).not.toThrow();
  const parsed = parseExport(file.contents);
  expect(editableDocumentSchema.safeParse(parsed).success).toBe(true);
  expect(file.contents.startsWith('{\n  "schemaVersion": 1')).toBe(true);
}

/**
 * Registers the export cases.
 *
 * Purpose: each case covers one behavior from the JSON export prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerExportCases(): void {
  // A dirty draft, portable keys, a blocked invalid color, section order, and valid JSON.
  it("exports a dirty draft as the validated document, including an unsaved title", expectADirtyDraftToExportTheValidatedSections);
  it("uses only schemaVersion and data as top-level keys", expectTheExportFileToHaveOnlyPortableKeys);
  it("does not download when a color is invalid and leaves the title intact", expectAnInvalidColorToBlockTheDownload);
  it("keeps two sections of the same type in order with their own colors", expectTwoSectionsOfTheSameTypeToKeepOrderAndColors);
  it("downloads valid JSON", expectTheExportFileToBeValidJson);
}

describe("json export", registerExportCases);
