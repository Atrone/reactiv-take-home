// @vitest-environment happy-dom

import type { JSX } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CAROUSEL_IMAGE_LIMIT_MESSAGE,
  CTA_LABEL_REQUIRED_MESSAGE,
  configurationSchema,
  editableDocumentSchema,
  LIMITS,
  SECTION_LIMIT_MESSAGE,
  SUPPORTED_SCHEMA_VERSION,
  TITLE_LIMIT_MESSAGE,
  type Configuration,
  type Section,
} from "@reactiv/contracts";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { EditorProvider, useEditorState } from "./editor-context.js";
import { EditorShell } from "./editor-shell.js";
import { jsonFileDownload } from "./json-export.js";
import { IMPORT_TOO_LARGE_MESSAGE, readPortableImport, validatePortableImport } from "./json-import.js";

/** Service id on the fixture. A portable file must not select it. */
const CONFIGURATION_ID = "cfg_import";

/** Strong validator stored for the hydrated configuration. Import must leave it in place. */
const BASE_ETAG = '"3"';

/** Title on the saved baseline. */
const BASE_TITLE = "Saved title";

/** Description on the saved baseline. */
const BASE_DESCRIPTION = "A short list.";

/** Title typed into the draft before a rejected import. */
const DRAFT_TITLE = "Draft title";

/** Title used by files that must not replace the draft. */
const REJECTED_TITLE = "Server title";

/** User-event session used by the import cases. */
type EditorUser = ReturnType<typeof userEvent.setup>;

/**
 * Reads the saved baseline title from the editor.
 *
 * Purpose: a successful import can change the draft without changing the last saved title.
 * Inputs: none. The probe reads the provider.
 * Side effects: none.
 */
function EditorProbe(): JSX.Element {
  const state = useEditorState();
  const first = state.savedBaseline?.data.sections[0];
  // The baseline title is the hydrated text. An import must not write a new baseline.
  const baselineTitle = first?.type === "text" ? first.title : "";
  return (
    <div data-testid="editor-probe">
      <span data-testid="base-etag">{state.baseEtag ?? ""}</span>
      <span data-testid="baseline-title">{baselineTitle}</span>
      <span data-testid="local-sequence">{state.localSequence}</span>
    </div>
  );
}

/**
 * Builds a text section.
 *
 * Purpose: the fixture and the imported files share one shape.
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
 * Wraps fixture sections in a configuration.
 *
 * Purpose: the provider hydrates from the loader shape without a network call.
 * Inputs: sections, the ordered sections.
 * Side effects: none. Throws when the sections are not a valid configuration.
 */
