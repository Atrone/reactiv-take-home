// @vitest-environment happy-dom

import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createElement, type JSX } from "react";
import { cleanup, render, screen } from "@testing-library/react";
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
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { Route } from "../../routes/+types/editor";
import EditorRoute, { action, loader, shouldRevalidate } from "../../routes/editor.js";
import {
  createConfiguration,
  getConfiguration,
  updateConfiguration,
  type ConfigurationClientResult,
} from "../../services/configuration.server.js";
import { SAVED_MESSAGE } from "./save-document.js";
import { CONFLICT_MESSAGE } from "./save-reconciliation.js";

/**
 * Replaces the private client with mocks and keeps the real error types.
 *
 * Purpose: a failed load or save can run the route without opening a socket.
 * Inputs: none. Vitest calls this factory when the module is imported.
 * Side effects: replaces getConfiguration, updateConfiguration, and createConfiguration.
 */
async function mockConfigurationClient(): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<typeof import("../../services/configuration.server.js")>(
    "../../services/configuration.server.js",
  );
  // The route still uses the real setup error. The three calls are spies.
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

/** Text-section titles from the demo factory. An error page must not show them as a saved document. */
const DEMO_SECTION_TITLES = ["New this week", "From the floor"] as const;

/** Title on the document before the failed save. */
const STORED_TITLE = "Saved title";

/** Title the author typed and must still see after the failure. */
const UNSAVED_TITLE = "Kept after failure";

/** Description the author typed. It stays with the title. */
const UNSAVED_DESCRIPTION = "Still in the draft";

/** The seed module the loader must not call. */
type SeedModule = {
  seedDemoConfiguration: (...args: never[]) => Promise<unknown>;
  createSeedDocument: () => unknown;
};

/** Spies installed once on the real seed functions. */
let seedDemoSpy: MockInstance | undefined;
let createSeedSpy: MockInstance | undefined;

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
 * Finds the config-service seed module on disk.
 *
 * Purpose: the spy imports the same function a mistaken loader would call.
 * Inputs: none.
 * Side effects: none. Throws when the file is not in either of the two working directories.
 */
function seedModulePath(): string {
  const cwd = process.cwd();
  // The editor test script uses apps/editor. The workspace-root script uses the repo root.
  const fromEditor = path.resolve(cwd, "../config-service/src/db/seed.ts");
  const fromRoot = path.resolve(cwd, "apps/config-service/src/db/seed.ts");
  if (existsSync(fromEditor)) {
    return fromEditor;
  }
  if (existsSync(fromRoot)) {
    return fromRoot;
  }
  throw new Error("The seed module is not on disk.");
}

/**
 * Loads the seed module without a static import.
 *
 * Purpose: the editor typecheck does not have to compile the config service, and the spy is still the real function.
 * Inputs: none.
 * Side effects: loads the seed module once. Does not insert a row.
 */
async function importSeedModule(): Promise<SeedModule> {
  // A file URL is not a static specifier, so this import is the runtime module.
  const loaded: unknown = await import(pathToFileURL(seedModulePath()).href);
  if (typeof loaded !== "object" || loaded === null) {
    throw new Error("The seed module did not load.");
  }
  const record = loaded as Record<string, unknown>;
  // Both functions have to be present or the spy would be watching the wrong export.
  if (typeof record.seedDemoConfiguration !== "function" || typeof record.createSeedDocument !== "function") {
    throw new Error("The seed module is missing its seed functions.");
  }
  return loaded as SeedModule;
}

/**
 * Installs spies on the seed functions.
 *
 * Purpose: a failed load can prove it did not call them. Later cases clear the same spies.
 * Inputs: none.
 * Side effects: wraps the two exports the first time. Clears their call history after that.
 */
async function watchSeed(): Promise<void> {
  if (seedDemoSpy === undefined || createSeedSpy === undefined) {
    const seed = await importSeedModule();
    // The wrappers record calls. The functions themselves are not invoked here.
    seedDemoSpy = vi.spyOn(seed, "seedDemoConfiguration");
    createSeedSpy = vi.spyOn(seed, "createSeedDocument");
  }
  seedDemoSpy.mockClear();
  createSeedSpy.mockClear();
}

/**
 * Asserts the load or save path did not create or seed a document.
 *
 * Purpose: an outage must not write a default row or build the demo document.
 * Inputs: none. The spies were cleared before the path under test.
 * Side effects: none.
 */
function expectCreateAndSeedNotCalled(): void {
  // createConfiguration is the editor's create call. The other two are the config-service seed.
  expect(createConfigurationMock).not.toHaveBeenCalled();
  expect(seedDemoSpy).not.toHaveBeenCalled();
  expect(createSeedSpy).not.toHaveBeenCalled();
}

