import { PassThrough } from "node:stream";
import {
  LIMITS,
  VALIDATION_FAILED_MESSAGE,
  configurationSchema,
  createDemoDocument,
  errorBodySchema,
  type Configuration,
  type EditableDocument,
  type ErrorBody,
} from "@reactiv/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPool } from "../db/test-database.js";
import { INTERNAL_FAILURE_MESSAGE } from "../http/service-error.js";
import { buildServer } from "../server.js";
import {
  createConfigurationRepository,
  type ConfigurationRepository,
  type GetConfigurationResult,
  type InsertConfigurationResult,
  type UpdateConfigurationResult,
} from "./repository.js";

const tokenKey = "CONFIG_SERVICE_TOKEN";
const tenantKey = "DEMO_TENANT_ID";
const serviceToken = "secret-token-value";
const wrongToken = "wrong-token-value";
const tenantId = `tenant_http_${crypto.randomUUID()}`;
const attackerTenant = "tenant_http_attacker";
const configurationIdPattern = /^cfg_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const privateTitle = "OtherTenantPrivateTitle";

let pool: Pool | undefined;
let repository: ConfigurationRepository | undefined;
const extraTenants: string[] = [];
const originalEnv = new Map<string, string | undefined>();

/**
 * Remembers the auth environment.
 *
 * Purpose: restore variables after this file changes them.
 * Inputs: none.
 * Side effects: records the current token and tenant.
 */
function rememberEnv(): void {
  // Snapshot only the keys this file writes.
  for (const key of [tokenKey, tenantKey]) {
    originalEnv.set(key, process.env[key]);
  }
}

/**
 * Restores the auth environment.
 *
 * Purpose: keep this file from leaking a token into later files.
 * Inputs: none.
 * Side effects: writes the saved values back to process.env.
 */
