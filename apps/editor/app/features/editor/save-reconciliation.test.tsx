// @vitest-environment happy-dom

import { createElement, type JSX } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  configurationSchema,
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
import { getConfiguration, updateConfiguration, type ConfigurationClientResult } from "../../services/configuration.server.js";
import { IMPORTED_NOT_SAVED_MESSAGE } from "./json-import.js";
import { EXPORT_BLOCKED_MESSAGE, jsonFileDownload } from "./json-export.js";
import { SAVED_MESSAGE } from "./save-document.js";
import { CONFLICT_MESSAGE, RELOAD_CONFIRMATION, UNSAVED_CHANGES_MESSAGE } from "./save-reconciliation.js";

/**
 * Replaces the private client with mocks and keeps the real error types.
 *
 * Purpose: the route action can run without opening a socket.
 * Inputs: none. Vitest calls this factory when the module is imported.
 * Side effects: replaces the configuration client functions.
 */
async function mockConfigurationClient(): Promise<Record<string, unknown>> {
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

/** The configuration id the server environment selects. */
const DEMO_CONFIGURATION_ID = "cfg_demo";

/** Title on the document before the author edits. */
const TITLE_BEFORE = "Before";

/** Title captured by the in-flight save. */
const TITLE_A = "A";

/** Title typed while that save is still pending. */
const TITLE_B = "B";

/** Strong tag returned when the save of A is acknowledged. */
const ACKNOWLEDGED_ETAG = '"2"';

/** The document and tag the mocked service currently stores. */
let stored: { configuration: Configuration; etag: string };

/** The action request from the latest Save, cloned before the action reads it. */
let capturedRequest: Request | undefined;

const savedTenant = process.env.DEMO_TENANT_ID;
const savedConfiguration = process.env.DEMO_CONFIGURATION_ID;

/**
 * Sets one environment variable, or deletes it when the value is undefined.
 *
 * Purpose: the route can read the demo id, and the process can be restored.
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
 * Sets the demo scope the action reads.
 *
 * Purpose: Save posts to the route, and the route selects cfg_demo.
 * Inputs: none.
 * Side effects: writes process.env.
 */
function setRouteEnv(): void {
  // The tenant is required by getDemoScope and must not be rendered.
  setEnv("DEMO_TENANT_ID", "tenant_demo");
  // The configuration id is the only id the action may send.
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
 * Builds one text section.
 *
 * Purpose: the fixtures share a valid text block.
 * Inputs: id, the section id. title, the title.
 * Side effects: none.
 */
function textSection(id: string, title: string): Section {
  // The colors are valid six-digit hex. The title is the field the cases change.
  return {
    id,
    type: "text",
    title,
    description: "Body",
    titleColor: "#112233",
    descriptionColor: "#334455",
  };
}

/**
 * Wraps sections as a stored configuration at revision 1.
 *
 * Purpose: the first render hydrates this document and the tag `"1"`.
 * Inputs: sections, the ordered sections.
 * Side effects: none.
 */
function configurationWith(sections: Section[]): Configuration {
  // Revision 1 matches the ETag the first Save sends. The sections stay in this order.
  return configurationSchema.parse({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    data: { sections },
    id: DEMO_CONFIGURATION_ID,
    revision: 1,
    updatedAt: "2026-10-13T12:00:00.000Z",
  });
}

/**
 * Wraps a portable document as the configuration a save acknowledgement returns.
 *
 * Purpose: the delayed save can resolve with the body that was submitted.
 * Inputs: document, the editable body. revision, the next counter.
 * Side effects: none.
 */
function configurationFromDocument(document: EditableDocument, revision: number): Configuration {
  // updatedAt is service-owned. The sections are the document the editor submitted.
  return configurationSchema.parse({
    schemaVersion: document.schemaVersion,
    data: document.data,
    id: DEMO_CONFIGURATION_ID,
    revision,
    updatedAt: "2026-10-13T18:00:00.000Z",
  });
}

/**
 * Loads the document the test last stored.
 *
 * Purpose: the route loader reads the mocked service.
 * Inputs: id, the configuration id.
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
 * Purpose: the mounted editor keeps the draft. The reload case calls the loader itself.
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
 * Purpose: Save uses the same fetcher path as the browser.
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
  // The request URL is not the configuration id. The loader reads the server environment.
  const request = new Request("http://127.0.0.1:5173/");
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
 * Builds the route element for a direct loader payload.
 *
 * Purpose: a rerender can pass a new payload without remounting through the data router.
 * Inputs: configuration, the document. etag, the strong validator.
 * Side effects: none.
 */
function pageElement(configuration: Configuration, etag: string): ReturnType<typeof createElement> {
  // The element is the same one a later rerender passes back in.
  const props = {
    loaderData: {
      title: "Editor",
      configuration,
      etag,
    },
  } as Route.ComponentProps;
  return createElement(EditorRoute, props);
}

/**
 * Reads the editor page element.
 *
 * Purpose: dirty is on the page for the assertions. The ETag is not rendered.
 * Inputs: none.
 * Side effects: none. Throws when the page is missing.
 */
function editorPage(): HTMLElement {
  const page = document.querySelector(".editor-page");
  if (!(page instanceof HTMLElement)) {
    throw new Error("Missing editor page.");
  }
  // The dirty flag is an attribute. The ETag stays out of the markup.
  return page;
}

/**
 * Reads the action body captured from Save.
 *
 * Purpose: the posted request carries the document and the ETag from the click.
 * Inputs: etag, the tag the click was supposed to send.
 * Side effects: reads the cloned request body. Throws when Save did not post.
 */
async function capturedSaveBody(etag: string): Promise<{ document: EditableDocument; baseEtag: string }> {
  if (capturedRequest === undefined) {
    throw new Error("Save did not post to the action.");
  }
  const body = (await capturedRequest.json()) as { document: EditableDocument; baseEtag: string };
  expect(body.baseEtag).toBe(etag);
  return body;
}

/**
 * Holds the first Save until the test releases the submitted document.
 *
 * Purpose: the author can type while the acknowledgement is still pending.
 * Inputs: etag, the tag to store with the submitted document.
 * Side effects: replaces the update mock. The returned function resolves that update.
 */
function holdFirstSave(etag: string): () => void {
  let release: () => void = () => {
    throw new Error("Save did not start.");
  };
  updateConfigurationMock.mockImplementation((_id: string, document: EditableDocument) => {
    return new Promise((resolve) => {
      release = () => {
        const configuration = configurationFromDocument(document, 2);
        stored = { configuration, etag };
        resolve({ ok: true, configuration, etag });
      };
    });
  });
  return () => {
    release();
  };
}

/**
 * Changes the selected title.
 *
 * Purpose: the draft becomes dirty with a known title.
 * Inputs: user, the user-event session. title, the next title.
 * Side effects: types into the title field.
 */
async function replaceTitle(user: ReturnType<typeof userEvent.setup>, title: string): Promise<void> {
  const field = screen.getByLabelText("Title");
  // Clear removes the previous title. Typing the next title marks the draft dirty.
  await user.clear(field);
  await user.type(field, title);
}

/**
 * Asserts typing during Save keeps B, and a reload without another Save shows A.
 *
 * Purpose: R05. The pending acknowledgement stored A. The screen keeps B and stays unsaved.
 * Inputs: none.
 * Side effects: renders the editor, edits the title, and clicks Save.
 */
async function expectTypingDuringSaveToKeepTheNewerTitle(): Promise<void> {
  const user = userEvent.setup();
  stored = { configuration: configurationWith([textSection("copy", TITLE_BEFORE)]), etag: '"1"' };
  const release = holdFirstSave(ACKNOWLEDGED_ETAG);
  await renderApp();
  await replaceTitle(user, TITLE_A);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
  });
  // A second click while this save is running does not send another write.
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  await replaceTitle(user, TITLE_B);
  expect(screen.getByLabelText("Title")).toHaveProperty("value", TITLE_B);
  release();
  await screen.findByText(UNSAVED_CHANGES_MESSAGE);
  // The preview and the field show B. The acknowledgement did not say Saved.
  expect(screen.getAllByText(TITLE_B).length).toBeGreaterThan(0);
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  expect(screen.queryByText(TITLE_A)).toBeNull();
  expect(editorPage().getAttribute("data-dirty")).toBe("true");
  const loaded = unwrapData(await loader(loaderArgs()));
  if (loaded.status !== 200 || !("configuration" in loaded.body)) {
    throw new Error("Expected the reload loader to return the stored configuration.");
  }
  const storedConfiguration = loaded.body.configuration as Configuration;
  expect(storedConfiguration.data.sections[0]).toMatchObject({ title: TITLE_A });
  expect(storedConfiguration.data.sections.some((section) => section.type === "text" && section.title === TITLE_B)).toBe(false);
  updateConfigurationMock.mockImplementation(async (id: string, document: EditableDocument, etag: string) => {
    if (etag !== stored.etag) {
      throw new Error(`Unexpected etag ${etag}.`);
    }
    const configuration = configurationFromDocument(document, 3);
    stored = { configuration, etag: '"3"' };
    return { ok: true, configuration, etag: '"3"' };
  });
  capturedRequest = undefined;
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(updateConfigurationMock).toHaveBeenCalledTimes(2);
  });
  const secondBody = await capturedSaveBody(ACKNOWLEDGED_ETAG);
  expect(secondBody.document.data.sections[0]).toMatchObject({ title: TITLE_B });
  cleanup();
  renderLoaderPage(loaded.body);
  // The reload is the stored A document. B was not written by the first save.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", TITLE_A);
  expect(screen.queryByText(TITLE_B)).toBeNull();
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
}