function importConfiguration(sections: Section[]): Configuration {
  // id, revision, and updatedAt are service-owned. The portable file must leave them out.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: CONFIGURATION_ID,
    revision: 3,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Renders the shell with a fixture document and a known ETag.
 *
 * Purpose: each import case starts from the same saved baseline.
 * Inputs: sections, the ordered sections.
 * Side effects: mounts the provider, the probe, and the shell.
 */
function renderEditor(sections: Section[]): ReturnType<typeof render> {
  const configuration = importConfiguration(sections);
  // The probe reads baseEtag. The shell is the import control.
  return render(
    <EditorProvider initialConfiguration={configuration} initialEtag={BASE_ETAG}>
      <EditorProbe />
      <EditorShell title="Editor" />
    </EditorProvider>,
  );
}

/**
 * Reads the local sequence shown by the probe.
 *
 * Purpose: a rejected import does not move the sequence, and one accepted import moves it by one.
 * Inputs: none.
 * Side effects: none. Throws when the probe is missing.
 */
function localSequence(): number {
  const text = screen.getByTestId("local-sequence").textContent;
  if (text === null || text.length === 0) {
    throw new Error("Missing local sequence.");
  }
  return Number(text);
}

/**
 * Reads the preview title.
 *
 * Purpose: the phone and the inspector are checked separately.
 * Inputs: none.
 * Side effects: none. Throws when the preview title is missing.
 */
function previewTitleText(): string {
  const title = document.querySelector(".preview-text-title");
  if (!(title instanceof HTMLElement)) {
    throw new Error("Missing preview title.");
  }
  return title.textContent ?? "";
}

/**
 * Reads the preview description.
 *
 * Purpose: a restored export matches the body as well as the title.
 * Inputs: none.
 * Side effects: none. Throws when the preview description is missing.
 */
function previewDescriptionText(): string {
  const description = document.querySelector(".preview-text-description");
  if (!(description instanceof HTMLElement)) {
    throw new Error("Missing preview description.");
  }
  return description.textContent ?? "";
}

/**
 * Types a new title into the selected text section.
 *
 * Purpose: the draft differs from the saved baseline before the file is chosen.
 * Inputs: user, the user-event session. title, the replacement title.
 * Side effects: edits the title field.
 */
async function replaceTitle(user: EditorUser, title: string): Promise<void> {
  const input = screen.getByLabelText("Title");
  // Clear leaves the field empty, then the typed title is the draft the import must preserve on failure.
  await user.clear(input);
  await user.type(input, title);
}

/**
 * Chooses one import file.
 *
 * Purpose: the change handler is the same path a file dialog uses.
 * Inputs: user, the user-event session. file, the file to choose.
 * Side effects: fires the input change event.
 */
async function uploadImportFile(user: EditorUser, file: File): Promise<void> {
  const input = screen.getByLabelText("Import JSON");
  // The accessible name is Import JSON. accept is .json.
  expect(input.tagName).toBe("INPUT");
  expect(input.getAttribute("accept")).toBe(".json");
  await user.upload(input, file);
}

/**
 * Chooses a JSON file from text.
 *
 * Purpose: rejection and success cases share one upload.
 * Inputs: user, the user-event session. contents, the file text. name, the file name.
 * Side effects: fires the input change event.
 */
async function uploadImportText(user: EditorUser, contents: string, name = "home-screen.json"): Promise<void> {
  // The type is JSON. The contents are what the parser sees after the size check.
  const file = new File([contents], name, { type: "application/json" });
  await uploadImportFile(user, file);
}

/**
 * Waits until the status text is the expected sentence.
 *
 * Purpose: the file read finishes after the change event.
 * Inputs: message, the status text.
 * Side effects: none. Throws when the status does not arrive.
 */
async function expectStatus(message: string): Promise<void> {
  await waitFor(() => {
    // One status region carries the import sentence or the rejection sentence.
    const status = screen.getByRole("status");
    expect(status.textContent).toBe(message);
    // Import errors are announced. The same polite region carries a successful import sentence.
    expect(status.getAttribute("aria-live")).toBe("polite");
  });
}

/**
 * Asserts a rejected file left the typed title, the baseline, and the ETag in place.
 *
 * Purpose: validation finishes before the draft is replaced, and fetch is not called.
 * Inputs: contents, the file text. message, the expected status sentence.
 * Side effects: renders the shell, edits the title, and chooses the file.
 */
async function expectRejectedImportToKeepTheTitle(contents: string, message: string): Promise<void> {
  // A previous case in the same test is unmounted before the next known draft.
  cleanup();
  const user = userEvent.setup();
  renderEditor([textSection("copy", BASE_TITLE, BASE_DESCRIPTION)]);
  await replaceTitle(user, DRAFT_TITLE);
  const sequence = localSequence();
  await uploadImportText(user, contents);
  await expectStatus(message);
  // The typed title is still the draft. The file did not become the preview.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", DRAFT_TITLE);
  expect(previewTitleText()).toBe(DRAFT_TITLE);
  expect(localSequence()).toBe(sequence);
  expect(screen.getByTestId("base-etag").textContent).toBe(BASE_ETAG);
  expect(screen.getByTestId("baseline-title").textContent).toBe(BASE_TITLE);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(document.querySelector('a[href^="javascript:"], a[href^="data:"], a[href^="file:"]')).toBeNull();
  if (contents.includes(REJECTED_TITLE)) {
    // A file that carried another title did not paint it.
    expect(screen.queryByText(REJECTED_TITLE)).toBeNull();
  }
}

/**
 * Reads the arguments from the one download call.
 *
 * Purpose: the import uses the file Export JSON produced.
 * Inputs: download, the spy installed for this case.
 * Side effects: none. Throws when Export JSON did not call the helper once.
 */
function requireDownloadedFile(downloadSpy: MockInstance<(filename: string, contents: string) => void>): string {
  // One click writes one file.
  expect(downloadSpy).toHaveBeenCalledTimes(1);
  const call = downloadSpy.mock.calls[0];
  if (call === undefined) {
    throw new Error("Export did not call the download helper.");
  }
  return call[1];
}

let download: MockInstance<(filename: string, contents: string) => void>;
let fetchSpy: MockInstance<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;

/**
 * Replaces the download helper and watches fetch.
 *
 * Purpose: the round trip can read the exported text, and every case can see a service call.
 * Inputs: none.
 * Side effects: installs two spies.
 */
function installImportSpies(): void {
  // The helper records the file. It does not start a browser download.
  download = vi.spyOn(jsonFileDownload, "save").mockImplementation(() => {
    // The assertion reads mock.calls. This replacement does not touch the document.
  });
  // A service call would be visible on this spy. Import must not make one.
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
}

/**
 * Restores spies and unmounts the shell.
 *
 * Purpose: a later case does not keep the previous document or the previous fetch spy.
 * Inputs: none.
 * Side effects: restores mocks and unmounts React.
 */
function cleanupImportCase(): void {
  // restoreAllMocks puts the real download helper back for the next case.
  vi.restoreAllMocks();
  cleanup();
}

beforeEach(installImportSpies);
afterEach(cleanupImportCase);

/**
 * Asserts an export, a later title edit, and an import of that file.
 *
 * Purpose: the title and the preview return to the exported document, and the base ETag stays.
 * Inputs: none.
 * Side effects: renders the shell, exports, edits the title, and imports the file.
 */
async function expectAnExportedFileToRestoreTheTitle(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("copy", BASE_TITLE, BASE_DESCRIPTION)]);
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  const contents = requireDownloadedFile(download);
  const exported = editableDocumentSchema.parse(JSON.parse(contents));
  const exportedSection = exported.data.sections[0];
  if (exportedSection?.type !== "text") {
    throw new Error("Expected the exported file to start with a text section.");
  }
  // The edit happens after the export, so the file still has the baseline title.
  await replaceTitle(user, DRAFT_TITLE);
  expect(screen.getByLabelText("Title")).toHaveProperty("value", DRAFT_TITLE);
  expect(previewTitleText()).toBe(DRAFT_TITLE);
  const sequence = localSequence();
  await uploadImportText(user, contents);
  await expectStatus("Imported, not saved.");
  // The inspector and the preview both show the exported text. The sequence moved once.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", exportedSection.title);
  expect(screen.getByLabelText("Description")).toHaveProperty("value", exportedSection.description);
  expect(previewTitleText()).toBe(exportedSection.title);
  expect(previewDescriptionText()).toBe(exportedSection.description);
  expect(screen.getByText(`Id: ${exportedSection.id}`)).toBeTruthy();
  expect(localSequence()).toBe(sequence + 1);
  expect(screen.getByTestId("base-etag").textContent).toBe(BASE_ETAG);
  expect(screen.getByTestId("baseline-title").textContent).toBe(BASE_TITLE);
  expect(fetchSpy).not.toHaveBeenCalled();
  // The imported draft is valid and unsaved, so Save can write it.
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
}