function restoreEnv(): void {
  // Replace each key, including an unset value.
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Applies the token and tenant for one test.
 *
 * Purpose: the routes read DEMO_TENANT_ID after the bearer token matches.
 * Inputs: none.
 * Side effects: mutates process.env until restoreEnv runs.
 */
function applyAuthEnv(): void {
  // The token is a local dummy. The tenant is not tenant_demo.
  process.env[tokenKey] = serviceToken;
  process.env[tenantKey] = tenantId;
}

/**
 * Returns the open test pool.
 *
 * Purpose: fail the helper when it runs before the database is open.
 * Inputs: none.
 * Side effects: none.
 */
function requirePool(): Pool {
  // beforeAll assigns the pool. A missing pool means the hook did not finish.
  if (pool === undefined) {
    throw new Error("The test database pool is not open.");
  }
  return pool;
}

/**
 * Returns the real repository.
 *
 * Purpose: success paths use Postgres, not a fake.
 * Inputs: none.
 * Side effects: none.
 */
function requireRepository(): ConfigurationRepository {
  // The repository closes over the test pool.
  if (repository === undefined) {
    throw new Error("The configuration repository is not open.");
  }
  return repository;
}

/**
 * Opens reactiv_test and builds the repository.
 *
 * Purpose: run create and load against Postgres with migrations applied.
 * Inputs: DATABASE_URL_TEST from the environment or .env.
 * Side effects: creates the test database when it is missing and migrates it.
 */
async function openDatabase(): Promise<void> {
  // The same pool the repository tests use. This file deletes only its own tenants.
  pool = await createTestPool();
  repository = createConfigurationRepository(pool);
}

/**
 * Closes the test pool.
 *
 * Purpose: release clients after the file finishes.
 * Inputs: none.
 * Side effects: ends the pool when it was opened.
 */
async function closeDatabase(): Promise<void> {
  // A failed beforeAll leaves the pool unset. There is nothing to close.
  if (pool === undefined) {
    return;
  }
  await pool.end();
  pool = undefined;
}

/**
 * Deletes one tenant's rows.
 *
 * Purpose: leave reactiv_test without this file's documents.
 * Inputs: id, the tenant to clear.
 * Side effects: deletes that tenant's configurations.
 */
async function deleteTenant(id: string): Promise<void> {
  // Bound the tenant. Do not delete another file's rows.
  await requirePool().query("DELETE FROM configurations WHERE tenant_id = $1", [id]);
}

/**
 * Deletes rows this file created.
 *
 * Purpose: the next test starts from an empty tenant.
 * Inputs: none.
 * Side effects: deletes the file tenant and any extra tenants recorded by a test.
 */
async function deleteCreatedRows(): Promise<void> {
  // A failed setup never opened the pool. There are no rows to delete.
  if (pool === undefined) {
    return;
  }
  // The main tenant is used by every database test.
  await deleteTenant(tenantId);
  for (const extra of extraTenants) {
    await deleteTenant(extra);
  }
  extraTenants.length = 0;
}

/**
 * Counts rows for one tenant.
 *
 * Purpose: show that a rejected write did not insert. The suite shares reactiv_test, so the count is tenant-scoped.
 * Inputs: id, the tenant to count.
 * Side effects: reads one aggregate.
 */
async function countTenantRows(id: string): Promise<number> {
  const result = await requirePool().query<{ count: number | string }>(
    "SELECT count(*)::int AS count FROM configurations WHERE tenant_id = $1",
    [id],
  );
  const count = result.rows.at(0)?.count ?? 0;
  // int4 may arrive as a number. A string still parses as the same count.
  return Number(count);
}

/**
 * Drops log chunks.
 *
 * Purpose: keep Fastify logs out of the test output.
 * Inputs: none. The chunk is ignored.
 * Side effects: none.
 */
function ignoreLogChunk(): void {
  // The listener exists so the stream does not buffer every line.
}

/**
 * Opens a server for one assertion and closes it afterward.
 *
 * Purpose: exercise create and load without binding a port.
 * Inputs: storage, the real repository or a spy. run, the assertions.
 * Side effects: creates and closes a Fastify instance.
 */
async function withApp(storage: ConfigurationRepository, run: (app: FastifyInstance) => Promise<void>): Promise<void> {
  const stream = new PassThrough();
  stream.on("data", ignoreLogChunk);
  const app = buildServer("@reactiv/contracts", stream, {
    repository: storage,
    writeRateLimitPerMinute: 600,
  });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

/**
 * Builds a repository spy.
 *
 * Purpose: prove a rejected credential does not insert or read.
 * Inputs: none.
 * Side effects: none until a method is called.
 */
function createSpyRepository(): ConfigurationRepository {
  return {
    // A write that runs is a failed auth test.
    insertConfiguration: vi.fn(async (): Promise<InsertConfigurationResult> => {
      throw new Error("insert should not be called");
    }),
    // A read that runs is a failed auth test.
    getConfiguration: vi.fn(async (): Promise<GetConfigurationResult> => {
      throw new Error("get should not be called");
    }),
    // Create and load must not update. A call fails this test.
    updateConfiguration: vi.fn(async (): Promise<UpdateConfigurationResult> => {
      throw new Error("update should not be called");
    }),
  };
}

/**
 * Issues ids for one demo document.
 *
 * Purpose: give createDemoDocument a generator that stays inside this test.
 * Inputs: none.
 * Side effects: none. The returned function increments its own counter.
 */
function demoIdGenerator(): () => string {
  let issued = 0;

  /**
   * Returns the next fixture id.
   *
   * Purpose: section and image ids come from the generator, not from an array index.
   * Inputs: none.
   * Side effects: increments the counter closed over by this generator.
   */
  function nextDemoId(): string {
    // The first call returns section-1. Each later call uses the next integer.
    issued += 1;
    return `section-${issued}`;
  }

  return nextDemoId;
}

/**
 * Builds the six-section demo document.
 *
 * Purpose: post the same ordered fixture the repository tests store.
 * Inputs: none.
 * Side effects: none.
 */
function demoDocument(): EditableDocument {
  // Ten generator calls cover two carousels, their slides, two text blocks, and two CTAs.
  return createDemoDocument(demoIdGenerator());
}

/**
 * Replaces the first text title.
 *
 * Purpose: make a second valid document that cannot be confused with the first.
 * Inputs: document, a demo document. title, the replacement title.
 * Side effects: none. The input document is not changed.
 */
function withTextTitle(document: EditableDocument, title: string): EditableDocument {
  const copy = structuredClone(document);
  const section = copy.data.sections[1];
  // The demo order is carousel, text, CTA. Index 1 is the first text block.
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected the demo text section.");
  }
  section.title = title;
  return copy;
}

/**
 * Builds a document whose schema version is not 1.
 *
 * Purpose: the write schema rejects every version other than 1.
 * Inputs: document, a valid demo document.
 * Side effects: none.
 */
function withSchemaVersionTwo(document: EditableDocument): unknown {
  // The sections stay valid so the failure is the version.
  return {
    schemaVersion: 2,
    data: document.data,
  };
}

/**
 * Replaces the first section with an unknown type.
 *
 * Purpose: quiz is not a schema version 1 section.
 * Inputs: document, a valid demo document.
 * Side effects: none.
 */
function withQuizSection(document: EditableDocument): unknown {
  const sections = structuredClone(document.data.sections) as unknown[];
  // Index 0 is the first carousel. The replacement is not carousel, text, or CTA.
  sections[0] = {
    id: "quiz-1",
    type: "quiz",
    title: "Question",
    description: "",
    titleColor: "#112233",
    descriptionColor: "#445566",
  };
  return {
    schemaVersion: 1,
    data: { sections },
  };
}

/**
 * Puts an invalid color on the first text section.
 *
 * Purpose: the shared schema rejects a color that is not #RGB or #RRGGBB.
 * Inputs: document, a valid demo document.
 * Side effects: none.
 */
function withBadColor(document: EditableDocument): unknown {
  const copy = structuredClone(document);
  const section = copy.data.sections[1];
  // Index 1 is the first text block. Its title color is the field under test.
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected the demo text section.");
  }
  return {
    schemaVersion: 1,
    data: {
      sections: copy.data.sections.map((item, index) => {
        if (index !== 1 || item.type !== "text") {
          return item;
        }
        return { ...item, titleColor: "#GGGGGG" };
      }),
    },
  };
}

/**
 * Puts a script URL on the first CTA.
 *
 * Purpose: the shared schema rejects a URL that is not absolute http(s).
 * Inputs: document, a valid demo document.
 * Side effects: none.
 */
function withScriptUrl(document: EditableDocument): unknown {
  const copy = structuredClone(document);
  const section = copy.data.sections[2];
  // Index 2 is the first CTA. Its url is the field under test.
  if (section === undefined || section.type !== "cta") {
    throw new Error("Expected the demo CTA section.");
  }
  return {
    schemaVersion: 1,
    data: {
      sections: copy.data.sections.map((item, index) => {
        if (index !== 2 || item.type !== "cta") {
          return item;
        }
        return { ...item, url: "javascript:alert(1)" };
      }),
    },
  };
}

/**
 * Repeats the first section id.
 *
 * Purpose: section ids are unique in one document.
 * Inputs: document, a valid demo document.
 * Side effects: none. The input document is not changed.
 */
function withDuplicateSectionId(document: EditableDocument): EditableDocument {
  const copy = structuredClone(document);
  const first = copy.data.sections[0];
  const second = copy.data.sections[1];
  // The later copy is the issue. The first occurrence stays.
  if (first === undefined || second === undefined) {
    throw new Error("Expected two demo sections.");
  }
  second.id = first.id;
  return copy;
}

