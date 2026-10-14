// @vitest-environment happy-dom

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement, type JSX } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  configurationSchema,
  createDemoDocument,
  editableDocumentSchema,
  SUPPORTED_SCHEMA_VERSION,
  type Configuration,
  type EditableDocument,
  type Section,
} from "@reactiv/contracts";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Route } from "../../routes/+types/editor";
import EditorRoute, { action, loader } from "../../routes/editor.js";
import {
  createConfiguration,
  getConfiguration,
  updateConfiguration,
  type ConfigurationClientResult,
} from "../../services/configuration.server.js";
import { IMAGE_UNAVAILABLE_LABEL, IMAGE_URL_ERROR } from "../sections/carousel-fields.js";
import { IMPORTED_NOT_SAVED_MESSAGE } from "./json-import.js";
import { jsonFileDownload } from "./json-export.js";
import { SAVED_MESSAGE } from "./save-document.js";

/**
 * Replaces the private client with mocks and keeps the real error types.
 *
 * Purpose: Save can call the route action without opening a socket.
 * Inputs: none. Vitest calls this factory when the module is imported.
 * Side effects: replaces getConfiguration, updateConfiguration, and createConfiguration.
 */
async function mockConfigurationClient(): Promise<Record<string, unknown>> {
  // The real module still exports the setup error. The route's calls are spies.
  const actual = await vi.importActual<typeof import("../../services/configuration.server.js")>(
    "../../services/configuration.server.js",
  );
  return {
    ...actual,
    getConfiguration: vi.fn(),
    updateConfiguration: vi.fn(),
    createConfiguration: vi.fn(),
  };
}

vi.mock("../../services/configuration.server.js", mockConfigurationClient);

const getConfigurationMock = vi.mocked(getConfiguration);
const updateConfigurationMock = vi.mocked(updateConfiguration);
const createConfigurationMock = vi.mocked(createConfiguration);

/** The configuration id the server environment selects. */
const DEMO_CONFIGURATION_ID = "cfg_demo";

/** Title typed over the seeded first text block. */
const EDITED_TITLE = "Saved evening";

/** Title that must stay out of the editor when it is only in browser storage. */
const STORAGE_DECOY = "Stored only in the browser";

/** Multiline description that must survive export, import, save, and reload. */
const UNICODE_DESCRIPTION = "Café\n第二行\nNaïve — “quotes”";

/** Title color on the first text block of the round-trip fixture. */
const ALPHA_TITLE_COLOR = "#112233";

/** Description color on the first text block of the round-trip fixture. */
const ALPHA_DESCRIPTION_COLOR = "#334455";

/** Title color on the second text block. It is not the first block's color. */
const BETA_TITLE_COLOR = "#aa5500";

/** Description color on the second text block. */
const BETA_DESCRIPTION_COLOR = "#0055aa";

/** Image address that is valid JSON and is not loaded. */
const MISSING_IMAGE_URL = "https://example.com/missing.png";

/** The document and tag the mocked service currently stores. */
let stored: { configuration: Configuration; etag: string };

/** The action request from the latest Save, cloned before the action reads it. */
let capturedRequest: Request | undefined;

const savedTenant = process.env.DEMO_TENANT_ID;
const savedConfiguration = process.env.DEMO_CONFIGURATION_ID;

/**
 * Sets one environment variable, or deletes it when the value is undefined.
 *
 * Purpose: a test can represent a missing variable and then put the process back.
 * Inputs: name, the variable. value, the text, or undefined to delete it.
 * Side effects: writes process.env.
 */