/**
 * Asserts `{` and a non-JSON file leave the typed title in place.
 *
 * Purpose: a syntax error is reported and the draft is not replaced.
 * Inputs: none.
 * Side effects: renders the shell twice and chooses two bad files.
 */
async function expectInvalidJsonToKeepTheTitle(): Promise<void> {
  const files = ["{", "not json"];
  for (const contents of files) {
    // Each file starts from the typed draft, not from the previous failure.
    await expectRejectedImportToKeepTheTitle(contents, "This file is not valid JSON.");
  }
}

/**
 * Asserts an empty file leaves the typed title in place.
 *
 * Purpose: an empty file is invalid JSON, and the draft stays.
 * Inputs: none.
 * Side effects: renders the shell, edits the title, and chooses an empty file.
 */
async function expectAnEmptyFileToKeepTheTitle(): Promise<void> {
  await expectRejectedImportToKeepTheTitle("", "This file is not valid JSON.");
}

/**
 * Asserts schema version 2 leaves the typed title in place.
 *
 * Purpose: an unsupported version is named in the status text and does not change the draft.
 * Inputs: none.
 * Side effects: renders the shell, edits the title, and chooses the file.
 */
async function expectSchemaVersionTwoToKeepTheTitle(): Promise<void> {
  const contents = JSON.stringify({
    schemaVersion: 2,
    data: {
      sections: [textSection("imported-text", REJECTED_TITLE, "Should stay out")],
    },
  });
  await expectRejectedImportToKeepTheTitle(
    contents,
    "schemaVersion: Only document schema version 1 is supported. This file uses schema version 2.",
  );
}