/**
 * Asserts a pending save with no further edits shows Saved and the stored title.
 *
 * Purpose: the matching sequence replaces the draft. The preview is the document that was saved.
 * Inputs: none.
 * Side effects: renders the editor, edits the title, and clicks Save.
 */
async function expectAQuietSaveToShowSaved(): Promise<void> {
  const user = userEvent.setup();
  stored = { configuration: configurationWith([textSection("copy", TITLE_BEFORE)]), etag: '"1"' };
  const release = holdFirstSave(ACKNOWLEDGED_ETAG);
  await renderApp();
  await replaceTitle(user, TITLE_A);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
  });
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  release();
  const saved = await screen.findByText(SAVED_MESSAGE);
  expect(saved.getAttribute("role")).toBe("status");
  expect(screen.queryByText(UNSAVED_CHANGES_MESSAGE)).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", TITLE_A);
  expect(screen.getAllByText(TITLE_A).length).toBeGreaterThan(0);
  expect(screen.queryByText(TITLE_BEFORE)).toBeNull();
  expect(editorPage().getAttribute("data-dirty")).toBe("false");
}

/**
 * Asserts a different loader document leaves the dirty title and does not take the new ETag.
 *
 * Purpose: revalidation is not hydrate. Compare, export, and an explicit reload are the ways out.
 * Inputs: none.
 * Side effects: renders the route, edits the title, and rerenders with another payload.
 */
