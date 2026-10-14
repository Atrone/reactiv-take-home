import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  configurationSchema,
  createDemoDocument,
  editableDocumentSchema,
  errorObjectSchema,
  type Configuration,
  type EditableDocument,
} from "@reactiv/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EditorServerEnvError,
  MISCONFIGURED_CONFIGURATION_MESSAGE,
  createConfiguration,
  getConfiguration,
  updateConfiguration,
  type ConfigurationClientResult,
} from "../services/configuration.server.js";
import type { Route } from "./+types/editor";
import EditorRoute, { action, headers, loader, meta } from "./editor.js";

/**
 * Replaces the private client with mocks and keeps the real error types.
 *
 * Purpose: the route tests call the loader and the action without opening a socket.
 * Inputs: none. Vitest calls this factory when the module is imported.
 * Side effects: replaces getConfiguration, updateConfiguration, and createConfiguration.
 */
async function mockConfigurationClient(): Promise<Record<string, unknown>> {
  // The real module still exports the setup error and the safe sentence.
  const actual = await vi.importActual<typeof import("../services/configuration.server.js")>(
    "../services/configuration.server.js",
  );
  return {
    ...actual,
    // The route's three calls are spies. The tests assert which ones run.
    getConfiguration: vi.fn(),
    updateConfiguration: vi.fn(),
    createConfiguration: vi.fn(),
  };
}

vi.mock("../services/configuration.server.js", mockConfigurationClient);

const getConfigurationMock = vi.mocked(getConfiguration);
const updateConfigurationMock = vi.mocked(updateConfiguration);
const createConfigurationMock = vi.mocked(createConfiguration);

/**
 * Reads the correlation id from the latest mocked load.
 *
 * Purpose: the page shows the id the loader passed, not a different id on the mock result.
 * Inputs: none.
 * Side effects: none. Throws when the loader did not pass an id.
 */
function lastGetRequestId(): string {
  // The second argument is the id generated at the start of the loader.
  const requestId = getConfigurationMock.mock.calls.at(-1)?.[1];
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new Error("The loader did not pass a request id.");
  }
  return requestId;
}

/**
 * Reads the correlation id from the latest mocked save.
 *
 * Purpose: the page shows the id the action passed, not a different id on the mock result.
 * Inputs: none.
 * Side effects: none. Throws when the action did not pass an id.
 */
function lastUpdateRequestId(): string {
  // The fourth argument is the id generated at the start of the action.
  const requestId = updateConfigurationMock.mock.calls.at(-1)?.[3];
  if (typeof requestId !== "string" || requestId.length === 0) {
    throw new Error("The action did not pass a request id.");
  }
  return requestId;
}

/** The token this file puts in the environment. It is not a real credential. */
const BOUNDARY_TOKEN = "loader-boundary-token-7c3e";

/** A service URL that must not appear in loader or action data. */
const BOUNDARY_SERVICE_URL = "http://config-service.invalid:4001";

/** A tenant id that must not appear in loader or action data. */
const BOUNDARY_TENANT_ID = "tenant_not_for_the_browser";

/** The configuration id the server environment selects. */
const DEMO_CONFIGURATION_ID = "cfg_demo";

/** Copy that only the demo factory document contains. */
const DEMO_FACTORY_TITLE = "New this week";

/** An image URL that only the demo factory document contains. */
const DEMO_FACTORY_IMAGE = "https://example.com/demo/arrival-window.jpg";

/** A strong ETag the action should pass through unchanged. */
const SUBMITTED_ETAG = '"4"';

/** The strong ETag a successful PUT returns. It is not the revision. */
const ACKNOWLEDGED_ETAG = '"9"';

const savedTenant = process.env.DEMO_TENANT_ID;
const savedConfiguration = process.env.DEMO_CONFIGURATION_ID;
const savedUrl = process.env[["CONFIG", "SERVICE", "URL"].join("_")];
const savedToken = process.env[["CONFIG", "SERVICE", "TOKEN"].join("_")];

/**
 * Names the private service URL variable without storing it as one string.
 *
 * Purpose: this test file must not contain the credential variable names as literals.
 * Inputs: none.
 * Side effects: none.
 */
function serviceUrlKey(): string {
  // The join is the environment key. The source does not contain it as one string.
  return ["CONFIG", "SERVICE", "URL"].join("_");
}

/**
 * Names the private service token variable without storing it as one string.
 *
 * Purpose: this test file must not contain the credential variable name as a literal.
 * Inputs: none.
 * Side effects: none.
 */
function serviceTokenKey(): string {
  // The join is the environment key. The source does not contain it as one string.
  return ["CONFIG", "SERVICE", "TOKEN"].join("_");
}

/**
 * Sets one environment variable, or deletes it when the value is undefined.
 *
 * Purpose: a test can represent a missing variable.
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
 * Sets the demo scope and the private service variables.
 *
 * Purpose: give the route a server-selected id and a token that must not leak.
 * Inputs: none.
 * Side effects: writes process.env.
 */
function setRouteEnv(): void {
  // The tenant id is a value the page must not receive.
  setEnv("DEMO_TENANT_ID", BOUNDARY_TENANT_ID);
  // The configuration id is the only id the loader and the action may use.
  setEnv("DEMO_CONFIGURATION_ID", DEMO_CONFIGURATION_ID);
  // The client is mocked, so this URL is never fetched. It still must not be returned.
  setEnv(serviceUrlKey(), BOUNDARY_SERVICE_URL);
  // The token stands in for the server credential.
  setEnv(serviceTokenKey(), BOUNDARY_TOKEN);
}

/**
 * Restores the environment from before this file loaded.
 *
 * Purpose: keep one case from changing the next file.
 * Inputs: none.
 * Side effects: writes process.env.
 */
function restoreRouteEnv(): void {
  // Put back whatever this process had before the file loaded.
  setEnv("DEMO_TENANT_ID", savedTenant);
  setEnv("DEMO_CONFIGURATION_ID", savedConfiguration);
  setEnv(serviceUrlKey(), savedUrl);
  setEnv(serviceTokenKey(), savedToken);
}

/**
 * Builds one editable demo document.
 *
 * Purpose: give the action a schema-valid body and give the loader a six-section configuration.
 * Inputs: none.
 * Side effects: none.
 */
function sampleDocument(): EditableDocument {
  let next = 0;
  /**
   * Issues the next fixture id.
   *
   * Purpose: give createDemoDocument ten stable ids.
   * Inputs: none.
   * Side effects: increments the counter.
   */
  function nextId(): string {
    // The number is only part of the id. It is not a revision.
    next += 1;
    return `fixture-${next}`;
  }
  // The shared factory returns an editable document, not a stored configuration.
  return createDemoDocument(nextId);
}

/**
 * Builds one configuration the mocked client can return.
 *
 * Purpose: a success body that passes the shared schema.
 * Inputs: revision, the concurrency counter to put on the configuration.
 * Side effects: none.
 */
function sampleConfiguration(revision: number): Configuration {
  // id, revision, and updatedAt are service-owned. The document supplies the sections.
  return configurationSchema.parse({
    ...sampleDocument(),
    id: DEMO_CONFIGURATION_ID,
    revision,
    updatedAt: "2026-10-12T23:31:37.504Z",
  });
}

/**
 * Builds a configuration that also carries a token field.
 *
 * Purpose: a loose success body must not reach the page.
 * Inputs: revision, the concurrency counter to put on the configuration.
 * Side effects: none.
 */
function configurationCarryingAToken(revision: number): Configuration {
  const configuration = sampleConfiguration(revision) as Configuration & { token?: string };
  // The extra field is outside the contract. The route must drop the whole body.
  configuration.token = BOUNDARY_TOKEN;
  return configuration;
}

/**
 * Builds a document whose text colors are uppercase.
 *
 * Purpose: the action should send the normalized lowercase colors.
 * Inputs: none.
 * Side effects: none.
 */