/**
 * Repeats an image id inside the first carousel.
 *
 * Purpose: image ids are unique within one carousel.
 * Inputs: document, a valid demo document.
 * Side effects: none. The input document is not changed.
 */
function withDuplicateImageId(document: EditableDocument): EditableDocument {
  const copy = structuredClone(document);
  const section = copy.data.sections[0];
  // Index 0 is the first carousel. Its second slide repeats the first slide id.
  if (section === undefined || section.type !== "carousel") {
    throw new Error("Expected the demo carousel.");
  }
  const first = section.images[0];
  const second = section.images[1];
  if (first === undefined || second === undefined) {
    throw new Error("Expected two slides.");
  }
  second.id = first.id;
  return copy;
}

/**
 * Adds a position field to the first section.
 *
 * Purpose: array order is the screen order, so position is not a stored field.
 * Inputs: document, a valid demo document.
 * Side effects: none.
 */
function withPosition(document: EditableDocument): unknown {
  const sections = structuredClone(document.data.sections);
  const first = sections[0];
  // The extra key sits on the first section. The rest of the document stays valid.
  if (first === undefined) {
    throw new Error("Expected a demo section.");
  }
  return {
    schemaVersion: 1,
    data: {
      sections: [{ ...first, position: 1 }, ...sections.slice(1)],
    },
  };
}

/**
 * Adds a service-owned key to a valid document.
 *
 * Purpose: service-owned keys are not part of EditableDocument.
 * Inputs: document, a valid demo document. key, the rejected field. value, the rejected value.
 * Side effects: none.
 */
function withOwnedKey(document: EditableDocument, key: "id" | "revision" | "updatedAt" | "tenantId", value: unknown): unknown {
  // The spread keeps the valid sections and adds the key the schema rejects.
  return {
    ...document,
    [key]: value,
  };
}

/**
 * Headers for an authenticated JSON write.
 *
 * Purpose: repeat the bearer token and media type.
 * Inputs: token, the bearer value. The default is the configured test token.
 * Side effects: none.
 */
function jsonHeaders(token = serviceToken): Record<string, string> {
  // POST requires application/json after the credential matches.
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

/**
 * Headers for an authenticated read.
 *
 * Purpose: send the bearer token without a write media type.
 * Inputs: token, the bearer value.
 * Side effects: none.
 */
function readHeaders(token = serviceToken): Record<string, string> {
  // GET is authenticated and is not a JSON write.
  return {
    authorization: `Bearer ${token}`,
  };
}

/**
 * Reads one response header.
 *
 * Purpose: fail when a required header is missing or repeated.
 * Inputs: headers, the inject header map. name, the lowercase header name.
 * Side effects: none.
 */
function headerValue(headers: Record<string, unknown>, name: string): string {
  const value = headers[name];
  // light-my-request returns one string for a single header.
  if (typeof value !== "string") {
    throw new Error(`Expected ${name} to be one string.`);
  }
  return value;
}

/**
 * Asserts a failure did not describe a stored document.
 *
 * Purpose: an internal error has no ETag and no Location.
 * Inputs: headers, the response headers.
 * Side effects: none.
 */
function expectNoStoredDocumentHeaders(headers: Record<string, unknown>): void {
  // Those headers belong to a configuration that was returned.
  expect(headers.etag).toBeUndefined();
  expect(headers.location).toBeUndefined();
}

/**
 * Reads the field paths from an error body.
 *
 * Purpose: assert validation failures name the rejected fields.
 * Inputs: body, a parsed error body.
 * Side effects: none.
 */
function issuePaths(body: ErrorBody): string[] {
  const paths: string[] = [];
  for (const issue of body.error.issues ?? []) {
    // Each issue names one field, such as schemaVersion or data.sections[2].url.
    paths.push(issue.path);
  }
  return paths;
}

/**
 * Posts one JSON body.
 *
 * Purpose: share the create request across the success and rejection tests.
 * Inputs: app, the server. payload, the JSON value. token, the bearer value.
 * Side effects: injects one POST.
 */
function postJson(app: FastifyInstance, payload: unknown, token = serviceToken) {
  // The payload is text so the test controls the bytes the parser sees.
  return app.inject({
    method: "POST",
    url: "/v1/configurations",
    headers: jsonHeaders(token),
    payload: JSON.stringify(payload),
  });
}

/**
 * Asserts one strong revision ETag.
 *
 * Purpose: the header is the quoted revision and not a weak validator.
 * Inputs: headers, the response headers. revision, the expected number.
 * Side effects: none.
 */
function expectStrongEtag(headers: Record<string, unknown>, revision: number): void {
  const etag = headerValue(headers, "etag");
  // Quotes make it strong. A W/ prefix would be weak.
  expect(etag).toBe(`"${revision}"`);
  expect(etag.startsWith("W/")).toBe(false);
}

/**
 * Asserts a successful configuration response.
 *
 * Purpose: the body matches the shared schema and the sections the client sent.
 * Inputs: responseBody, the parsed JSON. document, the editable document that was stored.
 * Side effects: none.
 */
function expectStoredDocument(responseBody: unknown, document: EditableDocument): Configuration {
  const parsed = configurationSchema.parse(responseBody);
  // The HTTP body is the schema value. Extra keys would fail the strict parse or this comparison.
  expect(responseBody).toEqual(parsed);
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed.revision).toBe(1);
  expect(parsed.updatedAt.endsWith("Z")).toBe(true);
  // The timestamp comes from the database clock, not from a client field.
  expect(Math.abs(Date.now() - Date.parse(parsed.updatedAt))).toBeLessThan(120_000);
  expect(parsed.data.sections).toEqual(document.data.sections);
  expect(parsed.data.sections.map((section) => section.type)).toEqual([
    "carousel",
    "text",
    "cta",
    "carousel",
    "text",
    "cta",
  ]);
  return parsed;
}