async function expectADifferentRevalidationToKeepTheDirtyTitle(): Promise<void> {
  const user = userEvent.setup();
  const downloaded: string[] = [];
  vi.spyOn(jsonFileDownload, "save").mockImplementation((_filename: string, contents: string) => {
    downloaded.push(contents);
  });
  const confirm = vi.fn(() => false);
  // happy-dom does not provide confirm. The reload button calls the function installed here.
  Object.defineProperty(window, "confirm", { configurable: true, writable: true, value: confirm });
  const initial = configurationWith([
    textSection("copy", "Loaded title"),
    {
      id: "cta-1",
      type: "cta",
      label: "Go",
      url: "https://example.com/go",
      backgroundColor: "#112233",
      labelColor: "#ffffff",
    },
  ]);
  const server = configurationWith([
    {
      id: "cta-1",
      type: "cta",
      label: "Go",
      url: "https://example.com/go",
      backgroundColor: "#112233",
      labelColor: "#ffffff",
    },
    textSection("copy", "Server title"),
  ]);
  const view = render(pageElement(initial, '"1"'));
  await replaceTitle(user, "Dirty title");
  view.rerender(pageElement(server, '"9"'));
  // The input and the preview keep the dirty title. The new tag is not the base tag.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Dirty title");
  expect(screen.getAllByText("Dirty title").length).toBeGreaterThan(0);
  expect(screen.queryByText("Server title")).toBeNull();
  expect(screen.getByRole("alert").textContent).toBe(CONFLICT_MESSAGE);
  expect(editorPage().getAttribute("data-dirty")).toBe("true");
  await user.click(screen.getByRole("button", { name: "Compare" }));
  const local = screen.getByRole("region", { name: "On this page" });
  const remote = screen.getByRole("region", { name: "On the server" });
  expect(local.textContent).toContain("1. text — Dirty title");
  expect(local.textContent).toContain("2. cta — Go");
  expect(remote.textContent).toContain("1. cta — Go");
  expect(remote.textContent).toContain("2. text — Server title");
  await user.click(screen.getByRole("button", { name: "Export local work" }));
  expect(downloaded[0]).toContain("Dirty title");
  expect(downloaded[0]).not.toContain("Server title");
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Reload server version" }));
  expect(confirm).toHaveBeenCalledWith(RELOAD_CONFIRMATION);
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Dirty title");
  confirm.mockReturnValue(true);
  await user.click(screen.getByRole("button", { name: "Reload server version" }));
  // The confirmed reload discards the local draft. It does not write that draft to the server.
  expect(screen.getAllByText("Server title").length).toBeGreaterThan(0);
  expect(screen.queryByText("Dirty title")).toBeNull();
  expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull();
  expect(editorPage().getAttribute("data-dirty")).toBe("false");
  expect(updateConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Asserts a same-etag revalidation does not replace a dirty title or open a conflict.
 *
 * Purpose: the known revision is ignored even when the payload title differs.
 * Inputs: none.
 * Side effects: renders the route, edits the title, and rerenders.
 */
async function expectTheSameEtagToLeaveTheDirtyTitle(): Promise<void> {
  const user = userEvent.setup();
  const initial = configurationWith([textSection("copy", "Loaded title")]);
  const view = render(pageElement(initial, '"1"'));
  await replaceTitle(user, "Dirty title");
  view.rerender(pageElement(configurationWith([textSection("copy", "Other title")]), '"1"'));
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Dirty title");
  expect(screen.queryByText("Other title")).toBeNull();
  expect(screen.queryByText(CONFLICT_MESSAGE)).toBeNull();
  expect(editorPage().getAttribute("data-dirty")).toBe("true");
}

/**
 * Asserts a 412 leaves the typed title and shows the conflict message.
 *
 * Purpose: the stale write does not say Saved and does not discard the draft. The request id stays readable.
 * Inputs: none.
 * Side effects: renders the editor, edits the title, and clicks Save.
 */
async function expectAConflictResponseToKeepTheDraft(): Promise<void> {
  const user = userEvent.setup();
  stored = { configuration: configurationWith([textSection("copy", "Stored title")]), etag: '"1"' };
  await renderApp();
  await replaceTitle(user, "Kept locally");
  updateConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 412,
    code: "PRECONDITION_FAILED",
    requestId: "req-stale",
  });
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", CONFLICT_MESSAGE);
  expect(screen.getByText(`Request id: ${String(updateConfigurationMock.mock.calls[0]?.[3])}`)).toBeTruthy();
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  expect(screen.queryByText("The configuration revision does not match.")).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kept locally");
  expect(screen.getAllByText("Kept locally").length).toBeGreaterThan(0);
  expect(editorPage().getAttribute("data-dirty")).toBe("true");
  expect(stored.configuration.data.sections[0]).toMatchObject({ title: "Stored title" });
  expect(updateConfigurationMock).toHaveBeenCalledWith(
    DEMO_CONFIGURATION_ID,
    expect.objectContaining({
      data: expect.objectContaining({
        sections: [expect.objectContaining({ title: "Kept locally" })],
      }),
    }),
    '"1"',
    expect.any(String),
  );
}