/**
 * Asserts a repeated section id leaves the typed title in place.
 *
 * Purpose: duplicate ids are rejected by the shared schema before the draft changes.
 * Inputs: none.
 * Side effects: renders the shell, edits the title, and chooses the file.
 */
async function expectADuplicateSectionIdToKeepTheTitle(): Promise<void> {
  const section = textSection("same", REJECTED_TITLE, "Other body");
  const contents = JSON.stringify({
    schemaVersion: 1,
    data: {
      sections: [section, { ...section, description: "Again" }],
    },
  });
  await expectRejectedImportToKeepTheTitle(
    contents,
    "data.sections[1].id: Section ids must be unique in the document.",
  );
}

/**
 * Asserts a javascript URL leaves the typed title in place.
 *
 * Purpose: the shared URL rule rejects the file, and the preview does not gain that link.
 * Inputs: none.
 * Side effects: renders the shell, edits the title, and chooses the file.
 */
async function expectAJavascriptUrlToKeepTheTitle(): Promise<void> {
  const contents = JSON.stringify({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "go",
          type: "cta",
          label: "Go",
          url: "javascript:alert(1)",
          backgroundColor: "#112233",
          labelColor: "#ffffff",
        },
      ],
    },
  });
  await expectRejectedImportToKeepTheTitle(contents, "data.sections[0].url: Use an absolute HTTP(S) URL.");
}

/**
 * Asserts a valid file still imports after a rejected file.
 *
 * Purpose: the failure does not disable the control, and the later file replaces the draft once.
 * Inputs: none.
 * Side effects: renders the shell, chooses a bad file, then chooses a valid file.
 */
async function expectAValidFileToImportAfterAFailure(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("copy", BASE_TITLE, BASE_DESCRIPTION)]);
  await replaceTitle(user, DRAFT_TITLE);
  const input = screen.getByLabelText("Import JSON");
  await uploadImportText(user, "{");
  await expectStatus("This file is not valid JSON.");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", DRAFT_TITLE);
  // The control is cleared so the next choice is a new change.
  expect(input).toHaveProperty("value", "");
  const sequence = localSequence();
  const contents = JSON.stringify({
    schemaVersion: 1,
    data: {
      sections: [textSection("imported-text", "Imported title", "Imported body")],
    },
  });
  await uploadImportText(user, contents);
  await expectStatus("Imported, not saved.");
  // The second file is the draft. The first failure did not call the service.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Imported title");
  expect(previewTitleText()).toBe("Imported title");
  expect(previewDescriptionText()).toBe("Imported body");
  expect(screen.getByText("Id: imported-text")).toBeTruthy();
  expect(localSequence()).toBe(sequence + 1);
  expect(screen.getByTestId("base-etag").textContent).toBe(BASE_ETAG);
  expect(screen.getByTestId("baseline-title").textContent).toBe(BASE_TITLE);
  expect(fetchSpy).not.toHaveBeenCalled();
}