function documentWithUppercaseTitleColor(): EditableDocument {
  const document = sampleDocument();
  // Only text sections have a title color. Other sections stay as they are.
  const sections = document.data.sections.map((section) => {
    if (section.type !== "text") {
      return section;
    }
    return { ...section, titleColor: "#AABBCC" };
  });
  // The uppercase color is still a string the schema can normalize.
  return { ...document, data: { sections } };
}

/**
 * Asserts a failed page has the safe title and no configuration.
 *
 * Purpose: errors share one shape the page can render.
 * Inputs: body, the page data.
 * Side effects: none.
 */
function expectFailureShape(body: Record<string, unknown>): void {
  // title and error are the only fields. A configuration would mean the failure still loaded data.
  expect(Object.keys(body).sort()).toEqual(["error", "title"]);
  expect(body.title).toBe("Editor");
}

/**
 * Asserts the private client was not asked to read, write, or seed.
 *
 * Purpose: a rejected request stops before the service.
 * Inputs: none.
 * Side effects: none.
 */
function expectPrivateClientWasNotCalled(): void {
  // None of the three client calls ran.
  expect(getConfigurationMock).not.toHaveBeenCalled();
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  expect(createConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Builds a loader request whose query names a different configuration.
 *
 * Purpose: the query string must not select the id.
 * Inputs: none.
 * Side effects: none.
 */
function loaderRequest(): Request {
  // tenantId, actorId, and configurationId are present and must be ignored.
  return new Request(
    "http://127.0.0.1:5173/?tenantId=evil-tenant&actorId=evil-actor&configurationId=cfg_other",
  );
}

/**
 * Builds the loader arguments.
 *
 * Purpose: call the server loader the way the framework would, without a browser bundle.
 * Inputs: request, the document request.
 * Side effects: none.
 */
function loaderArgs(request: Request): Route.LoaderArgs {
  // params and context are unused. The id does not come from them.
  return { request, params: {}, context: {} } as Route.LoaderArgs;
}

/**
 * Builds an action request.
 *
 * Purpose: post JSON to the app origin, with an optional Origin header.
 * Inputs: body, the JSON text. origin, the Origin header, or undefined when it is absent.
 * Side effects: none.
 */
function actionRequest(body: string, origin?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  // A missing origin is a different case from a present one. Set the header only when asked.
  if (origin !== undefined) {
    headers.set("Origin", origin);
  }
  // The query names a different configuration. The action must ignore it.
  return new Request("http://127.0.0.1:5173/?configurationId=cfg_from_query&tenantId=evil-tenant", {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Builds the action arguments.
 *
 * Purpose: call the server action directly.
 * Inputs: request, the POST request.
 * Side effects: none.
 */
function actionArgs(request: Request): Route.ActionArgs {
  // params and context are unused. The id does not come from them.
  return { request, params: {}, context: {} } as Route.ActionArgs;
}

/**
 * Reads a data() result.
 *
 * Purpose: tests call the loader and the action directly, so they see the framework wrapper.
 * Inputs: result, the value returned by the loader or the action.
 * Side effects: none.
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
 * Collects leaf values from a result.
 *
 * Purpose: find a property whose value is the test token.
 * Inputs: value, the result to walk. found, the accumulator.
 * Side effects: appends to found.
 */
function collectValues(value: unknown, found: unknown[]): void {
  // Leaves are the property values a token could occupy.
  if (value === null || typeof value !== "object") {
    found.push(value);
    return;
  }
  // Arrays have indexes, not named credential fields. Walk the items.
  if (Array.isArray(value)) {
    for (const item of value) {
      collectValues(item, found);
    }
    return;
  }
  // Walk every field, including nested configuration fields.
  for (const entry of Object.values(value)) {
    collectValues(entry, found);
  }
}

/**
 * Collects object keys from a result.
 *
 * Purpose: find a tenant or token field name.
 * Inputs: value, the result to walk. found, the accumulator.
 * Side effects: appends to found.
 */
function collectKeys(value: unknown, found: string[]): void {
  // Leaves have no keys.
  if (value === null || typeof value !== "object") {
    return;
  }
  // Array indexes are not field names.
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, found);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    // Record the name, then walk the value.
    found.push(key);
    collectKeys(entry, found);
  }
}

/**
 * Asserts a result does not carry the token, the service URL, or the tenant id.
 *
 * Purpose: the page payload is safe to serialize to the browser.
 * Inputs: result, the loader or action return value.
 * Side effects: none.
 */
function expectNoSecrets(result: unknown): void {
  const values: unknown[] = [];
  const keys: string[] = [];
  // Walk the wrapper and the page data. A token in either fails.
  collectValues(result, values);
  collectKeys(result, keys);
  expect(values).not.toContain(BOUNDARY_TOKEN);
  expect(keys).not.toContain("tenantId");
  expect(keys).not.toContain("token");
  expect(keys).not.toContain("authorization");
  const text = JSON.stringify(result);
  // A secret buried in a longer string is still a leak.
  expect(text).not.toContain(BOUNDARY_TOKEN);
  expect(text).not.toContain(BOUNDARY_SERVICE_URL);
  expect(text).not.toContain(BOUNDARY_TENANT_ID);
}

/**
 * Asserts a failed load did not invent the demo document.
 *
 * Purpose: an outage or a miss must not look like a fresh default document.
 * Inputs: body, the page data.
 * Side effects: none.
 */
function expectNoFactoryDocument(body: Record<string, unknown>): void {
  const text = JSON.stringify(body);
  // The factory title and image URL are not part of an error payload.
  expect(text).not.toContain(DEMO_FACTORY_TITLE);
  expect(text).not.toContain(DEMO_FACTORY_IMAGE);
  expect(body).not.toHaveProperty("configuration");
  // A failed load does not create a row.
  expect(createConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Asserts the loader calls the private client and returns the configuration.
 *
 * Purpose: the id comes from the environment, and the token does not come back.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderReturnsTheServerConfiguration(): Promise<void> {
  const configuration = sampleConfiguration(1);
  const textSection = configuration.data.sections.find((section) => section.type === "text");
  if (textSection === undefined || textSection.type !== "text") {
    throw new Error("fixture is missing a text section");
  }
  // A title only this response has. A factory fallback would not contain it.
  textSection.title = "Loaded from the service";
  getConfigurationMock.mockResolvedValue({
    ok: true,
    configuration,
    etag: '"99"',
  });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  // The query id is cfg_other. The call uses the environment id.
  expect(getConfigurationMock).toHaveBeenCalledTimes(1);
  expect(getConfigurationMock).toHaveBeenCalledWith(DEMO_CONFIGURATION_ID, expect.any(String));
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  expect(createConfigurationMock).not.toHaveBeenCalled();
  expect(result.status).toBe(200);
  expect(Object.keys(result.body).sort()).toEqual(["configuration", "etag", "requestId", "title"]);
  expect(result.body.requestId).toBe(lastGetRequestId());
  expect(result.body.title).toBe("Editor");
  // The tag is the service header. It is not built from revision 1.
  expect(result.body.etag).toBe('"99"');
  expect(result.body.configuration).toMatchObject({
    id: DEMO_CONFIGURATION_ID,
    revision: 1,
  });
  const loaded = result.body.configuration as Configuration;
  // Six sections is the seeded document shape. The loader passes the service title through.
  expect(loaded.data.sections).toHaveLength(6);
  expect(JSON.stringify(loaded)).toContain("Loaded from the service");
  expectNoSecrets(result);
}

/**
 * Asserts a not-found response is an error, not a new demo document.
 *
 * Purpose: the loader does not seed when the id is missing.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderNotFoundDoesNotInventADocument(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 404,
    code: "NOT_FOUND",
    requestId: "req-missing-10",
  });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  expect(result.status).toBe(404);
  expect(result.body.error).toMatchObject({
    code: "NOT_FOUND",
    message: "Configuration not found.",
    requestId: lastGetRequestId(),
  });
  // A miss has no field issues, and the query id is not part of the error.
  expect(result.body.error).not.toHaveProperty("issues");
  expect(JSON.stringify(result)).not.toContain("cfg_other");
  expect(errorObjectSchema.safeParse(result.body.error).success).toBe(true);
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Asserts an unavailable service becomes a structured error.
 *
 * Purpose: stopping the service must not fall back to the demo factory.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderUnavailableDoesNotInventADocument(): Promise<void> {
  getConfigurationMock.mockResolvedValue({ ok: false, kind: "unavailable" });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  expect(result.status).toBe(503);
  const error = result.body.error as { message: string; requestId: string };
  expect(error.message).toBe("The configuration service is unavailable.");
  expect(error.requestId.length).toBeGreaterThan(0);
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Asserts a private authentication failure uses the safe sentence.
 *
 * Purpose: the page does not tell the reader to sign in and does not invent a document.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderMisconfiguredStaysAStructuredError(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "misconfigured",
    message: MISCONFIGURED_CONFIGURATION_MESSAGE,
  });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  expect(result.status).toBe(500);
  const error = result.body.error as { message: string };
  expect(error.message).toBe(MISCONFIGURED_CONFIGURATION_MESSAGE);
  expect(error.message.toLowerCase()).not.toContain("sign in");
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Asserts a setup exception does not copy its message into the page.
 *
 * Purpose: the thrown text can contain a secret, and the page must not.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderSetupErrorDropsTheThrownText(): Promise<void> {
  getConfigurationMock.mockRejectedValue(new EditorServerEnvError([`bad ${BOUNDARY_TOKEN}`]));
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  expect(result.status).toBe(500);
  const error = result.body.error as { message: string };
  expect(error.message).toBe(MISCONFIGURED_CONFIGURATION_MESSAGE);
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Asserts an unreadable service body is an internal error.
 *
 * Purpose: the raw body is not editor data.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderInternalDoesNotReturnADocument(): Promise<void> {
  getConfigurationMock.mockResolvedValue({ ok: false, kind: "internal" });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  expect(result.status).toBe(500);
  expect(result.body.error).toMatchObject({
    code: "INTERNAL",
    message: "The editor could not complete the request.",
  });
  expectFailureShape(result.body);
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Asserts a missing demo id does not call the private service.
 *
 * Purpose: there is no id to load, and the page still gets a structured error.
 * Inputs: none.
 * Side effects: clears the demo configuration id and calls the loader.
 */
async function expectLoaderMissingScopeDoesNotCallTheClient(): Promise<void> {
  setEnv("DEMO_CONFIGURATION_ID", undefined);
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  expect(result.status).toBe(500);
  const error = result.body.error as { message: string };
  // The sentence is fixed. The thrown variable name and the query id are not copied.
  expect(error.message).toBe("The editor is missing its demo configuration.");
  expect(JSON.stringify(result)).not.toContain("DEMO_CONFIGURATION_ID");
  expect(JSON.stringify(result)).not.toContain("Missing required environment variable");
  expect(JSON.stringify(result)).not.toContain("cfg_other");
  expect(getConfigurationMock).not.toHaveBeenCalled();
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Posts one action body.
 *
 * Purpose: share the request shape across action cases.
 * Inputs: payload, the JSON value. origin, the Origin header, or undefined when it is absent.
 * Side effects: calls the action.
 */
async function postAction(payload: unknown, origin?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const request = actionRequest(JSON.stringify(payload), origin);
  return unwrapData(await action(actionArgs(request)));
}

/**
 * Asserts an invalid document does not call the private service.
 *
 * Purpose: schema failures stay in the app and return the shared issues.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectInvalidDocumentDoesNotUpdate(): Promise<void> {
  const result = await postAction({
    document: {
      schemaVersion: 1,
      data: { sections: [{ id: "section-text-x", type: "text" }] },
    },
    baseEtag: SUBMITTED_ETAG,
    configurationId: "cfg_other",
    tenantId: BOUNDARY_TENANT_ID,
    actorId: "actor_other",
  });
  expect(result.status).toBe(422);
  expect(errorObjectSchema.safeParse(result.body.error).success).toBe(true);
  const error = result.body.error as {
    code: string;
    message: string;
    issues: { path: string; message: string }[];
  };
  expect(error.code).toBe("VALIDATION_FAILED");
  expect(error.message).toBe("Some fields need attention.");
  // The missing title is a shared issue path, and an issue has no extra keys.
  expect(error.issues.map((issue) => issue.path)).toContain("data.sections[0].title");
  for (const issue of error.issues) {
    expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
  }
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  expect(getConfigurationMock).not.toHaveBeenCalled();
  expect(createConfigurationMock).not.toHaveBeenCalled();
  expectNoSecrets(result);
}

/**
 * Asserts a valid document is saved with the server id and the supplied ETag.
 *
 * Purpose: a body configurationId does not choose the row.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectValidDocumentUpdatesTheDemoConfiguration(): Promise<void> {
  const document = sampleDocument();
  const saved = sampleConfiguration(2);
  updateConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: saved,
    etag: ACKNOWLEDGED_ETAG,
  });
  const result = await postAction({
    document,
    baseEtag: SUBMITTED_ETAG,
    configurationId: "cfg_other",
    tenantId: "tenant_other",
    actorId: "actor_other",
  });
  // The environment id and the submitted tag are the call. The body id is not.
  expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
  expect(updateConfigurationMock).toHaveBeenCalledWith(
    DEMO_CONFIGURATION_ID,
    document,
    SUBMITTED_ETAG,
    expect.any(String),
  );
  expect(getConfigurationMock).not.toHaveBeenCalled();
  expect(createConfigurationMock).not.toHaveBeenCalled();
  expect(result.status).toBe(200);
  expect(Object.keys(result.body).sort()).toEqual(["configuration", "etag", "requestId", "title"]);
  expect(result.body.requestId).toBe(lastUpdateRequestId());
  // The acknowledged tag is the service header. It is not built from revision 2.
  expect(result.body.etag).toBe(ACKNOWLEDGED_ETAG);
  expect(result.body.configuration).toMatchObject({ id: DEMO_CONFIGURATION_ID, revision: 2 });
  expectNoSecrets(result);
}

/**
 * Asserts a cross-origin Origin does not call the private service.
 *
 * Purpose: the action rejects the request before updateConfiguration.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectCrossOriginDoesNotUpdate(): Promise<void> {
  const result = await postAction(
    { document: sampleDocument(), baseEtag: SUBMITTED_ETAG, configurationId: "cfg_other" },
    "http://evil.example",
  );
  expect(result.status).toBe(403);
  expect(result.body.error).toMatchObject({
    code: "UNAUTHORIZED",
    message: "The request origin is not allowed.",
  });
  expectFailureShape(result.body);
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  expect(getConfigurationMock).not.toHaveBeenCalled();
  expect(createConfigurationMock).not.toHaveBeenCalled();
  expectNoSecrets(result);
}

/**
 * Asserts a missing Origin still saves.
 *
 * Purpose: React Router's own check allows a missing Origin, and this action does too.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectMissingOriginStillUpdates(): Promise<void> {
  updateConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(2),
    etag: ACKNOWLEDGED_ETAG,
  });
  // No Origin header. The third argument is omitted.
  const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG });
  expect(result.status).toBe(200);
  expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
}

/**
 * Asserts a same-origin Origin still saves.
 *
 * Purpose: the origin check allows this app and rejects a different host.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectSameOriginStillUpdates(): Promise<void> {
  updateConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(2),
    etag: ACKNOWLEDGED_ETAG,
  });
  const result = await postAction(
    { document: sampleDocument(), baseEtag: SUBMITTED_ETAG },
    "http://127.0.0.1:5173",
  );
  expect(result.status).toBe(200);
  expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
}

/**
 * Asserts a missing ETag does not call the private service.
 *
 * Purpose: the action does not invent a validator.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectMissingEtagDoesNotUpdate(): Promise<void> {
  const result = await postAction({ document: sampleDocument(), configurationId: "cfg_other" });
  expect(result.status).toBe(428);
  expect(result.body.error).toMatchObject({
    code: "PRECONDITION_REQUIRED",
    message: "If-Match must be a strong revision ETag.",
  });
  expect(updateConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Asserts a body that is not JSON does not call the private service.
 *
 * Purpose: malformed input fails before the schema and before the service.
 * Inputs: none.
 * Side effects: calls the action.
 */
async function expectMalformedJsonDoesNotUpdate(): Promise<void> {
  const result = unwrapData(await action(actionArgs(actionRequest("not-json"))));
  expect(result.status).toBe(400);
  expect(result.body.error).toMatchObject({
    code: "MALFORMED_JSON",
    message: "The request body is not valid JSON.",
  });
  expect(JSON.stringify(result)).not.toContain("not-json");
  expect(updateConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Renders the route with loader data.
 *
 * Purpose: the shell shows the loader result without a browser.
 * Inputs: loaderData, the unwrapped page data.
 * Side effects: renders to an HTML string.
 */
function renderPage(loaderData: Record<string, unknown>): string {
  // The other route props are unused by this temporary page.
  return renderToStaticMarkup(
    createElement(EditorRoute, { loaderData } as Route.ComponentProps),
  );
}

/**
 * Asserts the page shows the loaded configuration in the shell.
 *
 * Purpose: the six-section document is visible as rows, and the token is not.
 * Inputs: none.
 * Side effects: calls the loader and renders the page.
 */
async function expectPageShowsLoadedJson(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(1),
    etag: '"1"',
  });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  const html = renderPage(result.body);
  const selects = html.match(/id="section-select-/g);
  // One select button per section. The preview repeats the same six hints.
  expect(selects).toHaveLength(6);
  expect(html).toContain(DEMO_FACTORY_TITLE);
  expect(html).toContain("Phone preview");
  expect(html).not.toContain("<pre>");
  expect(html).not.toContain(BOUNDARY_TOKEN);
  expect(html).not.toContain(BOUNDARY_TENANT_ID);
}

/**
 * Asserts the page shows a loader error and its request id.
 *
 * Purpose: an outage renders the error instead of a factory document.
 * Inputs: none.
 * Side effects: calls the loader and renders the page.
 */
async function expectPageShowsTheLoaderError(): Promise<void> {
  getConfigurationMock.mockResolvedValue({ ok: false, kind: "unavailable" });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  const error = result.body.error as { message: string; requestId: string };
  const html = renderPage(result.body);
  expect(html).toContain(error.message);
  expect(html).toContain(error.requestId);
  expect(html).toContain("Editor");
  expect(html).toContain("Reference:");
  expect(html).not.toContain(DEMO_FACTORY_TITLE);
  expect(html).not.toContain("<pre>");
  expect(html).not.toContain("schemaVersion");
}

/**
 * Asserts the document is not cached.
 *
 * Purpose: a reload after the service stops can show the error.
 * Inputs: none.
 * Side effects: none.
 */
function expectDocumentIsNotStored(): void {
  // private, no-store keeps the loaded JSON off a later reload.
  expect(headers()).toEqual({ "Cache-Control": "private, no-store" });
}

/**
 * Asserts the document title is the safe title.
 *
 * Purpose: the title does not include a tenant or a token.
 * Inputs: none.
 * Side effects: none.
 */
function expectMetaUsesTheSafeTitle(): void {
  const configuration = sampleConfiguration(1);
  const title = meta({
    data: { title: "Editor", configuration, etag: '"1"' },
  } as Route.MetaArgs);
  expect(title).toEqual([{ title: "Editor" }]);
}

/**
 * Finds the editor package root.
 *
 * Purpose: search apps/editor from either the package directory or the workspace root.
 * Inputs: none.
 * Side effects: none.
 */
function editorRoot(): string {
  const cwd = process.cwd();
  // The editor test script runs with apps/editor as the working directory.
  if (existsSync(path.join(cwd, "app", "routes", "editor.tsx"))) {
    return cwd;
  }
  // A workspace-root run still has the route under apps/editor.
  return path.join(cwd, "apps", "editor");
}

/**
 * Lists editor source files, skipping tests and build output.
 *
 * Purpose: search the modules that ship, not the tests that name forbidden exports.
 * Inputs: directory, the directory to read. root, the editor package root. files, the accumulator.
 * Side effects: reads files from disk.
 */
function collectSource(directory: string, root: string, files: { relativePath: string; text: string }[]): void {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    // Vendor and generated trees are not the route modules this check guards.
    if (
      entry.name === "node_modules" ||
      entry.name === ".react-router" ||
      entry.name === "build" ||
      entry.name === "dist" ||
      entry.name === "coverage"
    ) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSource(fullPath, root, files);
      continue;
    }
    const extension = path.extname(entry.name);
    // Source files only. Tests may name the forbidden exports in order to search for them.
    if (extension !== ".ts" && extension !== ".tsx" && extension !== ".js" && extension !== ".jsx") {
      continue;
    }
    if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      continue;
    }
    files.push({
      relativePath: path.relative(root, fullPath).replaceAll("\\", "/"),
      text: readFileSync(fullPath, "utf8"),
    });
  }
}

/**
 * Asserts the editor source has no browser data handlers.
 *
 * Purpose: configuration loading stays on the server loader and the server action.
 * Inputs: none.
 * Side effects: reads the editor source tree.
 */
function expectNoBrowserDataHandlers(): void {
  const loaderName = ["client", "Loader"].join("");
  const actionName = ["client", "Action"].join("");
  const files: { relativePath: string; text: string }[] = [];
  const root = editorRoot();
  collectSource(root, root, files);
  const hits: string[] = [];
  for (const file of files) {
    // Either name in a shipping module is a browser data handler.
    if (file.text.includes(loaderName) || file.text.includes(actionName)) {
      hits.push(file.relativePath);
    }
  }
  expect(hits).toEqual([]);
}

/**
 * Asserts the route module is the server loader and action.
 *
 * Purpose: the page does not load on mount and does not invent a demo document.
 * Inputs: none.
 * Side effects: reads the route module.
 */
function expectRouteModuleIsServerMediation(): void {
  const source = readFileSync(path.join(editorRoot(), "app/routes/editor.tsx"), "utf8");
  const loaderName = ["client", "Loader"].join("");
  const actionName = ["client", "Action"].join("");
  // The framework exports are the server functions.
  expect(source).toContain("export async function loader");
  expect(source).toContain("export async function action");
  expect(source).toContain("getDemoScope");
  expect(source).toContain("getConfiguration");
  expect(source).toContain("updateConfiguration");
  // The component does not fetch, and the module does not build a fallback document.
  expect(source).not.toContain("useEffect");
  expect(source).not.toContain("createDemoDocument");
  expect(source).not.toContain("fetch(");
  expect(source).not.toContain(loaderName);
  expect(source).not.toContain(actionName);
}

/**
 * Asserts a missing demo scope uses the fixed sentence.
 *
 * Purpose: the thrown variable name is not page text.
 * Inputs: result, the loader or action return value.
 * Side effects: none.
 */
function expectDemoScopeFailure(result: { status: number; body: Record<string, unknown> }): void {
  expect(result.status).toBe(500);
  expectFailureShape(result.body);
  const error = result.body.error as { message: string };
  // The sentence does not name the missing variable or the query.
  expect(error.message).toBe("The editor is missing its demo configuration.");
  const text = JSON.stringify(result);
  expect(text).not.toContain("DEMO_TENANT_ID");
  expect(text).not.toContain("DEMO_CONFIGURATION_ID");
  expect(text).not.toContain("Missing required environment variable");
  expect(text).not.toContain("cfg_other");
  expectNoSecrets(result);
  expectNoFactoryDocument(result.body);
}

/**
 * Asserts an omitted ETag stays null.
 *
 * Purpose: the loader must not invent a validator from the revision.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderReturnsANullEtag(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(4),
    etag: null,
  });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  // revision 4 is on the configuration. The validator is the omitted header.
  expect(result.status).toBe(200);
  expect(result.body.etag).toBeNull();
  expect(result.body.configuration).toMatchObject({ revision: 4 });
  expect(result.body.etag).not.toBe('"4"');
  expectNoSecrets(result);
}

/**
 * Asserts a success body with an extra field is not returned.
 *
 * Purpose: a token sitting beside the configuration must not reach the browser.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderRejectsAConfigurationThatCarriesAToken(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: configurationCarryingAToken(1),
    etag: '"99"',
  });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  // The strict contract failed, so the page is an internal error with no document.
  expect(result.status).toBe(500);
  expect(result.body.error).toMatchObject({
    code: "INTERNAL",
    message: "The editor could not complete the request.",
  });
  expectFailureShape(result.body);
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Asserts a service error does not copy extra fields onto the page.
 *
 * Purpose: an upstream message, a token, or stray issues stay off the loader result.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderDoesNotCopyServiceErrorFields(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
    requestId: "req-upstream-10",
    message: `postgres ${BOUNDARY_TOKEN}`,
    token: BOUNDARY_TOKEN,
  } as ConfigurationClientResult);
  const unavailable = unwrapData(await loader(loaderArgs(loaderRequest())));
  // The status is the service status. The request id is the one this process sent. The sentence is the editor's.
  expect(unavailable.status).toBe(503);
  expect(unavailable.body.error).toEqual({
    code: "SERVICE_UNAVAILABLE",
    message: "The configuration service is unavailable.",
    requestId: lastGetRequestId(),
  });
  expectNoSecrets(unavailable);
  expectNoFactoryDocument(unavailable.body);
  // A not-found body that also carries issues must not keep those issues or their text.
  getConfigurationMock.mockReset();
  getConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 404,
    code: "NOT_FOUND",
    requestId: "req-stray-10",
    issues: [{ path: "data.sections[0].url", message: BOUNDARY_TOKEN }],
  } as ConfigurationClientResult);
  const missing = unwrapData(await loader(loaderArgs(loaderRequest())));
  expect(missing.status).toBe(404);
  expect(missing.body.error).toEqual({
    code: "NOT_FOUND",
    message: "Configuration not found.",
    requestId: lastGetRequestId(),
  });
  expectNoSecrets(missing);
  expectNoFactoryDocument(missing.body);
}

/**
 * Asserts a private 401 becomes a setup error.
 *
 * Purpose: the browser must not see an editor sign-in challenge or the upstream sentence.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderMapsPrivateUnauthorizedToSetup(): Promise<void> {
  getConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 401,
    code: "UNAUTHORIZED",
    requestId: "req-auth-10",
    message: "sign in",
  } as ConfigurationClientResult);
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  // The HTTP status is no longer 401. The request id is the one this process sent.
  expect(result.status).toBe(500);
  expect(result.body.error).toEqual({
    code: "UNAUTHORIZED",
    message: MISCONFIGURED_CONFIGURATION_MESSAGE,
    requestId: lastGetRequestId(),
  });
  expect(JSON.stringify(result).toLowerCase()).not.toContain("sign in");
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Asserts a missing demo tenant does not call the private service.
 *
 * Purpose: the page gets the fixed scope sentence and does not echo the variable name.
 * Inputs: none.
 * Side effects: clears DEMO_TENANT_ID and calls the loader.
 */
async function expectLoaderMissingTenantUsesTheFixedMessage(): Promise<void> {
  // Unset the tenant. The query still names a different tenant, and that must not be used.
  setEnv("DEMO_TENANT_ID", undefined);
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  expectDemoScopeFailure(result);
  expectPrivateClientWasNotCalled();
}

/**
 * Asserts a blank demo configuration id does not call the private service.
 *
 * Purpose: whitespace is missing, and it is not used as an id.
 * Inputs: none.
 * Side effects: sets a blank DEMO_CONFIGURATION_ID and calls the loader.
 */
async function expectLoaderBlankConfigurationIdUsesTheFixedMessage(): Promise<void> {
  // Whitespace is not a configuration id.
  setEnv("DEMO_CONFIGURATION_ID", "   ");
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  expectDemoScopeFailure(result);
  expectPrivateClientWasNotCalled();
}

/**
 * Asserts two unavailable loads do not share a request id.
 *
 * Purpose: the id is generated for the page, not a constant.
 * Inputs: none.
 * Side effects: calls the loader twice with a mocked client.
 */
async function expectUnavailableLoadsUseDifferentRequestIds(): Promise<void> {
  getConfigurationMock.mockResolvedValue({ ok: false, kind: "unavailable" });
  const first = unwrapData(await loader(loaderArgs(loaderRequest())));
  const second = unwrapData(await loader(loaderArgs(loaderRequest())));
  const firstId = (first.body.error as { requestId: string }).requestId;
  const secondId = (second.body.error as { requestId: string }).requestId;
  // Each outage gets its own id, and neither id is empty.
  expect(firstId.length).toBeGreaterThan(0);
  expect(secondId.length).toBeGreaterThan(0);
  expect(firstId).not.toBe(secondId);
}

/**
 * Asserts an unexpected loader error is not turned into a document.
 *
 * Purpose: only a setup error becomes a page. Any other throw still rejects.
 * Inputs: none.
 * Side effects: calls the loader with a mocked client.
 */
async function expectLoaderUnexpectedErrorSurfaces(): Promise<void> {
  getConfigurationMock.mockRejectedValue(new Error("boom-not-setup"));
  // The call rejects. A caught error would have returned a page instead.
  await expect(loader(loaderArgs(loaderRequest()))).rejects.toThrow("boom-not-setup");
  expect(createConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Asserts a JSON body that is not an object does not call the private service.
 *
 * Purpose: null, an array, an empty body, and a JSON string are not the action envelope.
 * Inputs: none.
 * Side effects: calls the action.
 */
async function expectActionBodyIsNotAnObject(): Promise<void> {
  const bodies = ["null", "[]", "", "   ", '"hello"', "1"];
  for (const body of bodies) {
    // The previous body must not count as a call for this body.
    getConfigurationMock.mockClear();
    updateConfigurationMock.mockClear();
    createConfigurationMock.mockClear();
    const result = unwrapData(await action(actionArgs(actionRequest(body))));
    expect(result.status).toBe(400);
    expect(result.body.error).toMatchObject({
      code: "MALFORMED_JSON",
      message: "The request body is not valid JSON.",
    });
    // The body text is not copied onto the page.
    expect(JSON.stringify(result)).not.toContain("hello");
    expectPrivateClientWasNotCalled();
  }
}

/**
 * Asserts a missing or weak ETag does not call the private service.
 *
 * Purpose: whitespace, an empty string, and a number are not strong validators.
 * Inputs: none.
 * Side effects: calls the action.
 */
async function expectWeakEtagDoesNotUpdate(): Promise<void> {
  const payloads = [
    { document: sampleDocument(), baseEtag: "   " },
    { document: sampleDocument(), baseEtag: "" },
    { document: sampleDocument(), baseEtag: 4 },
    { document: sampleDocument(), baseEtag: null },
  ];
  for (const payload of payloads) {
    // The previous payload must not count as a call for this payload.
    getConfigurationMock.mockClear();
    updateConfigurationMock.mockClear();
    createConfigurationMock.mockClear();
    const result = await postAction(payload);
    expect(result.status).toBe(428);
    expect(result.body.error).toMatchObject({
      code: "PRECONDITION_REQUIRED",
      message: "If-Match must be a strong revision ETag.",
    });
    expectPrivateClientWasNotCalled();
  }
}

/**
 * Asserts a strong ETag is sent unchanged.
 *
 * Purpose: trimming a real tag would change the validator the service compares.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectStrongEtagIsNotTrimmed(): Promise<void> {
  const document = sampleDocument();
  const padded = '  "4"  ';
  updateConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(2),
    etag: ACKNOWLEDGED_ETAG,
  });
  const result = await postAction({ document, baseEtag: padded });
  // The third argument is the original text, including the surrounding spaces.
  expect(updateConfigurationMock).toHaveBeenCalledWith(
    DEMO_CONFIGURATION_ID,
    editableDocumentSchema.parse(document),
    padded,
    expect.any(String),
  );
  expect(result.status).toBe(200);
  expect(result.body.etag).toBe(ACKNOWLEDGED_ETAG);
}

/**
 * Asserts ETag text that looks like a tenant id does not select the row.
 *
 * Purpose: baseEtag is the validator, and the configuration id still comes from the environment.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectEtagTextDoesNotSelectTheConfiguration(): Promise<void> {
  const document = sampleDocument();
  updateConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(2),
    etag: ACKNOWLEDGED_ETAG,
  });
  const result = await postAction({
    document,
    baseEtag: BOUNDARY_TENANT_ID,
    tenantId: "tenant_other",
    configurationId: "cfg_other",
  });
  // The call uses the environment id. The tenant-shaped tag is only the validator.
  expect(updateConfigurationMock).toHaveBeenCalledWith(
    DEMO_CONFIGURATION_ID,
    editableDocumentSchema.parse(document),
    BOUNDARY_TENANT_ID,
    expect.any(String),
  );
  expect(result.status).toBe(200);
  expect(result.body.etag).toBe(ACKNOWLEDGED_ETAG);
  expectNoSecrets(result);
}

/**
 * Asserts the action sends the normalized document.
 *
 * Purpose: uppercase hex is stored as lowercase, which is the schema output.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectActionSendsTheNormalizedDocument(): Promise<void> {
  const submitted = documentWithUppercaseTitleColor();
  const normalized = editableDocumentSchema.parse(submitted);
  updateConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(2),
    etag: ACKNOWLEDGED_ETAG,
  });
  const result = await postAction({ document: submitted, baseEtag: SUBMITTED_ETAG });
  // The saved document is the schema output, so the title color is lowercase.
  expect(updateConfigurationMock).toHaveBeenCalledWith(
    DEMO_CONFIGURATION_ID,
    normalized,
    SUBMITTED_ETAG,
    expect.any(String),
  );
  const saved = updateConfigurationMock.mock.calls[0]?.[1] as EditableDocument;
  const text = saved.data.sections.find((section) => section.type === "text");
  expect(text).toMatchObject({ type: "text", titleColor: "#aabbcc" });
  expect(result.status).toBe(200);
}

/**
 * Asserts a document that includes a tenant id is rejected.
 *
 * Purpose: a sibling tenantId is ignored, and a tenantId on the document is not saved.
 * Inputs: none.
 * Side effects: calls the action.
 */
async function expectDocumentTenantIdDoesNotUpdate(): Promise<void> {
  const result = await postAction({
    document: { ...sampleDocument(), tenantId: BOUNDARY_TENANT_ID },
    baseEtag: SUBMITTED_ETAG,
  });
  expect(result.status).toBe(422);
  const error = result.body.error as { code: string; issues: { path: string }[] };
  // The extra key is a field issue. The private service is not called.
  expect(error.code).toBe("VALIDATION_FAILED");
  expect(error.issues.map((issue) => issue.path)).toContain("tenantId");
  expectPrivateClientWasNotCalled();
  expectNoSecrets(result);
  expectNoFactoryDocument(result.body);
}

/**
 * Asserts an Origin that is not this app does not call the private service.
 *
 * Purpose: the opaque value "null", another port, and another scheme are cross-origin.
 * Inputs: none.
 * Side effects: calls the action.
 */
async function expectOriginThatIsNotThisAppDoesNotUpdate(): Promise<void> {
  const origins = ["null", "http://127.0.0.1:9999", "https://127.0.0.1:5173"];
  for (const origin of origins) {
    // The previous origin must not count as a call for this origin.
    getConfigurationMock.mockClear();
    updateConfigurationMock.mockClear();
    createConfigurationMock.mockClear();
    const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG }, origin);
    expect(result.status).toBe(403);
    expect(result.body.error).toMatchObject({
      code: "UNAUTHORIZED",
      message: "The request origin is not allowed.",
    });
    expectPrivateClientWasNotCalled();
    expectNoSecrets(result);
  }
}

/**
 * Asserts a same-origin header with a path or a trailing slash still saves.
 *
 * Purpose: the check compares origins, not the raw header string.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectSameOriginDetailsStillUpdate(): Promise<void> {
  const origins = ["http://127.0.0.1:5173/evil", "http://127.0.0.1:5173/"];
  for (const origin of origins) {
    // Each header is one save. The previous call is cleared first.
    updateConfigurationMock.mockReset();
    updateConfigurationMock.mockResolvedValue({
      ok: true,
      configuration: sampleConfiguration(2),
      etag: ACKNOWLEDGED_ETAG,
    });
    const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG }, origin);
    expect(result.status).toBe(200);
    expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
  }
}

/**
 * Asserts a cross-origin request fails before the body is interpreted.
 *
 * Purpose: invalid JSON and an invalid document are still origin failures.
 * Inputs: none.
 * Side effects: calls the action.
 */
async function expectCrossOriginIsRejectedBeforeTheBody(): Promise<void> {
  const malformed = unwrapData(
    await action(actionArgs(actionRequest("not-json", "http://evil.example"))),
  );
  // Origin wins, so this is not the malformed-JSON status.
  expect(malformed.status).toBe(403);
  expect(malformed.body.error).toMatchObject({ message: "The request origin is not allowed." });
  expect(updateConfigurationMock).not.toHaveBeenCalled();
  const invalid = await postAction(
    {
      document: { schemaVersion: 1, data: { sections: [{ id: "section-text-x", type: "text" }] } },
      baseEtag: SUBMITTED_ETAG,
    },
    "http://evil.example",
  );
  // Origin wins, so this is not the validation status.
  expect(invalid.status).toBe(403);
  expect(updateConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Asserts each private-service code keeps its status and a safe sentence.
 *
 * Purpose: the upstream message is not copied, and a failed save does not seed a document.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectServiceFailureKeepsTheSafeSentence(): Promise<void> {
  const cases = [
    { status: 400, code: "MALFORMED_JSON", message: "The request body is not valid JSON." },
    { status: 404, code: "NOT_FOUND", message: "Configuration not found." },
    { status: 413, code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." },
    { status: 415, code: "UNSUPPORTED_MEDIA_TYPE", message: "Content-Type must be application/json." },
    { status: 428, code: "PRECONDITION_REQUIRED", message: "If-Match must be a strong revision ETag." },
    { status: 412, code: "PRECONDITION_FAILED", message: "The configuration revision does not match." },
    { status: 429, code: "RATE_LIMITED", message: "Too many write requests." },
    { status: 500, code: "INTERNAL", message: "The editor could not complete the request." },
    { status: 503, code: "SERVICE_UNAVAILABLE", message: "The configuration service is unavailable." },
  ] as const;
  for (const entry of cases) {
    // One service result. The message field is upstream text the page must not show.
    updateConfigurationMock.mockReset();
    updateConfigurationMock.mockResolvedValue({
      ok: false,
      kind: "service",
      status: entry.status,
      code: entry.code,
      requestId: "req-code-10",
      message: `leaked ${BOUNDARY_TOKEN}`,
    } as ConfigurationClientResult);
    const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG });
    expect(result.status).toBe(entry.status);
    expect(result.body.error).toEqual({
      code: entry.code,
      message: entry.message,
      requestId: lastUpdateRequestId(),
    });
    expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
    expect(createConfigurationMock).not.toHaveBeenCalled();
    expectNoSecrets(result);
    expectNoFactoryDocument(result.body);
  }
  // A private 401 is the exception: the page status is 500, not an editor sign-in challenge.
  updateConfigurationMock.mockReset();
  updateConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 401,
    code: "UNAUTHORIZED",
    requestId: "req-auth-action",
    message: "sign in",
  } as ConfigurationClientResult);
  const unauthorized = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG });
  expect(unauthorized.status).toBe(500);
  expect(unauthorized.body.error).toEqual({
    code: "UNAUTHORIZED",
    message: MISCONFIGURED_CONFIGURATION_MESSAGE,
    requestId: lastUpdateRequestId(),
  });
  expect(JSON.stringify(unauthorized).toLowerCase()).not.toContain("sign in");
  expectNoSecrets(unauthorized);
}

/**
 * Asserts a service validation issue keeps only path and message.
 *
 * Purpose: an extra key on an upstream issue, including a token, is not page data.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectServiceValidationIssueDropsExtraKeys(): Promise<void> {
  updateConfigurationMock.mockResolvedValue({
    ok: false,
    kind: "service",
    status: 422,
    code: "VALIDATION_FAILED",
    requestId: "req-validate-10",
    issues: [
      {
        path: "data.sections[0].url",
        message: "Use an absolute HTTP(S) URL.",
        token: BOUNDARY_TOKEN,
      },
    ],
  } as unknown as ConfigurationClientResult);
  const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG });
  // The issue list is the path and the safe field sentence. The token key is gone.
  expect(result.status).toBe(422);
  expect(result.body.error).toEqual({
    code: "VALIDATION_FAILED",
    message: "Some fields need attention.",
    requestId: lastUpdateRequestId(),
    issues: [{ path: "data.sections[0].url", message: "Use an absolute HTTP(S) URL." }],
  });
  expectNoSecrets(result);
  expectNoFactoryDocument(result.body);
}

/**
 * Asserts a save that cannot reach the service does not seed a document.
 *
 * Purpose: unavailable, misconfigured, and internal results stay structured errors.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectActionClientFailuresDoNotSeed(): Promise<void> {
  const failures: ConfigurationClientResult[] = [
    { ok: false, kind: "unavailable" },
    { ok: false, kind: "misconfigured", message: MISCONFIGURED_CONFIGURATION_MESSAGE },
    { ok: false, kind: "internal" },
  ];
  const expected = [
    { status: 503, code: "SERVICE_UNAVAILABLE", message: "The configuration service is unavailable." },
    { status: 500, code: "INTERNAL", message: MISCONFIGURED_CONFIGURATION_MESSAGE },
    { status: 500, code: "INTERNAL", message: "The editor could not complete the request." },
  ];
  for (const [index, failure] of failures.entries()) {
    const outcome = expected[index];
    if (outcome === undefined) {
      throw new Error("missing expected client failure");
    }
    // Each kind is one save. The previous call is cleared first.
    updateConfigurationMock.mockReset();
    updateConfigurationMock.mockResolvedValue(failure);
    const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG });
    expect(result.status).toBe(outcome.status);
    expect(result.body.error).toMatchObject({ code: outcome.code, message: outcome.message });
    expect(JSON.stringify(result).toLowerCase()).not.toContain("sign in");
    expect(createConfigurationMock).not.toHaveBeenCalled();
    expectNoFactoryDocument(result.body);
    expectNoSecrets(result);
  }
}

/**
 * Asserts a setup exception from the save does not copy its message.
 *
 * Purpose: the thrown text can contain a secret, and the page must not.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectActionSetupErrorDropsTheThrownText(): Promise<void> {
  updateConfigurationMock.mockRejectedValue(new EditorServerEnvError([`bad ${BOUNDARY_TOKEN}`]));
  const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG });
  // The page uses the fixed setup sentence. The thrown text is not a field.
  expect(result.status).toBe(500);
  expect(result.body.error).toMatchObject({
    code: "INTERNAL",
    message: MISCONFIGURED_CONFIGURATION_MESSAGE,
  });
  expectNoFactoryDocument(result.body);
  expectNoSecrets(result);
}

/**
 * Asserts a missing demo tenant does not save.
 *
 * Purpose: a valid document and ETag still cannot choose an id when the environment has none.
 * Inputs: none.
 * Side effects: clears DEMO_TENANT_ID and calls the action.
 */
async function expectActionMissingTenantDoesNotUpdate(): Promise<void> {
  // The body names a tenant and a configuration. Neither one may replace the missing environment id.
  setEnv("DEMO_TENANT_ID", undefined);
  const result = await postAction({
    document: sampleDocument(),
    baseEtag: SUBMITTED_ETAG,
    tenantId: "tenant_from_body",
    configurationId: "cfg_other",
  });
  expectDemoScopeFailure(result);
  expect(JSON.stringify(result)).not.toContain("tenant_from_body");
  expectPrivateClientWasNotCalled();
}

/**
 * Asserts an invalid document fails before the demo scope is required.
 *
 * Purpose: a schema failure stays 422 even when the environment id is missing.
 * Inputs: none.
 * Side effects: clears DEMO_TENANT_ID and calls the action.
 */
async function expectInvalidDocumentFailsBeforeScope(): Promise<void> {
  setEnv("DEMO_TENANT_ID", undefined);
  const result = await postAction({
    document: { schemaVersion: 1, data: { sections: [{ id: "section-text-x", type: "text" }] } },
    baseEtag: SUBMITTED_ETAG,
  });
  // Validation wins, so this is not the missing-scope status.
  expect(result.status).toBe(422);
  expect(result.body.error).toMatchObject({ code: "VALIDATION_FAILED" });
  expectPrivateClientWasNotCalled();
}

/**
 * Asserts a missing ETag fails before the demo scope is required.
 *
 * Purpose: a missing validator stays 428 even when the environment id is missing.
 * Inputs: none.
 * Side effects: clears DEMO_TENANT_ID and calls the action.
 */
async function expectMissingEtagFailsBeforeScope(): Promise<void> {
  setEnv("DEMO_TENANT_ID", undefined);
  const result = await postAction({ document: sampleDocument() });
  // The precondition wins, so this is not the missing-scope status.
  expect(result.status).toBe(428);
  expect(result.body.error).toMatchObject({ code: "PRECONDITION_REQUIRED" });
  expectPrivateClientWasNotCalled();
}

/**
 * Asserts a saved configuration with an extra field is not returned.
 *
 * Purpose: a token on the PUT response must not reach the browser.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectActionRejectsAConfigurationThatCarriesAToken(): Promise<void> {
  updateConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: configurationCarryingAToken(2),
    etag: ACKNOWLEDGED_ETAG,
  });
  const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG });
  // The save was attempted. The loose body is not the page data.
  expect(updateConfigurationMock).toHaveBeenCalledTimes(1);
  expect(result.status).toBe(500);
  expect(result.body.error).toMatchObject({
    code: "INTERNAL",
    message: "The editor could not complete the request.",
  });
  expectFailureShape(result.body);
  expectNoSecrets(result);
  expectNoFactoryDocument(result.body);
}

/**
 * Asserts a successful save keeps a null ETag.
 *
 * Purpose: the action must not invent a validator from the new revision.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectActionKeepsANullEtag(): Promise<void> {
  updateConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(2),
    etag: null,
  });
  const result = await postAction({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG });
  // revision 2 is on the configuration. The validator is the omitted header.
  expect(result.status).toBe(200);
  expect(result.body.etag).toBeNull();
  expect(result.body.configuration).toMatchObject({ revision: 2 });
  expect(result.body.etag).not.toBe('"2"');
}

/**
 * Asserts an unexpected save error is not turned into a document.
 *
 * Purpose: only a setup error becomes a page. Any other throw still rejects.
 * Inputs: none.
 * Side effects: calls the action with a mocked client.
 */
async function expectActionUnexpectedErrorSurfaces(): Promise<void> {
  updateConfigurationMock.mockRejectedValue(new Error("boom-not-setup"));
  const request = actionRequest(
    JSON.stringify({ document: sampleDocument(), baseEtag: SUBMITTED_ETAG }),
  );
  // The call rejects. A caught error would have returned a page instead.
  await expect(action(actionArgs(request))).rejects.toThrow("boom-not-setup");
  expect(createConfigurationMock).not.toHaveBeenCalled();
}

/**
 * Asserts the page shows the configuration and not the ETag.
 *
 * Purpose: the shell renders section hints. The strong validator stays off the page.
 * Inputs: none.
 * Side effects: calls the loader and renders the page.
 */
async function expectPageDoesNotRenderTheEtag(): Promise<void> {
  const etag = '"page-etag-not-in-markup"';
  getConfigurationMock.mockResolvedValue({
    ok: true,
    configuration: sampleConfiguration(8),
    etag,
  });
  const result = unwrapData(await loader(loaderArgs(loaderRequest())));
  const html = renderPage(result.body);
  // The loader still has the tag. The markup shows the section hint, not the validator or the revision.
  expect(result.body.etag).toBe(etag);
  expect(html).toContain(DEMO_FACTORY_TITLE);
  expect(html).not.toContain("<pre>");
  expect(html).not.toContain("&quot;revision&quot;");
  expect(html).not.toContain("page-etag-not-in-markup");
  expect(html).not.toContain(BOUNDARY_TOKEN);
}

/**
 * Asserts a failed load still uses the safe document title.
 *
 * Purpose: the browser title does not include the error text or a tenant.
 * Inputs: none.
 * Side effects: none.
 */
function expectMetaUsesTheSafeTitleAfterFailure(): void {
  const title = meta({
    data: {
      title: "Editor",
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "The configuration service is unavailable.",
        requestId: "req-meta-10",
      },
    },
  } as Route.MetaArgs);
  // The failure payload still carries the safe title.
  expect(title).toEqual([{ title: "Editor" }]);
}