/**
 * Asserts an imported draft survives a later loader payload.
 *
 * Purpose: the import stays dirty, so the refresh does not replace it or clear the import sentence.
 * Inputs: none.
 * Side effects: renders the route, imports a file, and rerenders.
 */
async function expectAnImportedDraftToSurviveRevalidation(): Promise<void> {
  const user = userEvent.setup();
  const view = render(pageElement(configurationWith([textSection("copy", "Loaded title")]), '"1"'));
  const file = new File(
    [
      JSON.stringify({
        schemaVersion: 1,
        data: {
          sections: [textSection("imported-text", "Imported title")],
        },
      }),
    ],
    "home-screen.json",
    { type: "application/json" },
  );
  await user.upload(screen.getByLabelText("Import JSON"), file);
  await screen.findByText(IMPORTED_NOT_SAVED_MESSAGE);
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Imported title");
  view.rerender(pageElement(configurationWith([textSection("copy", "Server title")]), '"9"'));
  // The imported draft is still the input. The loader title was not copied over it.
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Imported title");
  expect(screen.getByText(IMPORTED_NOT_SAVED_MESSAGE)).toBeTruthy();
  expect(screen.queryByText("Server title")).toBeNull();
  expect(editorPage().getAttribute("data-dirty")).toBe("true");
  expect(screen.getByRole("alert").textContent).toBe(CONFLICT_MESSAGE);
}