/**
 * Asserts the rendered page is not the demo factory pretending to be saved data.
 *
 * Purpose: a failed load must not show the demo section titles.
 * Inputs: none.
 * Side effects: none.
 */
function expectNoDemoSectionTitles(): void {
  const text = document.body.textContent ?? "";
  // Each title is the demo copy. Neither one is a successful load.
  for (const title of DEMO_SECTION_TITLES) {
    expect(text).not.toContain(title);
  }
}

/**
 * Builds one text section.
 *
 * Purpose: the save cases share a valid text block.
 * Inputs: title, the title field. description, the description field.
 * Side effects: none.
 */
function textSection(title: string, description: string): Section {
  // The colors are valid six-digit hex. The title and description are the fields the cases change.
  return {
    id: "copy",
    type: "text",
    title,
    description,
    titleColor: "#112233",
    descriptionColor: "#334455",
  };
}

/**
 * Wraps a portable document as a stored configuration.
 *
 * Purpose: the mocked service can return the document the action just accepted.
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
 * Wraps one text section as the stored configuration.
 *
 * Purpose: a test can load a document other than the demo before the first render.
 * Inputs: title, the stored title. description, the stored description. revision, the counter. Defaults to 1.
 * Side effects: none.
 */
function configurationWith(title: string, description: string, revision = 1): Configuration {
  // The schema parse is the same check the service would apply.
  return configurationFromDocument(
    editableDocumentSchema.parse({
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      data: { sections: [textSection(title, description)] },
    }),
    revision,
  );
}

/**
 * Loads the document the test last stored.
 *
 * Purpose: the route loader reads the mocked service.
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
 * Purpose: a successful retry becomes the document the assertion reads back.
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
  const configuration = configurationFromDocument(document, stored.configuration.revision + 1);
  // The next read returns this body and the new strong tag.
  stored = { configuration, etag: '"9"' };
  return { ok: true, configuration, etag: '"9"' };
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
 * Renders the editor route through a data router.
 *
 * Purpose: Save and Retry use the same fetcher path as the browser, and Retry on a failed load runs the loader.
 * Inputs: none.
 * Side effects: mounts the route.
 */
function renderRoute(): void {
  const Stub = createRoutesStub([
    {
      path: "/",
      Component: EditorRoute,
      loader,
      action: actionWithCapture,
      shouldRevalidate,
    },
  ]);
  // The stub loads `/` and then renders whatever the loader returned.
  render(createElement(Stub as (props: { initialEntries: string[] }) => JSX.Element, { initialEntries: ["/"] }));
}

/**
 * Reads the mounted editor page.
 *
 * Purpose: dirty is an attribute on the shell, not a sentence.
 * Inputs: none.
 * Side effects: none. Throws when the shell is not mounted.
 */
function editorPage(): HTMLElement {
  const page = document.querySelector(".editor-page");
  if (!(page instanceof HTMLElement)) {
    throw new Error("Missing editor page.");
  }
  return page;
}

/**
 * Replaces one labeled field.
 *
 * Purpose: the failure cases start from a stored document and type over it.
 * Inputs: user, the user-event session. label, the accessible name. value, the replacement text.
 * Side effects: types into the field.
 */
async function replaceField(user: ReturnType<typeof userEvent.setup>, label: string, value: string): Promise<void> {
  const field = screen.getByLabelText(label);
  // Clear first so the stored text is not appended to.
  await user.clear(field);
  await user.type(field, value);
}

/**
 * Asserts a failed save keeps the typed draft and does not say Saved.
 *
 * Purpose: the acknowledgement is the only success path. Retry then stores that same draft.
 * Inputs: none.
 * Side effects: renders the editor, edits two fields, and clicks Save and Retry save.
 */