/**
 * Asserts a file above 256 KiB leaves the typed title in place.
 *
 * Purpose: the size check is reported, and the bytes are not parsed as JSON.
 * Inputs: none.
 * Side effects: renders the shell, edits the title, and chooses the large file.
 */
async function expectAnOversizedFileToKeepTheTitle(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("copy", BASE_TITLE, BASE_DESCRIPTION)]);
  await replaceTitle(user, DRAFT_TITLE);
  const sequence = localSequence();
  // These bytes are not JSON. A read would report invalid JSON instead of the size sentence.
  const file = new File([new Uint8Array(LIMITS.maxPayloadBytes + 1)], "big.json", { type: "application/json" });
  expect(file.size).toBe(LIMITS.maxPayloadBytes + 1);
  await uploadImportFile(user, file);
  await expectStatus("This file is larger than 256 KiB.");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", DRAFT_TITLE);
  expect(previewTitleText()).toBe(DRAFT_TITLE);
  expect(localSequence()).toBe(sequence);
  expect(screen.getByTestId("base-etag").textContent).toBe(BASE_ETAG);
  expect(fetchSpy).not.toHaveBeenCalled();
}

/**
 * Asserts an unreadable file leaves the typed title in place.
 *
 * Purpose: a read error is a useful sentence, and the draft stays.
 * Inputs: none.
 * Side effects: renders the shell, edits the title, and chooses a file whose read fails.
 */
async function expectAnUnreadableFileToKeepTheTitle(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("copy", BASE_TITLE, BASE_DESCRIPTION)]);
  await replaceTitle(user, DRAFT_TITLE);
  const sequence = localSequence();
  // The file is small enough to pass the size check. The read itself fails.
  vi.spyOn(File.prototype, "text").mockRejectedValue(new Error("denied"));
  await uploadImportText(user, "{\"schemaVersion\":1}");
  await expectStatus("This file could not be read.");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", DRAFT_TITLE);
  expect(previewTitleText()).toBe(DRAFT_TITLE);
  expect(localSequence()).toBe(sequence);
  expect(screen.getByTestId("base-etag").textContent).toBe(BASE_ETAG);
  expect(fetchSpy).not.toHaveBeenCalled();
}

/**
 * Asserts parseable documents with schema errors leave the typed title in place.
 *
 * Purpose: missing fields, unsupported types, bad colors, bad URLs, and service keys are rejected first.
 * Inputs: none.
 * Side effects: renders the shell once per file and chooses that file.
 */
async function expectSemanticRejectionsToKeepTheTitle(): Promise<void> {
  const text = textSection("copy", REJECTED_TITLE, "Other body");
  const cases = [
    {
      contents: JSON.stringify({ schemaVersion: 1, data: {} }),
      message: "data.sections: Invalid input: expected array, received undefined",
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: {
          sections: [
            {
              id: "copy",
              title: REJECTED_TITLE,
              description: "",
              titleColor: "#112233",
              descriptionColor: "#334455",
            },
          ],
        },
      }),
      message: "data.sections[0].type: Invalid discriminator value. Expected 'carousel' | 'text' | 'cta'",
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: {
          sections: [{ ...text, type: "quiz" }],
        },
      }),
      message: "data.sections[0].type: Invalid discriminator value. Expected 'carousel' | 'text' | 'cta'",
    },
    {
      contents: JSON.stringify({
        schemaVersion: 0,
        data: { sections: [text] },
      }),
      message: "schemaVersion: Only document schema version 1 is supported. This file uses schema version 0.",
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: { sections: [{ ...text, titleColor: "#12" }] },
      }),
      message: "data.sections[0].titleColor: Use a #RGB or #RRGGBB color.",
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: { sections: [{ ...text, titleColor: "#GGGGGG" }] },
      }),
      message: "data.sections[0].titleColor: Use a #RGB or #RRGGBB color.",
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: {
          sections: [
            {
              id: "slides",
              type: "carousel",
              aspectRatio: "square",
              images: [
                { id: "same", url: "https://example.com/a.png", alt: "One" },
                { id: "same", url: "https://example.com/b.png", alt: "Two" },
              ],
            },
          ],
        },
      }),
      message: "data.sections[0].images[1].id: Image ids must be unique within a carousel.",
    },
    {
      contents: JSON.stringify({
        id: "cfg_other",
        revision: 9,
        updatedAt: "2026-10-13T12:00:00.000Z",
        schemaVersion: 1,
        data: { sections: [text] },
      }),
      message: "id, revision, updatedAt: The portable file must contain only schemaVersion and data.",
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: {
          sections: [
            {
              id: "go",
              type: "cta",
              label: "Go",
              url: "data:text/html,hi",
              backgroundColor: "#112233",
              labelColor: "#ffffff",
            },
          ],
        },
      }),
      message: "data.sections[0].url: Use an absolute HTTP(S) URL.",
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: {
          sections: [
            {
              id: "go",
              type: "cta",
              label: "Go",
              url: "file:///tmp/a",
              backgroundColor: "#112233",
              labelColor: "#ffffff",
            },
          ],
        },
      }),
      message: "data.sections[0].url: Use an absolute HTTP(S) URL.",
    },
  ];
  for (const rejected of cases) {
    // Each file is a new draft. A previous rejection cannot leak into the next title.
    await expectRejectedImportToKeepTheTitle(rejected.contents, rejected.message);
  }
}