/**
 * Asserts an invalid local draft is not downloaded from the conflict panel.
 *
 * Purpose: Export local work uses the same exporter as Export JSON. A bad color produces the sentence and no file.
 * Inputs: none.
 * Side effects: renders the route, breaks a color, and rerenders into a conflict.
 */
async function expectAnInvalidDraftNotToDownload(): Promise<void> {
  const user = userEvent.setup();
  const save = vi.spyOn(jsonFileDownload, "save").mockImplementation(() => undefined);
  const view = render(pageElement(configurationWith([textSection("copy", "Loaded title")]), '"1"'));
  await replaceTitle(user, "Dirty title");
  const color = screen.getByLabelText("Title color");
  await user.clear(color);
  await user.type(color, "nope");
  view.rerender(pageElement(configurationWith([textSection("copy", "Server title")]), '"9"'));
  await user.click(screen.getByRole("button", { name: "Export local work" }));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByText(EXPORT_BLOCKED_MESSAGE)).toBeTruthy();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Dirty title");
  expect(screen.queryByText("Server title")).toBeNull();
  expect(updateConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Registers the reconciliation UI cases.
 *
 * Purpose: each case covers one rule from the save-conflict prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerSaveReconciliationUi(): void {
  it("keeps B when A's save completes, and a reload shows A", expectTypingDuringSaveToKeepTheNewerTitle);
  it("shows Saved when the pending save had no further edits", expectAQuietSaveToShowSaved);
  it("leaves the dirty title in place when revalidation has a different document", expectADifferentRevalidationToKeepTheDirtyTitle);
  it("leaves the dirty title in place when revalidation has the same ETag", expectTheSameEtagToLeaveTheDirtyTitle);
  it("keeps the draft and shows the conflict message on 412", expectAConflictResponseToKeepTheDraft);
  it("keeps an imported draft when a later loader payload arrives", expectAnImportedDraftToSurviveRevalidation);
  it("does not download an invalid local draft from the conflict panel", expectAnInvalidDraftNotToDownload);
}

beforeEach(() => {
  setRouteEnv();
  stored = { configuration: configurationWith([textSection("copy", TITLE_BEFORE)]), etag: '"1"' };
  capturedRequest = undefined;
  getConfigurationMock.mockReset();
  updateConfigurationMock.mockReset();
  getConfigurationMock.mockImplementation(loadStored);
  updateConfigurationMock.mockImplementation(async () => {
    throw new Error("updateConfiguration was not expected.");
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreRouteEnv();
});

describe("save reconciliation ui", registerSaveReconciliationUi);