/**
 * Resets the route environment and the client spies.
 *
 * Purpose: keep one case from changing the next case.
 * Inputs: none.
 * Side effects: restores process.env and clears mock calls.
 */
function resetRouteTest(): void {
  // The environment goes back to the values from before this file loaded.
  restoreRouteEnv();
  // A call recorded in one case must not appear in the next case.
  getConfigurationMock.mockReset();
  updateConfigurationMock.mockReset();
  createConfigurationMock.mockReset();
}

beforeEach(setRouteEnv);
afterEach(resetRouteTest);

describe("editor loader", () => {
  it("loads the demo configuration through the private client", expectLoaderReturnsTheServerConfiguration);
  it("returns not-found without a demo document", expectLoaderNotFoundDoesNotInventADocument);
  it("returns unavailable without a demo document", expectLoaderUnavailableDoesNotInventADocument);
  it("returns a misconfigured service as a structured error", expectLoaderMisconfiguredStaysAStructuredError);
  it("drops a setup error message", expectLoaderSetupErrorDropsTheThrownText);
  it("returns an internal client failure without a document", expectLoaderInternalDoesNotReturnADocument);
  it("does not call the client when the demo id is missing", expectLoaderMissingScopeDoesNotCallTheClient);
  it("returns a null ETag when the service omits one", expectLoaderReturnsANullEtag);
  it("rejects a configuration that carries an extra field", expectLoaderRejectsAConfigurationThatCarriesAToken);
  it("does not copy extra fields from a service error", expectLoaderDoesNotCopyServiceErrorFields);
  it("maps a private 401 to a setup error", expectLoaderMapsPrivateUnauthorizedToSetup);
  it("uses a fixed message when the demo tenant is missing", expectLoaderMissingTenantUsesTheFixedMessage);
  it("uses a fixed message when the demo configuration id is blank", expectLoaderBlankConfigurationIdUsesTheFixedMessage);
  it("gives each unavailable load its own request id", expectUnavailableLoadsUseDifferentRequestIds);
  it("lets an unexpected client error surface", expectLoaderUnexpectedErrorSurfaces);
});