function setEnv(name: string, value: string | undefined): void {
  // Delete and assign are how a variable is missing or present.
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

/**
 * Sets the demo scope the loader and the action read.
 *
 * Purpose: the route selects cfg_demo from the server environment.
 * Inputs: none.
 * Side effects: writes process.env.
 */
function setRouteEnv(): void {
  // The tenant is required by getDemoScope and must not be rendered.
  setEnv("DEMO_TENANT_ID", "tenant_demo");
  // The configuration id is the only id the action may send to the private client.
  setEnv("DEMO_CONFIGURATION_ID", DEMO_CONFIGURATION_ID);
}

/**
 * Restores the demo scope from before this file loaded.
 *
 * Purpose: keep one file from changing the next file.
 * Inputs: none.
 * Side effects: writes process.env.
 */
function restoreRouteEnv(): void {
  // Put back whatever this process had before the file loaded.
  setEnv("DEMO_TENANT_ID", savedTenant);
  setEnv("DEMO_CONFIGURATION_ID", savedConfiguration);
}

/**
 * Builds the seeded demo configuration.
 *
 * Purpose: the first load is the documented home screen, without a network call.
 * Inputs: none.
 * Side effects: none.
 */
function demoConfiguration(): Configuration {
  let next = 0;
  /**
   * Issues the next fixture id.
   *
   * Purpose: give the demo factory ten stable ids.
   * Inputs: none.
   * Side effects: increments the counter.
   */
  function nextId(): string {
    // The number is part of the id. It is not a screen position.
    next += 1;
    return `demo-${next}`;
  }
  // The factory returns the portable document. The configuration fields are service-owned.
  return configurationSchema.parse({
    ...createDemoDocument(nextId),
    id: DEMO_CONFIGURATION_ID,
    revision: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Wraps a portable document as a stored configuration.
 *
 * Purpose: the mocked service can return the document the action just accepted.
 * Inputs: id, the server-selected configuration id. document, the editable body. revision, the next counter.
 * Side effects: none.
 */
function configurationFromDocument(id: string, document: EditableDocument, revision: number): Configuration {
  // updatedAt is service-owned. The sections are the document the editor submitted.
  return configurationSchema.parse({
    schemaVersion: document.schemaVersion,
    data: document.data,
    id,
    revision,
    updatedAt: "2026-10-13T18:00:00.000Z",
  });
}

/**
 * Wraps fixture sections in the stored configuration.
 *
 * Purpose: a test can load a document other than the demo before the first render.
 * Inputs: sections, the ordered sections.
 * Side effects: none.
 */
function configurationWith(sections: Section[]): Configuration {
  // revision 1 matches the ETag the first Save sends.
  return configurationFromDocument(
    DEMO_CONFIGURATION_ID,
    editableDocumentSchema.parse({
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      data: { sections },
    }),
    1,
  );
}

/**
 * Loads the document the test last stored.
 *
 * Purpose: the route loader reads the mocked service instead of browser storage.
 * Inputs: id, the configuration id from the server environment.
 * Side effects: none. Throws when the id is not the demo id.
 */
async function loadStored(id: string): Promise<ConfigurationClientResult> {
  // The action and the loader must both use the server-selected id.
  if (id !== DEMO_CONFIGURATION_ID) {
    throw new Error(`Unexpected configuration id ${id}.`);
  }
  return { ok: true, configuration: stored.configuration, etag: stored.etag };
}

/**
 * Stores a conditional update and returns the new configuration.
 *
 * Purpose: a successful Save becomes the document the next loader returns.
 * Inputs: id, the configuration id. document, the editable body. etag, the If-Match tag.
 * Side effects: replaces `stored`. Throws when the id or the tag is not the one the test loaded.
 */
async function saveStored(id: string, document: EditableDocument, etag: string): Promise<ConfigurationClientResult> {
  // A mismatched id or tag is a test bug, not a silent overwrite.
  if (id !== DEMO_CONFIGURATION_ID) {
    throw new Error(`Unexpected configuration id ${id}.`);
  }
  if (etag !== stored.etag) {
    throw new Error(`Unexpected etag ${etag}.`);
  }
  const configuration = configurationFromDocument(id, document, stored.configuration.revision + 1);
  // The next loader returns this body and the new strong tag.
  stored = { configuration, etag: '"9"' };
  return { ok: true, configuration, etag: '"9"' };
}

/**
 * Installs the mocked private client.
 *
 * Purpose: each case starts from the current `stored` document and a create call that must not run.
 * Inputs: none.
 * Side effects: replaces the three mock implementations.
 */
function installClientMocks(): void {
  // GET returns the stored row. PUT replaces it. Create is not part of Save.
  getConfigurationMock.mockReset();
  updateConfigurationMock.mockReset();
  createConfigurationMock.mockReset();
  getConfigurationMock.mockImplementation(loadStored);
  updateConfigurationMock.mockImplementation(saveStored);
  createConfigurationMock.mockResolvedValue({ ok: false, kind: "internal" });
}

/**
 * Posts the captured request through the real route action.
 *
 * Purpose: the fetcher hits the app action, and the test can still read the request.
 * Inputs: args, the action arguments from the data router.
 * Side effects: stores a clone of the request, then calls the action.
 */
async function actionWithCapture(args: { request: Request }): Promise<unknown> {
  // Clone before the action reads the body so the assertion can still parse it.
  capturedRequest = args.request.clone();
  return action(args as Route.ActionArgs);
}

/**
 * Skips loader revalidation after Save.
 *
 * Purpose: the acknowledgement stays on the mounted editor. The reload case calls the loader itself.
 * Inputs: none.
 * Side effects: none.
 */
function skipRevalidation(): boolean {
  // The app route does not do this. The test separates Save from a second mount.
  return false;
}

/**
 * Renders the editor route through a data router.
 *
 * Purpose: Save uses the same fetcher path as the browser, aimed at the route action.
 * Inputs: none. The loader returns `stored`.
 * Side effects: mounts the route.
 */
async function renderApp(): Promise<void> {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: EditorRoute,
      loader,
      action: actionWithCapture,
      shouldRevalidate: skipRevalidation,
    },
  ]);
  // The stub loads `/` and then renders the editor with that loader result.
  render(createElement(Stub as (props: { initialEntries: string[] }) => JSX.Element, { initialEntries: ["/"] }));
  await screen.findByRole("heading", { name: "Editor" });
}

/**
 * Builds the loader arguments.
 *
 * Purpose: call the server loader the way the framework would.
 * Inputs: none.
 * Side effects: none.
 */
function loaderArgs(): Route.LoaderArgs {
  // The query string is not the configuration id. The loader ignores it.
  const request = new Request("http://127.0.0.1:5173/?configurationId=cfg_other");
  return { request, params: {}, context: {} } as Route.LoaderArgs;
}

/**
 * Reads a `data()` result.
 *
 * Purpose: the loader returns a wrapper. The page data is the inner object.
 * Inputs: result, the loader return value.
 * Side effects: none. Throws when the value is not a data result.
 */
function unwrapData(result: unknown): { status: number; body: Record<string, unknown> } {
  // data() returns a wrapper. A plain object would mean the status was dropped.
  if (
    typeof result !== "object" ||
    result === null ||
    !("type" in result) ||
    result.type !== "DataWithResponseInit" ||
    !("data" in result) ||
    typeof result.data !== "object" ||
    result.data === null
  ) {
    throw new Error("expected a data() result");
  }
  const init = "init" in result && typeof result.init === "object" && result.init !== null ? result.init : null;
  const status = init !== null && "status" in init && typeof init.status === "number" ? init.status : 200;
  return { status, body: result.data as Record<string, unknown> };
}

/**
 * Renders a loader payload as a fresh editor.
 *
 * Purpose: a reload hydrates from the loader result, not from the previous mounted draft.
 * Inputs: body, the unwrapped loader data.
 * Side effects: mounts the route.
 */
function renderLoaderPage(body: Record<string, unknown>): void {
  // The route copies this object into the reducer once. Browser storage is not an argument.
  const props = { loaderData: body } as Route.ComponentProps;
  render(createElement(EditorRoute, props));
}

/**
 * Reads the action body captured from Save.
 *
 * Purpose: the posted request is the editor action, with the loaded ETag and without Authorization.
 * Inputs: etag, the tag the click was supposed to send.
 * Side effects: reads the cloned request body. Throws when Save did not post.
 */
async function capturedSaveBody(etag: string): Promise<{ document: EditableDocument; baseEtag: string }> {
  if (capturedRequest === undefined) {
    throw new Error("Save did not post to the action.");
  }
  const url = new URL(capturedRequest.url);
  const headerNames = [...capturedRequest.headers.keys()].map((name) => name.toLowerCase());
  // The post stays on the app origin. The private service port and the bearer header are absent.
  expect(capturedRequest.method).toBe("POST");
  expect(url.pathname).toBe("/");
  expect(url.searchParams.getAll("index")).toContain("");
  expect(url.port).not.toBe("4001");
  expect(url.href).not.toContain(":4001");
  expect(url.pathname).not.toContain("v1");
  expect(capturedRequest.headers.get("Authorization")).toBeNull();
  expect(headerNames).not.toContain("authorization");
  const body = (await capturedRequest.json()) as { document: EditableDocument; baseEtag: string };
  expect(body.baseEtag).toBe(etag);
  return body;
}

/**
 * Finds the editor package root.
 *
 * Purpose: source checks can run from the package directory or the workspace root.
 * Inputs: none.
 * Side effects: none.
 */
function editorPackageRoot(): string {
  const cwd = process.cwd();
  // The editor test script uses apps/editor as the working directory.
  if (existsSync(path.join(cwd, "app", "routes", "editor.tsx"))) {
    return cwd;
  }
  // A workspace-root run still stores the route under apps/editor.
  return path.join(cwd, "apps", "editor");
}

/**
 * Converts a CSS color to `#rrggbb` when the DOM expanded it.
 *
 * Purpose: portrait text colors can be compared after the preview paints them.
 * Inputs: element, the painted node. property, `color`.
 * Side effects: none.
 */
function paintColor(element: HTMLElement): string {
  // Drop spaces so rgb(1, 2, 3) and rgb(1,2,3) share one pattern.
  const color = element.style.color.replaceAll(" ", "").toLowerCase();
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
  // Each channel becomes two hex digits so the result matches the document color.
  const channels = [red, green, blue].map((channel) => Number.parseInt(channel, 10).toString(16).padStart(2, "0"));
  return `#${channels.join("")}`;
}

/**
 * Reads one preview block.
 *
 * Purpose: order, color, and frame checks address a section by its id.
 * Inputs: sectionId, the draft id.
 * Side effects: none. Throws when that block is missing.
 */
function previewBlock(sectionId: string): HTMLElement {
  const block = document.querySelector(`[data-section-id="${sectionId}"]`);
  if (!(block instanceof HTMLElement)) {
    throw new Error(`Missing preview block ${sectionId}.`);
  }
  return block;
}

/**
 * Reads the preview section ids in screen order.
 *
 * Purpose: reorder checks compare the phone with the document array.
 * Inputs: none.
 * Side effects: none.
 */
function previewIds(): string[] {
  // The phone list is the draft order. Each item's attribute is the section id.
  return [...document.querySelectorAll(".preview-list [data-section-id]")].map(
    (node) => node.getAttribute("data-section-id") ?? "",
  );
}

/**
 * Reads one carousel frame's aspect ratio.
 *
 * Purpose: portrait, landscape, and square are checked on the rendered frame.
 * Inputs: sectionId, the carousel id.
 * Side effects: none. Throws when that frame is missing.
 */
function frameRatio(sectionId: string): string {
  const frame = previewBlock(sectionId).querySelector("[data-carousel-frame]");
  if (!(frame instanceof HTMLElement)) {
    throw new Error(`Missing frame for ${sectionId}.`);
  }
  return frame.style.aspectRatio;
}

/**
 * Asserts the phone matches one portable document.
 *
 * Purpose: export, import, and reload can all be compared with the same screen checks.
 * Inputs: document, the portable sections in screen order.
 * Side effects: none. Throws when a preview block is missing.
 */
function expectPreviewToMatch(document: EditableDocument): void {
  // Screen order is the section array, including ids.
  expect(previewIds()).toEqual(document.data.sections.map((section) => section.id));
  for (const section of document.data.sections) {
    const block = previewBlock(section.id);
    if (section.type === "text") {
      const title = block.querySelector(".preview-text-title");
      const description = block.querySelector(".preview-text-description");
      if (!(title instanceof HTMLElement) || !(description instanceof HTMLElement)) {
        throw new Error(`Missing text preview for ${section.id}.`);
      }
      // The copy and both colors stay on this id.
      expect(title.textContent).toBe(section.title);
      expect(description.textContent).toBe(section.description);
      expect(paintColor(title)).toBe(section.titleColor);
      expect(paintColor(description)).toBe(section.descriptionColor);
      continue;
    }
    if (section.type === "carousel") {
      const ratio = section.aspectRatio === "portrait" ? "3 / 4" : section.aspectRatio === "landscape" ? "16 / 9" : "1 / 1";
      // The frame uses the stored name's display ratio.
      expect(frameRatio(section.id)).toBe(ratio);
      expect(block.getAttribute("data-preview-hint")).toBe(section.images[0]?.alt ?? "Empty carousel");
      continue;
    }
    // The button hint is its label. The link stays off the visible name.
    expect(block.getAttribute("data-preview-hint")).toBe(section.label);
  }
}

/**
 * Builds a text section.
 *
 * Purpose: the round-trip fixture can choose both colors and a description.
 * Inputs: id, the section id. title, the title. description, the body. titleColor and descriptionColor, the hex colors.
 * Side effects: none.
 */
function textSection(
  id: string,
  title: string,
  description: string,
  titleColor: string,
  descriptionColor: string,
): Section {
  // The colors are already six-digit hex so the file and the draft match.
  return { id, type: "text", title, description, titleColor, descriptionColor };
}

/**
 * Builds a carousel section.
 *
 * Purpose: the fixture can choose a ratio and one slide.
 * Inputs: id, the section id. aspectRatio, the stored name. imageId, the slide id. url, the image address. alt, the alt text.
 * Side effects: none.
 */
function carouselSection(
  id: string,
  aspectRatio: "portrait" | "landscape" | "square",
  imageId: string,
  url: string,
  alt: string,
): Section {
  // One slide is enough to show the frame and keep the URL.
  return {
    id,
    type: "carousel",
    aspectRatio,
    images: [{ id: imageId, url, alt }],
  };
}

/**
 * Builds a button section.
 *
 * Purpose: the fixture can tell two buttons apart by label and link.
 * Inputs: id, the section id. label, the button label. url, the link. backgroundColor and labelColor, the hex colors.
 * Side effects: none.
 */
function buttonSection(
  id: string,
  label: string,
  url: string,
  backgroundColor: string,
  labelColor: string,
): Section {
  // The label is the row hint. The link is not the hint.
  return { id, type: "cta", label, url, backgroundColor, labelColor };
}

/**
 * Builds the round-trip sections before the on-screen reorder.
 *
 * Purpose: two of each type start in an order the move buttons can change.
 * Inputs: none.
 * Side effects: none.
 */
function roundTripSections(): Section[] {
  // Text alpha sits directly above text beta so one ArrowDown swaps those two ids.
  return [
    carouselSection("carousel-wide", "landscape", "wide-1", "https://example.com/wide.jpg", "Wide window"),
    textSection("text-alpha", "Alpha title", "Alpha body", ALPHA_TITLE_COLOR, ALPHA_DESCRIPTION_COLOR),
    textSection("text-beta", "Beta title", UNICODE_DESCRIPTION, BETA_TITLE_COLOR, BETA_DESCRIPTION_COLOR),
    buttonSection("cta-go", "Continue", "https://example.com/continue", "#243044", "#ffffff"),
    carouselSection("carousel-tall", "landscape", "tall-1", "https://example.com/tall.jpg", "Tall frame"),
    buttonSection("cta-list", "See the list", "https://example.com/list", "#1f4d3a", "#f7f3ea"),
  ];
}

/**
 * Asserts Save posts the edited demo title and a reload renders it.
 *
 * Purpose: success text appears only after the action resolves, and the next loader shows that title.
 * Inputs: none.
 * Side effects: renders the editor, edits the title, and clicks Save.
 */
async function expectSaveToPostTheEditedTitleAndReloadIt(): Promise<void> {
  const user = userEvent.setup();
  let releaseSave: () => void = () => {
    throw new Error("Save did not start.");
  };
  await renderApp();
  // First use is the seeded home screen. Save has nothing new to write.
  expect(screen.getAllByText("New this week").length).toBeGreaterThan(0);
  expect(screen.getAllByText("From the floor").length).toBeGreaterThan(0);
  expect(previewIds()).toHaveLength(6);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  await user.click(screen.getByRole("button", { name: "Select Text, New this week" }));
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, EDITED_TITLE);
  // The preview updates before Save. The private client has not been asked to write.
  expect(screen.getAllByText(EDITED_TITLE).length).toBeGreaterThan(0);
  expect(screen.queryByText("New this week")).toBeNull();
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  updateConfigurationMock.mockImplementation((id: string, document: EditableDocument, etag: string) => {
    return new Promise((resolve) => {
      // The click is held here until the test releases the acknowledgement.
      releaseSave = () => {
        const configuration = configurationFromDocument(id, document, stored.configuration.revision + 1);
        stored = { configuration, etag: '"9"' };
        resolve({ ok: true, configuration, etag: '"9"' });
      };
    });
  });
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    // The action has entered the private client. The screen has not said Saved yet.
    expect(updateConfigurationMock).toHaveBeenCalled();
  });
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", EDITED_TITLE);
  const submitted = updateConfigurationMock.mock.calls[0];
  expect(submitted?.[0]).toBe(DEMO_CONFIGURATION_ID);
  expect(submitted?.[2]).toBe('"1"');
  const submittedDocument = submitted?.[1];
  if (submittedDocument === undefined) {
    throw new Error("Save did not submit a document.");
  }
  expect(submittedDocument.data.sections.some((section) => section.type === "text" && section.title === EDITED_TITLE)).toBe(
    true,
  );
  const requestBody = await capturedSaveBody('"1"');
  expect(requestBody.document.data.sections.some((section) => section.type === "text" && section.title === EDITED_TITLE)).toBe(
    true,
  );
  releaseSave();
  // Saved is the polite live region, and it appears only after the acknowledgement.
  const saved = await screen.findByText(SAVED_MESSAGE);
  expect(saved.getAttribute("role")).toBe("status");
  expect(saved.getAttribute("aria-live")).toBe("polite");
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  expect(screen.getAllByText("From the floor").length).toBeGreaterThan(0);
  expect(createConfigurationMock).not.toHaveBeenCalled();
  const loaded = unwrapData(await loader(loaderArgs()));
  if (loaded.status !== 200 || !("configuration" in loaded.body)) {
    throw new Error("Expected the reload loader to return the saved configuration.");
  }
  const configuration = loaded.body.configuration as Configuration;
  expect(configuration.data.sections.some((section) => section.type === "text" && section.title === EDITED_TITLE)).toBe(true);
  expect(configuration.data.sections.some((section) => section.type === "text" && section.title === "New this week")).toBe(
    false,
  );
  cleanup();
  localStorage.setItem("editor-draft", STORAGE_DECOY);
  renderLoaderPage(loaded.body);
  // The fresh editor shows the loader title. The storage string is not a section.
  expect(screen.getAllByText(EDITED_TITLE).length).toBeGreaterThan(0);
  expect(screen.queryByText(STORAGE_DECOY)).toBeNull();
  expect(screen.queryByText("New this week")).toBeNull();
  localStorage.clear();
  cleanup();
  renderLoaderPage(loaded.body);
  expect(screen.getAllByText(EDITED_TITLE).length).toBeGreaterThan(0);
  expect(screen.queryByText("New this week")).toBeNull();
}