/**
 * Asserts shorthand and six-digit colors import, and the previous ETag stays.
 *
 * Purpose: `#123` and `#12ABEF` use the shared color rule, and the service is not called.
 * Inputs: none.
 * Side effects: renders the shell, edits the title, and chooses the file.
 */
async function expectValidColorsToImportWithoutAFetch(): Promise<void> {
  const user = userEvent.setup();
  renderEditor([textSection("copy", BASE_TITLE, BASE_DESCRIPTION)]);
  await replaceTitle(user, DRAFT_TITLE);
  const sequence = localSequence();
  const contents = JSON.stringify({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "imported-text",
          type: "text",
          title: "Imported title",
          description: "Imported body",
          titleColor: "#123",
          descriptionColor: "#12ABEF",
        },
        {
          id: "imported-button",
          type: "cta",
          label: "Browse",
          url: "https://example.com/browse",
          backgroundColor: "#102030",
          labelColor: "#FFFFFF",
        },
      ],
    },
  });
  await uploadImportText(user, contents);
  await expectStatus("Imported, not saved.");
  // The text section is selected. Its colors are the stored lowercase form.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Imported title");
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", "#112233");
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", "#12abef");
  expect(previewTitleText()).toBe("Imported title");
  expect(previewDescriptionText()).toBe("Imported body");
  expect(screen.getByText("Id: imported-text")).toBeTruthy();
  expect(document.querySelectorAll(".preview-list > li")).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Select Button, Browse" }));
  // The button inspector is the imported CTA. The link is the https URL from the file.
  expect(screen.getByLabelText("Label")).toHaveProperty("value", "Browse");
  expect(screen.getByLabelText("Link")).toHaveProperty("value", "https://example.com/browse");
  expect(screen.getByText("Id: imported-button")).toBeTruthy();
  expect(localSequence()).toBe(sequence + 1);
  expect(screen.getByTestId("base-etag").textContent).toBe(BASE_ETAG);
  expect(screen.getByTestId("baseline-title").textContent).toBe(BASE_TITLE);
  expect(fetchSpy).not.toHaveBeenCalled();
}

/**
 * Asserts an oversized file does not call `text`.
 *
 * Purpose: the size branch returns before the read, even when the read would succeed.
 * Inputs: none.
 * Side effects: none. The stub records a call if the reader ignores the size.
 */
async function expectAnOversizedFileToSkipTheRead(): Promise<void> {
  let reads = 0;
  const file = new File([new Uint8Array(LIMITS.maxPayloadBytes + 1)], "big.json", { type: "application/json" });
  // A call would count even though the bytes are past the ceiling.
  Object.defineProperty(file, "text", {
    value: () => {
      reads += 1;
      return Promise.resolve("{");
    },
  });
  const plan = await readPortableImport(file);
  expect(file.size).toBeGreaterThan(LIMITS.maxPayloadBytes);
  expect(reads).toBe(0);
  expect(plan).toEqual({ ok: false, message: "This file is larger than 256 KiB." });
}