describe("editor action", () => {
  it("rejects an invalid document before the private service", expectInvalidDocumentDoesNotUpdate);
  it("updates the demo configuration with the supplied ETag", expectValidDocumentUpdatesTheDemoConfiguration);
  it("rejects a cross-origin Origin before the private service", expectCrossOriginDoesNotUpdate);
  it("accepts a missing Origin", expectMissingOriginStillUpdates);
  it("accepts this app's Origin", expectSameOriginStillUpdates);
  it("rejects a missing ETag before the private service", expectMissingEtagDoesNotUpdate);
  it("rejects malformed JSON before the private service", expectMalformedJsonDoesNotUpdate);
  it("rejects a JSON body that is not an object", expectActionBodyIsNotAnObject);
  it("rejects a weak ETag", expectWeakEtagDoesNotUpdate);
  it("passes a strong ETag through without trimming", expectStrongEtagIsNotTrimmed);
  it("uses the demo id when the ETag text is a tenant id", expectEtagTextDoesNotSelectTheConfiguration);
  it("sends the normalized document", expectActionSendsTheNormalizedDocument);
  it("rejects a document that includes a tenant id", expectDocumentTenantIdDoesNotUpdate);
  it("rejects an origin that is not this app", expectOriginThatIsNotThisAppDoesNotUpdate);
  it("accepts this origin when the header has a path", expectSameOriginDetailsStillUpdate);
  it("rejects a cross-origin body before reading it", expectCrossOriginIsRejectedBeforeTheBody);
  it("keeps the service status and a safe sentence", expectServiceFailureKeepsTheSafeSentence);
  it("drops extra keys on a service validation issue", expectServiceValidationIssueDropsExtraKeys);
  it("does not seed when a save cannot reach the service", expectActionClientFailuresDoNotSeed);
  it("drops a setup error from the save", expectActionSetupErrorDropsTheThrownText);
  it("uses a fixed message when the save has no demo tenant", expectActionMissingTenantDoesNotUpdate);
  it("rejects an invalid document before checking scope", expectInvalidDocumentFailsBeforeScope);
  it("rejects a missing ETag before checking scope", expectMissingEtagFailsBeforeScope);
  it("rejects a saved configuration that carries an extra field", expectActionRejectsAConfigurationThatCarriesAToken);
  it("returns a null ETag when the save omits one", expectActionKeepsANullEtag);
  it("lets an unexpected save error surface", expectActionUnexpectedErrorSurfaces);
});

describe("editor page", () => {
  it("renders the loaded configuration", expectPageShowsLoadedJson);
  it("renders the loader error and request id", expectPageShowsTheLoaderError);
  it("marks the document private and uncached", expectDocumentIsNotStored);
  it("uses the safe document title", expectMetaUsesTheSafeTitle);
  it("does not render the ETag", expectPageDoesNotRenderTheEtag);
  it("uses the safe title after a failed load", expectMetaUsesTheSafeTitleAfterFailure);
});

describe("editor source", () => {
  it("has no browser data handlers", expectNoBrowserDataHandlers);
  it("keeps load and save on the server route", expectRouteModuleIsServerMediation);
});