/**
 * Asserts the loader and the hydrate path do not read localStorage.
 *
 * Purpose: clearing browser storage cannot change the document the loader returns.
 * Inputs: none.
 * Side effects: calls the loader and renders its result twice.
 */
async function expectReloadToIgnoreLocalStorage(): Promise<void> {
  stored = {
    configuration: configurationWith([
      textSection("loader-text", "Loader title", "Loader body", ALPHA_TITLE_COLOR, ALPHA_DESCRIPTION_COLOR),
    ]),
    etag: '"1"',
  };
  const getItem = vi.spyOn(Storage.prototype, "getItem");
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const removeItem = vi.spyOn(Storage.prototype, "removeItem");
  try {
    // The loader runs with storage methods that would record a read or a write.
    const loaded = unwrapData(await loader(loaderArgs()));
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(loaded.status).toBe(200);
    const root = editorPackageRoot();
    const sources = [
      "app/routes/editor.tsx",
      "app/features/editor/editor-context.tsx",
      "app/features/editor/editor-reducer.ts",
      "app/features/editor/editor-shell.tsx",
      "app/features/editor/save-controls.tsx",
      "app/features/editor/save-document.ts",
    ];
    for (const relativePath of sources) {
      // The hydrate path is the loader payload. These modules do not mention browser storage.
      expect(readFileSync(path.join(root, relativePath), "utf8")).not.toContain("localStorage");
    }
    localStorage.setItem("editor-draft", STORAGE_DECOY);
    renderLoaderPage(loaded.body);
    expect(screen.getAllByText("Loader title").length).toBeGreaterThan(0);
    expect(screen.queryByText(STORAGE_DECOY)).toBeNull();
    localStorage.clear();
    cleanup();
    renderLoaderPage(loaded.body);
    // Clearing storage leaves the loader title on the next mount.
    expect(screen.getAllByText("Loader title").length).toBeGreaterThan(0);
    expect(screen.queryByText(STORAGE_DECOY)).toBeNull();
  } finally {
    getItem.mockRestore();
    setItem.mockRestore();
    removeItem.mockRestore();
  }
}