/**
 * Asserts that a create response is a new configuration.
 *
 * Purpose: the client did not send the id, and the service assigned revision 1.
 * Inputs: statusCode and headers from the response. body, the parsed configuration. document, the request document.
 * Side effects: none.
 */
function expectCreated(statusCode: number, headers: Record<string, unknown>, body: Configuration, document: EditableDocument): void {
  // 201 carries the new id in Location and the revision in a strong ETag.
  expect(statusCode).toBe(201);
  expect(headerValue(headers, "content-type")).toContain("application/json");
  expect(headerValue(headers, "cache-control")).toBe("private, no-store");
  expect(headerValue(headers, "location")).toBe(`/v1/configurations/${body.id}`);
  expectStrongEtag(headers, 1);
  expect(headers["access-control-allow-origin"]).toBeUndefined();
  expect(body.id).toMatch(configurationIdPattern);
  expect(JSON.stringify(document)).not.toContain(body.id);
  expect(document.data.sections.map((section) => section.id)).not.toContain(body.id);
}

/**
 * Asserts one validation failure and an unchanged stored document.
 *
 * Purpose: a rejected create does not replace the configuration that was already stored.
 * Inputs: app, the server. createdId, the stored id. original, the last good response. payload, the rejected body. path, the expected field.
 * Side effects: injects one POST and one GET.
 */
async function expectInvalidWrite(
  app: FastifyInstance,
  createdId: string,
  original: unknown,
  payload: unknown,
  path: string,
): Promise<void> {
  const response = await postJson(app, payload);
  const body = errorBodySchema.parse(response.json());
  // 422 names the field. The previous row is still the one that was created.
  expect(response.statusCode).toBe(422);
  expect(body.error.code).toBe("VALIDATION_FAILED");
  expect(body.error.message).toBe(VALIDATION_FAILED_MESSAGE);
  expect(issuePaths(body)).toContain(path);
  expect(response.body).not.toContain(serviceToken);
  expect(response.body).not.toContain("stack");
  expect(headerValue(response.headers, "cache-control")).toBe("private, no-store");
  expect(response.headers.etag).toBeUndefined();
  expect(response.headers.location).toBeUndefined();
  const again = await app.inject({
    method: "GET",
    url: `/v1/configurations/${createdId}`,
    headers: readHeaders(),
  });
  expect(again.statusCode).toBe(200);
  expect(again.json()).toEqual(original);
}

/**
 * Asserts create and the following load.
 *
 * Purpose: a valid six-section document is stored and read back with the same payload.
 * Inputs: none.
 * Side effects: inserts one row and deletes it during cleanup.
 */
async function expectCreateThenLoad(): Promise<void> {
  const document = demoDocument();
  await withApp(requireRepository(), async (app) => {
    const created = await postJson(app, document);
    const body = expectStoredDocument(created.json(), document);
    expectCreated(created.statusCode, created.headers, body, document);
    const loaded = await app.inject({
      method: "GET",
      url: `/v1/configurations/${body.id}`,
      headers: readHeaders(),
    });
    // The load is the same document, including the server id, revision, and timestamp.
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(created.json());
    expect(headerValue(loaded.headers, "cache-control")).toBe("private, no-store");
    expectStrongEtag(loaded.headers, body.revision);
    expect(loaded.headers.location).toBeUndefined();
    expect(loaded.headers["access-control-allow-origin"]).toBeUndefined();
    expect(configurationSchema.parse(loaded.json())).toEqual(body);
  });
}

/**
 * Asserts an unknown id is not found.
 *
 * Purpose: a missing id is 404 rather than another configuration or a default document.
 * Inputs: none.
 * Side effects: inserts nothing for the request tenant.
 */