/**
 * Asserts a file of exactly 256 KiB is read.
 *
 * Purpose: the ceiling is inclusive, and the next step is the JSON parse.
 * Inputs: none.
 * Side effects: none. The stub supplies the text.
 */
async function expectAFileAtTheByteLimitToBeRead(): Promise<void> {
  let reads = 0;
  const file = new File(["{"], "edge.json", { type: "application/json" });
  // The property is the size the check uses. The stub text is what a read returns.
  Object.defineProperty(file, "size", { value: LIMITS.maxPayloadBytes });
  Object.defineProperty(file, "text", {
    value: () => {
      reads += 1;
      return Promise.resolve("{");
    },
  });
  const plan = await readPortableImport(file);
  expect(reads).toBe(1);
  expect(plan).toEqual({ ok: false, message: "This file is not valid JSON." });
}

/**
 * Asserts a failed read does not return a document.
 *
 * Purpose: an unreadable file stays on the failure path.
 * Inputs: none.
 * Side effects: none. The stub rejects.
 */
async function expectAnUnreadableFileToFailBeforeParsing(): Promise<void> {
  const file = new File(["{}"], "home-screen.json", { type: "application/json" });
  // The size is within the limit. The read is the step that fails.
  Object.defineProperty(file, "text", {
    value: () => Promise.reject(new Error("denied")),
  });
  const plan = await readPortableImport(file);
  expect(plan).toEqual({ ok: false, message: "This file could not be read." });
}

/**
 * Asserts service-owned keys are not stripped before validation.
 *
 * Purpose: a configuration record cannot become a portable document by dropping `id`.
 * Inputs: none.
 * Side effects: none.
 */
function expectServiceOwnedKeysToFailClosed(): void {
  const plan = validatePortableImport({
    id: "cfg_other",
    revision: 9,
    updatedAt: "2026-10-13T12:00:00.000Z",
    schemaVersion: 1,
    data: {
      sections: [textSection("copy", REJECTED_TITLE, "Other body")],
    },
  });
  // The plan has no document. The sentence names the portable keys.
  expect(plan.ok).toBe(false);
  if (plan.ok) {
    return;
  }
  expect(plan.message).toBe("id, revision, updatedAt: The portable file must contain only schemaVersion and data.");
}

/**
 * Builds a portable file with one text section per index.
 *
 * Purpose: one past the section ceiling is rejected before the draft changes.
 * Inputs: count, how many text sections to include.
 * Side effects: none.
 */
function importDocumentWithSectionCount(count: number): string {
  const sections = [];
  for (let index = 0; index < count; index += 1) {
    // Each row is otherwise valid. The file title is not the typed draft title.
    sections.push(textSection(`text-${index}`, "T", ""));
  }
  return JSON.stringify({
    schemaVersion: 1,
    data: { sections },
  });
}

/**
 * Builds a portable carousel with one slide per index.
 *
 * Purpose: one past the carousel ceiling is rejected before the draft changes.
 * Inputs: count, how many slides to include.
 * Side effects: none.
 */
function importDocumentWithImageCount(count: number): string {
  const images = [];
  for (let index = 0; index < count; index += 1) {
    // The address is short and absolute. The failure is the slide count.
    images.push({
      id: `img-${index}`,
      url: "https://example.com/slide.jpg",
      alt: "",
    });
  }
  return JSON.stringify({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "slides",
          type: "carousel",
          aspectRatio: "square",
          images,
        },
      ],
    },
  });
}

/**
 * Asserts limit failures leave the typed title in place.
 *
 * Purpose: section count, image count, title length, a blank CTA label, and a file one byte over 256 KiB do not replace the draft.
 * The oversized file is not read.
 * Inputs: none.
 * Side effects: renders the shell and chooses each file.
 */