/**
 * Asserts the round-trip fixture survives export, import, save, and reload.
 *
 * Purpose: order, ids, portrait, unicode, and the two text colors stay on the same sections.
 * Inputs: none.
 * Side effects: renders the editor, moves a section, exports, imports, and clicks Save.
 */
async function expectTheRoundTripFixtureToSurviveSaveAndReload(): Promise<void> {
  const user = userEvent.setup();
  const downloaded: string[] = [];
  vi.spyOn(jsonFileDownload, "save").mockImplementation((_filename: string, contents: string) => {
    // Keep the file text. This replacement does not start a browser download.
    downloaded.push(contents);
  });
  stored = { configuration: configurationWith(roundTripSections()), etag: '"1"' };
  await renderApp();
  // Square is still 1 / 1, then this carousel returns to landscape before the portrait edit.
  await user.click(screen.getByRole("radio", { name: "Square" }));
  expect(frameRatio("carousel-wide")).toBe("1 / 1");
  await user.click(screen.getByRole("radio", { name: "Landscape" }));
  expect(frameRatio("carousel-wide")).toBe("16 / 9");
  await user.click(screen.getByRole("button", { name: "Select Carousel, Tall frame" }));
  await user.click(screen.getByRole("radio", { name: "Portrait" }));
  expect(frameRatio("carousel-tall")).toBe("3 / 4");
  expect(frameRatio("carousel-wide")).toBe("16 / 9");
  const reorder = screen.getByRole("button", { name: "Reorder Text, Alpha title" });
  reorder.focus();
  await user.keyboard("{ArrowDown}");
  // The two text sections passed each other. Each preview still has its own title.
  expect(previewIds()).toEqual([
    "carousel-wide",
    "text-beta",
    "text-alpha",
    "cta-go",
    "carousel-tall",
    "cta-list",
  ]);
  expect(previewBlock("text-alpha").querySelector(".preview-text-title")?.textContent).toBe("Alpha title");
  expect(previewBlock("text-beta").querySelector(".preview-text-description")?.textContent).toBe(UNICODE_DESCRIPTION);
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  const contents = downloaded[0];
  if (contents === undefined) {
    throw new Error("Export did not write a file.");
  }
  const exported = editableDocumentSchema.parse(JSON.parse(contents));
  expect(exported.data.sections.map((section) => section.id)).toEqual([
    "carousel-wide",
    "text-beta",
    "text-alpha",
    "cta-go",
    "carousel-tall",
    "cta-list",
  ]);
  expectPreviewToMatch(exported);
  await user.click(screen.getByRole("button", { name: "Select Text, Beta title" }));
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, "Temporary draft");
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Temporary draft");
  const file = new File([contents], "home-screen.json", { type: "application/json" });
  await user.upload(screen.getByLabelText("Import JSON"), file);
  await waitFor(() => {
    // The import replaced the temporary title and has not been written yet.
    expect(screen.getByRole("status").textContent).toBe(IMPORTED_NOT_SAVED_MESSAGE);
  });
  expect(screen.queryByText("Temporary draft")).toBeNull();
  expectPreviewToMatch(exported);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(SAVED_MESSAGE);
  // The import sentence lasts until the acknowledgement. Saved replaces it.
  expect(screen.queryByText(IMPORTED_NOT_SAVED_MESSAGE)).toBeNull();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  const submitted = updateConfigurationMock.mock.calls[0]?.[1];
  expect(submitted).toEqual(exported);
  expect(updateConfigurationMock).toHaveBeenCalledWith(DEMO_CONFIGURATION_ID, exported, '"1"', expect.any(String));
  const requestBody = await capturedSaveBody('"1"');
  expect(requestBody.document).toEqual(exported);
  const loaded = unwrapData(await loader(loaderArgs()));
  if (loaded.status !== 200 || !("configuration" in loaded.body)) {
    throw new Error("Expected the reload loader to return the imported document.");
  }
  const configuration = loaded.body.configuration as Configuration;
  expect(configuration.data).toEqual(exported.data);
  expect(configuration.data.sections.map((section) => section.id)).toEqual(exported.data.sections.map((section) => section.id));
  cleanup();
  localStorage.setItem("editor-draft", STORAGE_DECOY);
  localStorage.clear();
  renderLoaderPage(loaded.body);
  // The reloaded phone is the saved payload, including portrait, unicode, and both color pairs.
  expectPreviewToMatch(exported);
  expect(screen.queryByText(STORAGE_DECOY)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Select Text, Beta title" }));
  expect(screen.getByLabelText("Description")).toHaveProperty("value", UNICODE_DESCRIPTION);
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", BETA_TITLE_COLOR);
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", BETA_DESCRIPTION_COLOR);
  await user.click(screen.getByRole("button", { name: "Select Text, Alpha title" }));
  expect(screen.getByLabelText("Title color")).toHaveProperty("value", ALPHA_TITLE_COLOR);
  expect(screen.getByLabelText("Description color")).toHaveProperty("value", ALPHA_DESCRIPTION_COLOR);
  expect(createConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Asserts a 404 image still allows Export and Save.
 *
 * Purpose: a syntactically valid URL that fails to load stays in the draft and in the saved document.
 * Inputs: none.
 * Side effects: renders the editor, dispatches an image error, exports, and clicks Save.
 */
async function expectABrokenImageToExportAndSave(): Promise<void> {
  const user = userEvent.setup();
  const downloaded: string[] = [];
  vi.spyOn(jsonFileDownload, "save").mockImplementation((_filename: string, contents: string) => {
    // Keep the file text. This replacement does not start a browser download.
    downloaded.push(contents);
  });
  stored = {
    configuration: configurationWith([
      carouselSection("broken", "landscape", "missing", MISSING_IMAGE_URL, "Missing product"),
    ]),
    etag: '"1"',
  };
  await renderApp();
  const image = document.querySelector("img");
  if (!(image instanceof HTMLImageElement)) {
    throw new Error("Missing carousel image.");
  }
  fireEvent.error(image);
  const urlField = screen.getByLabelText("Image URL");
  // The placeholder replaces the icon. The typed URL is still the draft.
  expect(screen.getByText(IMAGE_UNAVAILABLE_LABEL)).toBeTruthy();
  expect(urlField).toHaveProperty("value", MISSING_IMAGE_URL);
  expect(urlField.getAttribute("aria-invalid")).not.toBe("true");
  expect(screen.queryByText(IMAGE_URL_ERROR)).toBeNull();
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true);
  const alt = screen.getByLabelText("Alt text");
  await user.clear(alt);
  await user.type(alt, "Missing product photo");
  // The failed load did not disable Save once the draft was dirty, and it did not clear the URL.
  expect(screen.getByText(IMAGE_UNAVAILABLE_LABEL)).toBeTruthy();
  expect(screen.getByLabelText("Image URL")).toHaveProperty("value", MISSING_IMAGE_URL);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "Export JSON" })).toHaveProperty("disabled", false);
  await user.click(screen.getByRole("button", { name: "Export JSON" }));
  const contents = downloaded[0];
  if (contents === undefined) {
    throw new Error("Export did not write a file.");
  }
  expect(contents).toContain(MISSING_IMAGE_URL);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(SAVED_MESSAGE);
  const submitted = updateConfigurationMock.mock.calls[0]?.[1];
  expect(submitted?.data.sections[0]).toMatchObject({
    id: "broken",
    type: "carousel",
    images: [{ id: "missing", url: MISSING_IMAGE_URL, alt: "Missing product photo" }],
  });
  expect(screen.getByLabelText("Image URL")).toHaveProperty("value", MISSING_IMAGE_URL);
  expect(screen.getByText(IMAGE_UNAVAILABLE_LABEL)).toBeTruthy();
  expect(createConfigurationMock).not.toHaveBeenCalled();
  const loaded = unwrapData(await loader(loaderArgs()));
  cleanup();
  renderLoaderPage(loaded.body);
  expect(screen.getByLabelText("Image URL")).toHaveProperty("value", MISSING_IMAGE_URL);
  const reloadedImage = document.querySelector("img");
  if (!(reloadedImage instanceof HTMLImageElement)) {
    throw new Error("Missing reloaded carousel image.");
  }
  fireEvent.error(reloadedImage);
  // A reload still has the URL, and the same address can show the placeholder again.
  expect(screen.getByText(IMAGE_UNAVAILABLE_LABEL)).toBeTruthy();
  expect(screen.getByLabelText("Image URL")).toHaveProperty("value", MISSING_IMAGE_URL);
}