async function expectUnknownIdIsNotFound(): Promise<void> {
  const unknownIds = [`cfg_${crypto.randomUUID()}`, "not-a-configuration"];
  await withApp(requireRepository(), async (app) => {
    for (const unknownId of unknownIds) {
      const response = await app.inject({
        method: "GET",
        url: `/v1/configurations/${unknownId}`,
        headers: readHeaders(),
      });
      const body = errorBodySchema.parse(response.json());
      // A UUID-shaped miss and a plain miss use the same not-found response.
      expect(response.statusCode).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
      expect(body.error.message).toBe("Configuration not found.");
      expect(body.error.issues).toBeUndefined();
      expect(response.body).not.toContain(unknownId);
      expect(response.body).not.toContain("schemaVersion");
      expect(response.body).not.toContain("sections");
      expect(response.body).not.toContain(tenantId);
      expect(headerValue(response.headers, "cache-control")).toBe("private, no-store");
      expect(response.headers.etag).toBeUndefined();
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(await countTenantRows(tenantId)).toBe(0);
  });
}

/**
 * Asserts a second create does not replace the first.
 *
 * Purpose: each POST assigns a new id and leaves the earlier payload in place.
 * Inputs: none.
 * Side effects: inserts two rows and deletes them during cleanup.
 */
async function expectSecondCreateDoesNotOverwrite(): Promise<void> {
  const firstDocument = demoDocument();
  const secondDocument = withTextTitle(firstDocument, "Second create");
  await withApp(requireRepository(), async (app) => {
    const first = await postJson(app, firstDocument);
    const firstBody = expectStoredDocument(first.json(), firstDocument);
    const second = await postJson(app, secondDocument);
    const secondBody = expectStoredDocument(second.json(), secondDocument);
    // The ids differ, and each revision starts at 1.
    expect(second.statusCode).toBe(201);
    expect(secondBody.id).not.toBe(firstBody.id);
    expect(secondBody.revision).toBe(1);
    const loadedFirst = await app.inject({
      method: "GET",
      url: `/v1/configurations/${firstBody.id}`,
      headers: readHeaders(),
    });
    const loadedSecond = await app.inject({
      method: "GET",
      url: `/v1/configurations/${secondBody.id}`,
      headers: readHeaders(),
    });
    expect(loadedFirst.json()).toEqual(first.json());
    expect(loadedSecond.json()).toEqual(second.json());
    expect(await countTenantRows(tenantId)).toBe(2);
  });
}

/**
 * Asserts invalid creates leave the stored document in place.
 *
 * Purpose: schema version, section type, color, URL, duplicate ids, and service-owned keys fail before a write.
 * Inputs: none.
 * Side effects: inserts one valid row, rejects the later posts, and deletes the row during cleanup.
 */
async function expectInvalidCreatesDoNotChangeTheStoredDocument(): Promise<void> {
  const document = demoDocument();
  await withApp(requireRepository(), async (app) => {
    const created = await postJson(app, document);
    const original = created.json();
    const createdId = configurationSchema.parse(original).id;
    const cases: { payload: unknown; path: string }[] = [
      { payload: withSchemaVersionTwo(document), path: "schemaVersion" },
      { payload: withQuizSection(document), path: "data.sections[0].type" },
      { payload: withBadColor(document), path: "data.sections[1].titleColor" },
      { payload: withScriptUrl(document), path: "data.sections[2].url" },
      { payload: withDuplicateSectionId(document), path: "data.sections[1].id" },
      { payload: withDuplicateImageId(document), path: "data.sections[0].images[1].id" },
      { payload: withPosition(document), path: "data.sections[0].position" },
      { payload: withOwnedKey(document, "id", "cfg_from_client"), path: "id" },
      { payload: withOwnedKey(document, "revision", 9), path: "revision" },
      { payload: withOwnedKey(document, "updatedAt", "2026-10-12T17:44:00.000Z"), path: "updatedAt" },
      { payload: withOwnedKey(document, "tenantId", attackerTenant), path: "tenantId" },
    ];
    for (const item of cases) {
      await expectInvalidWrite(app, createdId, original, item.payload, item.path);
    }
    // One stored row. None of the rejected bodies became a second configuration.
    expect(await countTenantRows(tenantId)).toBe(1);
    const stored = JSON.stringify(original);
    expect(stored).not.toContain("javascript:");
    expect(stored).not.toContain("#GGGGGG");
    expect(stored).not.toContain("quiz");
    expect(stored).not.toContain("cfg_from_client");
    expect(stored).not.toContain(attackerTenant);
    expect(await countTenantRows(attackerTenant)).toBe(0);
  });
}

/**
 * Asserts another tenant's id is not found.
 *
 * Purpose: the load stays tenant-scoped and the message does not reveal the other row.
 * Inputs: none.
 * Side effects: inserts one row for a different tenant and deletes it during cleanup.
 */
async function expectAnotherTenantsIdIsNotFound(): Promise<void> {
  const otherTenant = `tenant_http_other_${crypto.randomUUID()}`;
  extraTenants.push(otherTenant);
  const otherId = `cfg_${crypto.randomUUID()}`;
  const otherDocument: EditableDocument = {
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "other-text",
          type: "text",
          title: privateTitle,
          description: "",
          titleColor: "#112233",
          descriptionColor: "#334455",
        },
      ],
    },
  };
  const inserted = await requireRepository().insertConfiguration({
    tenantId: otherTenant,
    id: otherId,
    document: otherDocument,
  });
  // The other tenant's row exists before the HTTP read. The request tenant is different.
  expect(inserted.ok).toBe(true);
  await withApp(requireRepository(), async (app) => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/configurations/${otherId}`,
      headers: {
        ...readHeaders(),
        "x-tenant-id": otherTenant,
      },
    });
    const body = errorBodySchema.parse(response.json());
    expect(response.statusCode).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Configuration not found.");
    expect(response.body).not.toContain(privateTitle);
    expect(response.body).not.toContain(otherTenant);
    expect(response.body).not.toContain(otherId);
  });
  const stillThere = await requireRepository().getConfiguration({
    tenantId: otherTenant,
    id: otherId,
  });
  // The miss did not delete or return the other tenant's document.
  expect(stillThere.ok).toBe(true);
  if (stillThere.ok) {
    expect(stillThere.configuration.data.sections[0]).toMatchObject({ title: privateTitle });
  }
}

/**
 * Asserts there is no list route.
 *
 * Purpose: GET /v1/configurations is not a collection of stored documents.
 * Inputs: none.
 * Side effects: injects one request.
 */
async function expectNoListRoute(): Promise<void> {
  await withApp(requireRepository(), async (app) => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/configurations",
      headers: readHeaders(),
    });
    // The collection path is not registered. The body is not a configuration.
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain("schemaVersion");
    expect(response.body).not.toContain("sections");
  });
}

/**
 * Asserts malformed and oversized bodies do not write.
 *
 * Purpose: those failures stay on the prompt 05 parser behavior.
 * Inputs: none.
 * Side effects: inserts one valid row, rejects two writes, and deletes the row during cleanup.
 */
async function expectMalformedAndOversizeDoNotWrite(): Promise<void> {
  const document = demoDocument();
  await withApp(requireRepository(), async (app) => {
    const created = await postJson(app, document);
    const original = created.json();
    const createdId = configurationSchema.parse(original).id;
    const broken = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonHeaders(),
      payload: "{",
    });
    const brokenBody = errorBodySchema.parse(broken.json());
    // Invalid JSON is 400. It is not a field validation error.
    expect(broken.statusCode).toBe(400);
    expect(brokenBody.error.code).toBe("MALFORMED_JSON");
    const whitespace = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonHeaders(),
      payload: "   ",
    });
    const whitespaceBody = errorBodySchema.parse(whitespace.json());
    // Spaces are not a document. They stay a parser failure.
    expect(whitespace.statusCode).toBe(400);
    expect(whitespaceBody.error.code).toBe("MALFORMED_JSON");
    const oversized = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: jsonHeaders(),
      payload: Buffer.alloc(LIMITS.maxPayloadBytes + 1, 0x7b),
    });
    const oversizedBody = errorBodySchema.parse(oversized.json());
    expect(oversized.statusCode).toBe(413);
    expect(oversizedBody.error.code).toBe("PAYLOAD_TOO_LARGE");
    const again = await app.inject({
      method: "GET",
      url: `/v1/configurations/${createdId}`,
      headers: readHeaders(),
    });
    expect(again.json()).toEqual(original);
    expect(await countTenantRows(tenantId)).toBe(1);
  });
}

/**
 * Asserts missing and wrong credentials do not call the repository.
 *
 * Purpose: create and load reject a bad credential before a read or an insert.
 * Inputs: none.
 * Side effects: injects four requests against a spy.
 */
async function expectRejectedCredentialsDoNotTouchTheRepository(): Promise<void> {
  const storage = createSpyRepository();
  const document = demoDocument();
  await withApp(storage, async (app) => {
    const missingPost = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(document),
    });
    const wrongPost = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        authorization: `Bearer ${wrongToken}`,
        "content-type": "application/json",
        "x-tenant-id": attackerTenant,
      },
      payload: JSON.stringify(document),
    });
    const missingGet = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
    });
    const wrongGet = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: {
        authorization: `Bearer ${wrongToken}`,
        "x-tenant-id": attackerTenant,
      },
    });
    for (const response of [missingPost, wrongPost, missingGet, wrongGet]) {
      const body = errorBodySchema.parse(response.json());
      // Every rejected credential is the same 401. The body does not echo the token.
      expect(response.statusCode).toBe(401);
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.message).toBe("Authentication failed.");
      expect(response.body).not.toContain(serviceToken);
      expect(response.body).not.toContain(wrongToken);
      expect(response.body).not.toContain(attackerTenant);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
    expect(storage.insertConfiguration).not.toHaveBeenCalled();
    expect(storage.getConfiguration).not.toHaveBeenCalled();
    expect(storage.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts an unauthenticated create does not insert.
 *
 * Purpose: the tenant row count stays the same when the token is missing or wrong.
 * Inputs: none.
 * Side effects: inserts one authenticated row, rejects two creates, and deletes the row during cleanup.
 */
async function expectUnauthenticatedPostDoesNotInsert(): Promise<void> {
  const document = demoDocument();
  const second = withTextTitle(document, "Must not be stored");
  await withApp(requireRepository(), async (app) => {
    const created = await postJson(app, document);
    const original = created.json();
    const createdId = configurationSchema.parse(original).id;
    const before = await countTenantRows(tenantId);
    const attackerBefore = await countTenantRows(attackerTenant);
    const missing = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": attackerTenant,
      },
      payload: JSON.stringify(second),
    });
    const wrong = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        authorization: `Bearer ${wrongToken}`,
        "content-type": "application/json",
        "x-tenant-id": attackerTenant,
      },
      payload: JSON.stringify(second),
    });
    const missingRead = await app.inject({
      method: "GET",
      url: `/v1/configurations/${createdId}`,
      headers: { "x-tenant-id": attackerTenant },
    });
    const wrongRead = await app.inject({
      method: "GET",
      url: `/v1/configurations/${createdId}`,
      headers: {
        authorization: `Bearer ${wrongToken}`,
        "x-tenant-id": attackerTenant,
      },
    });
    // A valid document without a credential must not become a row.
    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(missingRead.statusCode).toBe(401);
    expect(wrongRead.statusCode).toBe(401);
    expect(missingRead.body).not.toContain("Must not be stored");
    expect(missingRead.body).not.toContain("New this week");
    expect(wrongRead.body).not.toContain("Must not be stored");
    expect(wrongRead.body).not.toContain(serviceToken);
    expect(await countTenantRows(tenantId)).toBe(before);
    expect(await countTenantRows(attackerTenant)).toBe(attackerBefore);
    const loaded = await app.inject({
      method: "GET",
      url: `/v1/configurations/${createdId}`,
      headers: readHeaders(),
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(original);
  });
}

/**
 * Reads the jsonb stored for one configuration.
 *
 * Purpose: compare the database value with the normalized document, not only the HTTP body.
 * Inputs: id, the configuration id.
 * Side effects: reads one row.
 */
async function readStoredData(id: string): Promise<unknown> {
  const result = await requirePool().query<{ data: unknown }>(
    "SELECT data FROM configurations WHERE tenant_id = $1 AND id = $2",
    [tenantId, id],
  );
  const row = result.rows.at(0);
  // The create response named this id. A miss means the write did not land.
  if (row === undefined) {
    throw new Error("Expected a stored configuration row.");
  }
  return row.data;
}

/**
 * Asserts that the service stores the normalized document.
 *
 * Purpose: a short hex color and surrounding CTA spaces are normalized before insert.
 * Inputs: none.
 * Side effects: inserts one row and deletes it during cleanup.
 */
async function expectNormalizedDocumentIsStored(): Promise<void> {
  const payload = {
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "text-1",
          type: "text",
          title: "Normalized",
          description: "",
          titleColor: "#ABC",
          descriptionColor: "#00ff00",
        },
        {
          id: "cta-1",
          type: "cta",
          label: "  Continue  ",
          url: "https://example.com/continue",
          backgroundColor: "#fff",
          labelColor: "#000",
        },
      ],
    },
  };
  await withApp(requireRepository(), async (app) => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        ...jsonHeaders(),
        "content-type": "application/json; charset=utf-8",
      },
      payload: JSON.stringify(payload),
    });
    const body = configurationSchema.parse(created.json());
    // The charset parameter is still JSON. The stored colors and label are normalized.
    expect(created.statusCode).toBe(201);
    expect(headerValue(created.headers, "content-type")).toContain("application/json");
    expect(body.data.sections).toEqual([
      {
        id: "text-1",
        type: "text",
        title: "Normalized",
        description: "",
        titleColor: "#aabbcc",
        descriptionColor: "#00ff00",
      },
      {
        id: "cta-1",
        type: "cta",
        label: "Continue",
        url: "https://example.com/continue",
        backgroundColor: "#ffffff",
        labelColor: "#000000",
      },
    ]);
    expect(await readStoredData(body.id)).toEqual(body.data);
    const loaded = await app.inject({
      method: "GET",
      url: `/v1/configurations/${body.id}`,
      headers: readHeaders(),
    });
    expect(loaded.json()).toEqual(created.json());
  });
}

/**
 * Asserts that an empty section list is a valid create.
 *
 * Purpose: the write route accepts the smallest schema version 1 document.
 * Inputs: none.
 * Side effects: inserts one row and deletes it during cleanup.
 */
async function expectEmptyDocumentRoundTrips(): Promise<void> {
  const document: EditableDocument = { schemaVersion: 1, data: { sections: [] } };
  await withApp(requireRepository(), async (app) => {
    const created = await postJson(app, document);
    const body = configurationSchema.parse(created.json());
    // An empty list is stored in that order and comes back unchanged.
    expect(created.statusCode).toBe(201);
    expect(body.revision).toBe(1);
    expect(body.data.sections).toEqual([]);
    expect(body.id).toMatch(configurationIdPattern);
    const loaded = await app.inject({
      method: "GET",
      url: `/v1/configurations/${body.id}`,
      headers: readHeaders(),
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(created.json());
  });
}

/**
 * Asserts that JSON values which are not documents do not insert.
 *
 * Purpose: null, an array, a boolean, and an empty object are parsed, then rejected by the schema.
 * Inputs: none.
 * Side effects: injects four posts and deletes nothing when they stay rejected.
 */
async function expectNonObjectJsonDoesNotInsert(): Promise<void> {
  const cases: { payload: unknown; path: string }[] = [
    { payload: null, path: "$" },
    { payload: [], path: "$" },
    { payload: true, path: "$" },
    { payload: {}, path: "schemaVersion" },
  ];
  await withApp(requireRepository(), async (app) => {
    for (const item of cases) {
      const response = await postJson(app, item.payload);
      const body = errorBodySchema.parse(response.json());
      // These are JSON, so the failure is validation rather than a parser error.
      expect(response.statusCode).toBe(422);
      expect(body.error.code).toBe("VALIDATION_FAILED");
      expect(issuePaths(body)).toContain(item.path);
    }
    expect(await countTenantRows(tenantId)).toBe(0);
  });
}

/**
 * Asserts that a caller-supplied tenant is ignored on a valid create.
 *
 * Purpose: the stored row uses DEMO_TENANT_ID, not X-Tenant-Id.
 * Inputs: none.
 * Side effects: inserts one row for the server tenant and deletes it during cleanup.
 */
async function expectCreateIgnoresCallerTenant(): Promise<void> {
  const document: EditableDocument = { schemaVersion: 1, data: { sections: [] } };
  await withApp(requireRepository(), async (app) => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/configurations",
      headers: {
        ...jsonHeaders(),
        "x-tenant-id": attackerTenant,
      },
      payload: JSON.stringify(document),
    });
    const body = configurationSchema.parse(created.json());
    // The header does not choose the row's tenant.
    expect(created.statusCode).toBe(201);
    expect(created.body).not.toContain(attackerTenant);
    expect(await countTenantRows(tenantId)).toBe(1);
    expect(await countTenantRows(attackerTenant)).toBe(0);
    const loaded = await app.inject({
      method: "GET",
      url: `/v1/configurations/${body.id}`,
      headers: readHeaders(),
    });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(created.json());
  });
}

/**
 * Asserts that a blank server tenant does not read or write.
 *
 * Purpose: a missing DEMO_TENANT_ID is an internal failure, not a caller-selected tenant.
 * Inputs: none.
 * Side effects: changes DEMO_TENANT_ID until cleanup restores it. Injects two requests against a spy.
 */
async function expectBlankTenantDoesNotTouchTheRepository(): Promise<void> {
  const storage = createSpyRepository();
  const document: EditableDocument = { schemaVersion: 1, data: { sections: [] } };
  await withApp(storage, async (app) => {
    process.env[tenantKey] = "   ";
    const created = await postJson(app, document);
    delete process.env[tenantKey];
    const loaded = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: {
        ...readHeaders(),
        "x-tenant-id": attackerTenant,
      },
    });
    for (const response of [created, loaded]) {
      const body = errorBodySchema.parse(response.json());
      // The caller header is not copied into the error, and storage is not opened.
      expect(response.statusCode).toBe(500);
      expect(body.error.code).toBe("INTERNAL");
      expect(body.error.message).toBe(INTERNAL_FAILURE_MESSAGE);
      expect(response.body).not.toContain(attackerTenant);
      expect(response.body).not.toContain(serviceToken);
      expect(response.body).not.toContain("stack");
      expectNoStoredDocumentHeaders(response.headers);
    }
    expect(storage.insertConfiguration).not.toHaveBeenCalled();
    expect(storage.getConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts that an id collision is an internal failure and is not retried.
 *
 * Purpose: a repeated generated id does not upsert and does not describe the database constraint.
 * Inputs: none.
 * Side effects: injects one post against a spy.
 */
async function expectIdCollisionIsAnInternalError(): Promise<void> {
  const storage = createSpyRepository();
  vi.mocked(storage.insertConfiguration).mockResolvedValue({ ok: false, reason: "unique-violation" });
  const document: EditableDocument = { schemaVersion: 1, data: { sections: [] } };
  await withApp(storage, async (app) => {
    const response = await postJson(app, document);
    const body = errorBodySchema.parse(response.json());
    // One insert attempt. The client does not see a unique-violation reason.
    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe(INTERNAL_FAILURE_MESSAGE);
    expect(response.body).not.toContain("unique");
    expect(response.body).not.toContain("23505");
    expect(response.body).not.toContain("stack");
    expectNoStoredDocumentHeaders(response.headers);
    expect(storage.insertConfiguration).toHaveBeenCalledTimes(1);
    expect(storage.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts that a repository exception on the real routes stays internal.
 *
 * Purpose: create and load do not copy a driver message, token, or document into the JSON.
 * Inputs: none.
 * Side effects: injects one post and one get against a spy.
 */
async function expectRepositoryFailuresStayInternal(): Promise<void> {
  const storage = createSpyRepository();
  const failure = new Error(`SELECT ${serviceToken} CorruptStoredTitle FROM configurations`);
  vi.mocked(storage.insertConfiguration).mockRejectedValue(failure);
  vi.mocked(storage.getConfiguration).mockRejectedValue(failure);
  const document: EditableDocument = { schemaVersion: 1, data: { sections: [] } };
  await withApp(storage, async (app) => {
    const created = await postJson(app, document);
    const loaded = await app.inject({
      method: "GET",
      url: "/v1/configurations/cfg_demo",
      headers: readHeaders(),
    });
    for (const response of [created, loaded]) {
      const body = errorBodySchema.parse(response.json());
      // The safe sentence replaces the driver text.
      expect(response.statusCode).toBe(500);
      expect(body.error.code).toBe("INTERNAL");
      expect(body.error.message).toBe(INTERNAL_FAILURE_MESSAGE);
      expect(response.body).not.toContain(serviceToken);
      expect(response.body).not.toContain("CorruptStoredTitle");
      expect(response.body).not.toContain("SELECT");
      expect(response.body).not.toContain("stack");
      expectNoStoredDocumentHeaders(response.headers);
    }
    expect(storage.insertConfiguration).toHaveBeenCalledTimes(1);
    expect(storage.getConfiguration).toHaveBeenCalledTimes(1);
  });
}

/**
 * Asserts that a stored row outside the contract is not returned.
 *
 * Purpose: a schema version other than 1 fails as an internal error and does not echo the row.
 * Inputs: none.
 * Side effects: inserts one invalid row and deletes it during cleanup.
 */
async function expectCorruptStoredRowIsAnInternalError(): Promise<void> {
  const corruptId = `cfg_${crypto.randomUUID()}`;
  await requirePool().query(
    `INSERT INTO configurations (tenant_id, id, schema_version, revision, data)
     VALUES ($1, $2, 2, 1, $3::jsonb)`,
    [tenantId, corruptId, JSON.stringify({ leakedTitle: "CorruptStoredTitle" })],
  );
  await withApp(requireRepository(), async (app) => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/configurations/${corruptId}`,
      headers: readHeaders(),
    });
    const body = errorBodySchema.parse(response.json());
    // The client receives the safe 500, not the stored JSON or the schema version.
    expect(response.statusCode).toBe(500);
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).toBe(INTERNAL_FAILURE_MESSAGE);
    expect(response.body).not.toContain("CorruptStoredTitle");
    expect(response.body).not.toContain("schema");
    expect(response.body).not.toContain("stack");
    expectNoStoredDocumentHeaders(response.headers);
    expect(await countTenantRows(tenantId)).toBe(1);
  });
}