async function expectLimitViolationsToKeepTheDraft(): Promise<void> {
  const longTitle = "T".repeat(LIMITS.maxTitleCharacters + 1);
  const cases = [
    {
      contents: importDocumentWithSectionCount(LIMITS.maxSections + 1),
      message: `data.sections: ${SECTION_LIMIT_MESSAGE}`,
    },
    {
      contents: importDocumentWithImageCount(LIMITS.maxImagesPerCarousel + 1),
      message: `data.sections[0].images: ${CAROUSEL_IMAGE_LIMIT_MESSAGE}`,
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: { sections: [textSection("copy", longTitle, "Other body")] },
      }),
      message: `data.sections[0].title: ${TITLE_LIMIT_MESSAGE}`,
    },
    {
      contents: JSON.stringify({
        schemaVersion: 1,
        data: {
          sections: [
            {
              id: "go",
              type: "cta",
              label: "   ",
              url: "https://example.com/go",
              backgroundColor: "#112233",
              labelColor: "#ffffff",
            },
          ],
        },
      }),
      message: `data.sections[0].label: ${CTA_LABEL_REQUIRED_MESSAGE}`,
    },
  ];
  for (const item of cases) {
    // Each file is parsed and rejected. The typed title stays.
    await expectRejectedImportToKeepTheTitle(item.contents, item.message);
  }
  cleanup();
  const user = userEvent.setup();
  renderEditor([textSection("copy", BASE_TITLE, BASE_DESCRIPTION)]);
  await replaceTitle(user, DRAFT_TITLE);
  const sequence = localSequence();
  // These bytes are not JSON. A read would report invalid JSON instead of the size sentence.
  const read = vi.spyOn(File.prototype, "text");
  const file = new File([new Uint8Array(LIMITS.maxPayloadBytes + 1)], "big.json", { type: "application/json" });
  expect(file.size).toBe(LIMITS.maxPayloadBytes + 1);
  await uploadImportFile(user, file);
  await expectStatus(IMPORT_TOO_LARGE_MESSAGE);
  // The size check returned before File.text. The typed title is still the draft.
  expect(read).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", DRAFT_TITLE);
  expect(previewTitleText()).toBe(DRAFT_TITLE);
  expect(localSequence()).toBe(sequence);
  expect(fetchSpy).not.toHaveBeenCalled();
}

/**
 * Registers the import cases.
 *
 * Purpose: each case covers one behavior from the JSON import prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerImportCases(): void {
  // Round trip, syntax failures, schema failures, retry, size, and the untouched ETag.
  it("restores an exported title and preview without calling fetch or changing the base ETag", expectAnExportedFileToRestoreTheTitle);
  it("keeps the title when the file is not valid JSON", expectInvalidJsonToKeepTheTitle);
  it("keeps the title when the file is empty", expectAnEmptyFileToKeepTheTitle);
  it("keeps the title when the schema version is 2 and names that version", expectSchemaVersionTwoToKeepTheTitle);
  it("keeps the title when a section id is duplicated", expectADuplicateSectionIdToKeepTheTitle);
  it("keeps the title when a URL uses the javascript scheme", expectAJavascriptUrlToKeepTheTitle);
  it("imports a valid file after a rejected file", expectAValidFileToImportAfterAFailure);
  it("keeps the title when the file is larger than 256 KiB", expectAnOversizedFileToKeepTheTitle);
  it("keeps the title when the file cannot be read", expectAnUnreadableFileToKeepTheTitle);
  it("keeps the title when the JSON fails the shared schema", expectSemanticRejectionsToKeepTheTitle);
  it("imports shorthand and six-digit colors without calling fetch", expectValidColorsToImportWithoutAFetch);
  it("does not read a file larger than 256 KiB", expectAnOversizedFileToSkipTheRead);
  it("keeps the draft one past each import limit", expectLimitViolationsToKeepTheDraft);
  it("reads a file of exactly 256 KiB before parsing", expectAFileAtTheByteLimitToBeRead);
  it("reports an unreadable file before parsing", expectAnUnreadableFileToFailBeforeParsing);
  it("rejects id, revision, and updatedAt without stripping them", expectServiceOwnedKeysToFailClosed);
}

describe("json import", registerImportCases);