async function expectAFailedSaveToKeepTheDraftAndRetry(): Promise<void> {
  const user = userEvent.setup();
  stored = {
    configuration: configurationWith(STORED_TITLE, "A short list."),
    etag: '"1"',
  };
  getConfigurationMock.mockImplementation(loadStored);
  let attempts = 0;
  updateConfigurationMock.mockImplementation((id, document, etag) => {
    // The first PUT is the outage. The retry uses the normal conditional write.
    attempts += 1;
    if (attempts === 1) {
      return Promise.resolve({ ok: false, kind: "unavailable" });
    }
    return saveStored(id, document, etag);
  });
  renderRoute();
  await screen.findByLabelText("Title");
  await replaceField(user, "Title", UNSAVED_TITLE);
  await replaceField(user, "Description", UNSAVED_DESCRIPTION);
  await user.click(screen.getByRole("button", { name: "Save" }));
  // The draft is still the typed one. Saved is absent, and the stored row was not replaced.
  expect(await screen.findByText("The draft was not saved.")).toBeTruthy();
  expect(screen.getByRole("alert")).toHaveProperty("textContent", "The configuration service is unavailable.");
  expect(screen.getByText(/^Reference: \S+$/)).toBeTruthy();
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", UNSAVED_TITLE);
  expect(screen.getByLabelText("Description")).toHaveProperty("value", UNSAVED_DESCRIPTION);
  expect(editorPage().getAttribute("data-dirty")).toBe("true");
  expect(screen.getByRole("button", { name: "Retry save" })).toHaveProperty("disabled", false);
  expect(stored.configuration.data.sections[0]).toMatchObject({
    title: STORED_TITLE,
    description: "A short list.",
  });
  expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
  expectCreateAndSeedNotCalled();
  await user.click(screen.getByRole("button", { name: "Retry save" }));
  // The second PUT committed. Saved appears only after that, and the stored document is the draft.
  expect(await screen.findByText(SAVED_MESSAGE)).toBeTruthy();
  expect(screen.queryByText("The draft was not saved.")).toBeNull();
  expect(stored.configuration.data.sections[0]).toMatchObject({
    title: UNSAVED_TITLE,
    description: UNSAVED_DESCRIPTION,
  });
  expect(updateConfigurationMock).toHaveBeenCalledTimes(2);
  expect(updateConfigurationMock.mock.calls[1]?.[2]).toBe('"1"');
  expect(editorPage().getAttribute("data-dirty")).toBe("false");
  expectCreateAndSeedNotCalled();
  if (capturedRequest === undefined) {
    throw new Error("Retry save did not post to the action.");
  }
  const body = (await capturedRequest.json()) as { document: EditableDocument; baseEtag: string };
  expect(body.baseEtag).toBe('"1"');
  expect(body.document.data.sections[0]).toMatchObject({
    title: UNSAVED_TITLE,
    description: UNSAVED_DESCRIPTION,
  });
}

/**
 * Asserts a timed-out write that actually committed becomes a conflict on retry.
 *
 * Purpose: the editor does not send a second PUT with the newer tag in the same turn.
 * Inputs: none.
 * Side effects: renders the editor, edits the title, and clicks Save and Retry save.
 */
async function expectACommittedTimeoutToConflictOnRetry(): Promise<void> {
  const user = userEvent.setup();
  stored = {
    configuration: configurationWith(STORED_TITLE, "A short list."),
    etag: '"1"',
  };
  getConfigurationMock.mockImplementation(loadStored);
  let puts = 0;
  updateConfigurationMock.mockImplementation(async (_id, document) => {
    // The first response is a timeout, but the row has already moved to the submitted document.
    puts += 1;
    if (puts === 1) {
      stored = {
        configuration: configurationFromDocument(document, 2),
        etag: '"2"',
      };
      return { ok: false, kind: "unavailable" };
    }
    // A later call is the user's retry. It is a 412 for the stale tag, not a blind overwrite.
    return {
      ok: false,
      kind: "service",
      status: 412,
      code: "PRECONDITION_FAILED",
      requestId: "req-timeout-committed",
    };
  });
  renderRoute();
  await screen.findByLabelText("Title");
  await replaceField(user, "Title", "Kept after timeout");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByText("The draft was not saved.")).toBeTruthy();
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  await user.click(screen.getByRole("button", { name: "Retry save" }));
  expect(await screen.findByText(CONFLICT_MESSAGE)).toBeTruthy();
  expect(screen.getByText(`Request id: ${String(updateConfigurationMock.mock.calls[1]?.[3])}`)).toBeTruthy();
  expect(screen.queryByText(SAVED_MESSAGE)).toBeNull();
  expect(screen.getByLabelText("Title")).toHaveProperty("value", "Kept after timeout");
  expect(editorPage().getAttribute("data-dirty")).toBe("true");
  // Give a same-turn follow-up PUT a chance to appear, then require that it did not.
  await new Promise((resolve) => {
    setTimeout(resolve, 30);
  });
  expect(updateConfigurationMock).toHaveBeenCalledTimes(2);
  expect(updateConfigurationMock.mock.calls[0]?.[2]).toBe('"1"');
  expect(updateConfigurationMock.mock.calls[1]?.[2]).toBe('"1"');
  expectCreateAndSeedNotCalled();
}

/**
 * Asserts an unreachable service shows the load error and Retry reads the stored document.
 *
 * Purpose: the outage is not rendered as the demo factory, and it does not create or seed a row.
 * Inputs: none.
 * Side effects: renders the route, then clicks Retry after the mock starts succeeding.
 */