/**
 * Asserts a failed save keeps the draft and does not say Saved.
 *
 * Purpose: the acknowledgement is the only success path. A service failure leaves the typed title in place.
 * Inputs: none.
 * Side effects: renders the editor, edits the title, and clicks Save.
 */
async function expectAFailedSaveToKeepTheDraft(): Promise<void> {
  const user = userEvent.setup();
  stored = {
    configuration: configurationWith([
      textSection("copy", "Saved title", "A short list.", ALPHA_TITLE_COLOR, ALPHA_DESCRIPTION_COLOR),
    ]),
    etag: '"1"',
  };
  await renderApp();
  const title = screen.getByLabelText("Title");
  await user.clear(title);
  await user.type(title, "Kept after failure");
  updateConfigurationMock.mockResolvedValue({ ok: false, kind: "unavailable" });
  await user.click(screen.getByRole("button", { name: "Save" }));
  // The action's sentence is shown. Saved is not, and the typed title remains.
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The configuration service is unavailable.");
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kept after failure");
  expect(screen.getAllByText("Kept after failure").length).toBeGreaterThan(0);
  expect(screen.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  expect(stored.configuration.data.sections[0]).toMatchObject({ title: "Saved title" });
  expect(updateConfigurationMock).toHaveBeenCalledWith(
    DEMO_CONFIGURATION_ID,
    expect.objectContaining({
      data: expect.objectContaining({
        sections: [expect.objectContaining({ title: "Kept after failure" })],
      }),
    }),
    '"1"',
    expect.any(String),
  );
  expect(createConfigurationMock).not.toHaveBeenCalled();
  const requestBody = await capturedSaveBody('"1"');
  expect(requestBody.document.data.sections[0]).toMatchObject({ title: "Kept after failure" });
}

/**
 * Registers the save and reload cases.
 *
 * Purpose: each case covers one proof from the save prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerSaveAndReloadCases(): void {
  // The action, storage, the round trip, a broken image, and a failed write.
  it("saves through the editor action and reloads that title", expectSaveToPostTheEditedTitleAndReloadIt);
  it("reloads from the loader without reading localStorage", expectReloadToIgnoreLocalStorage);
  it("round-trips order, portrait, unicode, colors, and ids through import, save, and reload", expectTheRoundTripFixtureToSurviveSaveAndReload);
  it("exports and saves a carousel whose image URL fails to load", expectABrokenImageToExportAndSave);
  it("keeps the draft when save fails", expectAFailedSaveToKeepTheDraft);
}

beforeEach(() => {
  // Each case starts from the seeded document and a tag the first Save can send.
  setRouteEnv();
  stored = { configuration: demoConfiguration(), etag: '"1"' };
  capturedRequest = undefined;
  installClientMocks();
});

afterEach(() => {
  // The next case must not keep the previous document, request, or environment.
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
  restoreRouteEnv();
});

describe("save and reload", registerSaveAndReloadCases);