/**
 * Clears rows and restores the environment after one test.
 *
 * Purpose: the next test does not see this test's documents or token.
 * Inputs: none.
 * Side effects: deletes this file's rows and writes the saved environment back.
 */
async function cleanupTest(): Promise<void> {
  try {
    // Delete first so a restore still happens when the delete fails.
    await deleteCreatedRows();
  } finally {
    restoreEnv();
  }
}

rememberEnv();
beforeAll(openDatabase, 20_000);
beforeEach(applyAuthEnv);
afterEach(cleanupTest);
afterAll(closeDatabase, 20_000);

describe("create and load a configuration", () => {
  it("stores a six-section document and loads the same payload", expectCreateThenLoad, 20_000);
  it("returns 404 for an unknown id", expectUnknownIdIsNotFound, 20_000);
  it("does not overwrite the first configuration on a second create", expectSecondCreateDoesNotOverwrite, 20_000);
  it("rejects invalid documents and leaves the stored configuration unchanged", expectInvalidCreatesDoNotChangeTheStoredDocument, 20_000);
  it("does not reveal another tenant's configuration", expectAnotherTenantsIdIsNotFound, 20_000);
  it("does not list configurations", expectNoListRoute, 20_000);
  it("keeps malformed and oversized bodies on the parser errors", expectMalformedAndOversizeDoNotWrite, 20_000);
  it("rejects a missing or wrong token before the repository", expectRejectedCredentialsDoNotTouchTheRepository, 20_000);
  it("does not insert when create has no valid token", expectUnauthenticatedPostDoesNotInsert, 20_000);
  it("stores normalized colors and a trimmed CTA label", expectNormalizedDocumentIsStored, 20_000);
  it("stores an empty section list", expectEmptyDocumentRoundTrips, 20_000);
  it("rejects JSON that is not a document", expectNonObjectJsonDoesNotInsert, 20_000);
  it("stores a create under the server tenant", expectCreateIgnoresCallerTenant, 20_000);
  it("does not use a blank server tenant", expectBlankTenantDoesNotTouchTheRepository, 20_000);
  it("returns 500 when a generated id collides", expectIdCollisionIsAnInternalError, 20_000);
  it("hides repository failures on create and load", expectRepositoryFailuresStayInternal, 20_000);
  it("hides a stored row that fails the contract", expectCorruptStoredRowIsAnInternalError, 20_000);
});