async function expectAFailedLoadToStayRecoverable(): Promise<void> {
  stored = {
    configuration: configurationWith("Loaded after retry", "From the service."),
    etag: '"1"',
  };
  let reachable = false;
  getConfigurationMock.mockImplementation(async (id) => {
    // The first load is the outage. Retry flips the flag before it asks again.
    if (!reachable) {
      return { ok: false, kind: "unavailable" };
    }
    return loadStored(id);
  });
  renderRoute();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The saved home screen could not be loaded.");
  expect(screen.getByText("The configuration service is unavailable.")).toBeTruthy();
  expect(screen.queryByText("This home screen was not found.")).toBeNull();
  expect(screen.queryByLabelText("Title")).toBeNull();
  expectNoDemoSectionTitles();
  expect(getConfigurationMock).toHaveBeenCalledTimes(1);
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  expectCreateAndSeedNotCalled();
  reachable = true;
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  // The second load is the stored document. The demo titles are still not standing in for it.
  expect(await screen.findByLabelText("Title")).toHaveProperty("value", "Loaded after retry");
  expect(screen.queryByText("The saved home screen could not be loaded.")).toBeNull();
  expectNoDemoSectionTitles();
  expect(getConfigurationMock).toHaveBeenCalledTimes(2);
  expectCreateAndSeedNotCalled();
}

/**
 * Asserts a missing configuration stays not-found and does not seed.
 *
 * Purpose: not-found is a different sentence from an outage, and it still does not write a default document.
 * Inputs: none.
 * Side effects: renders the route with a mocked 404.
 */
async function expectNotFoundToStayDistinct(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 404,
    code: "NOT_FOUND",
    requestId: "req-missing-22",
  });
  renderRoute();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "This home screen was not found.");
  expect(screen.queryByText("The saved home screen could not be loaded.")).toBeNull();
  expect(screen.getByText(`Reference: ${String(getConfigurationMock.mock.calls[0]?.[1])}`)).toBeTruthy();
  expect(screen.queryByText("Configuration not found.")).toBeNull();
  expect(screen.queryByLabelText("Title")).toBeNull();
  expectNoDemoSectionTitles();
  expect(getConfigurationMock).toHaveBeenCalledTimes(1);
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  expectCreateAndSeedNotCalled();
}

/**
 * Asserts a service 500 shows the load error and does not seed.
 *
 * Purpose: a 500 is the same recoverable outage as an unreachable service, not an empty configuration.
 * Inputs: none.
 * Side effects: renders the route with a mocked 500.
 */
async function expectAService500ToStayALoadError(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 500,
    code: "INTERNAL",
    requestId: "req-load-500",
  });
  renderRoute();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The saved home screen could not be loaded.");
  expect(screen.getByText("The editor could not complete the request.")).toBeTruthy();
  expect(screen.getByText(`Reference: ${String(getConfigurationMock.mock.calls[0]?.[1])}`)).toBeTruthy();
  expect(screen.queryByText("This home screen was not found.")).toBeNull();
  expect(screen.queryByLabelText("Title")).toBeNull();
  expectNoDemoSectionTitles();
  expect(getConfigurationMock).toHaveBeenCalledTimes(1);
  expectCreateAndSeedNotCalled();
}

/**
 * Registers the failure-recovery cases.
 *
 * Purpose: each case is one proof from the failure prompt.
 * Inputs: none.
 * Side effects: registers vitest cases.
 */
function registerFailureRecoveryCases(): void {
  // Save failure, the ambiguous timeout, and the three load failures.
  it("keeps the draft when save fails and stores it on retry", expectAFailedSaveToKeepTheDraftAndRetry);
  it("surfaces a conflict when a timed-out save had committed", expectACommittedTimeoutToConflictOnRetry);
  it("shows a load error without the demo document and retries the loader", expectAFailedLoadToStayRecoverable);
  it("keeps not-found distinct and does not seed", expectNotFoundToStayDistinct);
  it("shows a load error when the service returns 500", expectAService500ToStayALoadError);
}

beforeEach(async () => {
  // Each case starts from the demo scope, empty spies, and no captured save.
  setRouteEnv();
  stored = {
    configuration: configurationWith(STORED_TITLE, "A short list."),
    etag: '"1"',
  };
  capturedRequest = undefined;
  getConfigurationMock.mockReset();
  updateConfigurationMock.mockReset();
  createConfigurationMock.mockReset();
  createConfigurationMock.mockResolvedValue({ ok: false, kind: "internal" });
  await watchSeed();
});

afterEach(() => {
  // The next case must not keep the previous document or the previous page.
  cleanup();
  restoreRouteEnv();
});

describe("failure recovery", registerFailureRecoveryCases);
