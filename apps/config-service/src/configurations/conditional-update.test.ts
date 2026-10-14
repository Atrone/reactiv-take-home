import { PassThrough } from "node:stream";
import {
  CAROUSEL_IMAGE_LIMIT_MESSAGE,
  CTA_LABEL_REQUIRED_MESSAGE,
  LIMITS,
  SECTION_LIMIT_MESSAGE,
  TITLE_LIMIT_MESSAGE,
  VALIDATION_FAILED_MESSAGE,
  configurationSchema,
  createDemoDocument,
  errorBodySchema,
  type Configuration,
  type EditableDocument,
  type ErrorBody,
  type ErrorCode,
} from "@reactiv/contracts";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPool } from "../db/test-database.js";
import {
  AUTHENTICATION_FAILED_MESSAGE,
  CONFIGURATION_NOT_FOUND_MESSAGE,
  INTERNAL_FAILURE_MESSAGE,
  PAYLOAD_TOO_LARGE_MESSAGE,
  PRECONDITION_FAILED_MESSAGE,
  PRECONDITION_REQUIRED_MESSAGE,
  RATE_LIMITED_MESSAGE,
} from "../http/service-error.js";
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
const tenantId = `tenant_http_put_${crypto.randomUUID()}`;
const attackerTenant = "tenant_http_put_attacker";
const privateTitle = "OtherTenantPrivateTitle";

let pool: Pool | undefined;
let repository: ConfigurationRepository | undefined;
const extraTenants: string[] = [];
const originalEnv = new Map<string, string | undefined>();

/** One stored row as text, so a rejected write can be compared exactly. */
type StoredRow = {
  dataText: string;
  revision: string;
  updatedAt: string;
};

/** One injected response the assertions read. */
type InjectedResponse = {
  statusCode: number;
  body: string;
  headers: Record<string, unknown>;
  json: () => unknown;
};

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
 * Purpose: run conditional updates against Postgres with migrations applied.
 * Inputs: DATABASE_URL_TEST from the environment or .env.
 * Side effects: creates the test database when it is missing and migrates it.
 */
async function openDatabase(): Promise<void> {
  // This file deletes only its own tenants.
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
 * Counts rows with one configuration id in any tenant.
 *
 * Purpose: a rejected PUT must not insert the id for this tenant or any other.
 * Inputs: id, the configuration id.
 * Side effects: reads one aggregate.
 */
async function countRowsForId(id: string): Promise<number> {
  const result = await requirePool().query<{ count: number | string }>(
    "SELECT count(*)::int AS count FROM configurations WHERE id = $1",
    [id],
  );
  const count = result.rows.at(0)?.count ?? 0;
  // int4 may arrive as a number. A string still parses as the same count.
  return Number(count);
}

/**
 * Reads the stored JSON text, revision, and timestamp.
 *
 * Purpose: compare a rejected update against the previous row, including updated_at.
 * Inputs: id, the configuration id. owner, the tenant that should hold it.
 * Side effects: reads one row.
 */
async function readStoredRow(id: string, owner = tenantId): Promise<StoredRow> {
  const result = await requirePool().query<{ data_text: string; revision: string; updated_at: string }>(
    `SELECT data::text AS data_text,
            revision::text AS revision,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
     FROM configurations
     WHERE tenant_id = $1
       AND id = $2`,
    [owner, id],
  );
  const row = result.rows.at(0);
  // The caller inserted this key. A miss means the write did not land.
  if (row === undefined) {
    throw new Error("Expected a stored configuration row.");
  }
  return {
    dataText: row.data_text,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
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
  // The update response named this id. A miss means the write did not land.
  if (row === undefined) {
    throw new Error("Expected a stored configuration row.");
  }
  return row.data;
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
 * Purpose: exercise conditional update without binding a port.
 * Inputs: storage, the real repository or a spy. run, the assertions. writeRateLimitPerMinute, the authenticated write ceiling for this server.
 * Side effects: creates and closes a Fastify instance.
 */
async function withApp(
  storage: ConfigurationRepository,
  run: (app: FastifyInstance) => Promise<void>,
  writeRateLimitPerMinute = 600,
): Promise<void> {
  const stream = new PassThrough();
  stream.on("data", ignoreLogChunk);
  // The default ceiling leaves room for the multi-request cases. A lower ceiling is the rate-limit case.
  const app = buildServer("@reactiv/contracts", stream, {
    repository: storage,
    writeRateLimitPerMinute,
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
 * Purpose: prove a rejected credential or invalid document does not update.
 * Inputs: none.
 * Side effects: none until a method is called.
 */
function createSpyRepository(): ConfigurationRepository {
  return {
    // A write that runs is a failed auth or validation test.
    insertConfiguration: vi.fn(async (): Promise<InsertConfigurationResult> => {
      throw new Error("insert should not be called");
    }),
    // A read that runs is a failed auth test.
    getConfiguration: vi.fn(async (): Promise<GetConfigurationResult> => {
      throw new Error("get should not be called");
    }),
    // Update runs only when a test forces a repository failure.
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
 * Purpose: put the same ordered fixture the create tests store.
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
 * Builds a one-section document.
 *
 * Purpose: show that PUT replaces the whole section list rather than patching one field.
 * Inputs: title, the only text title that should remain.
 * Side effects: none.
 */
function oneSectionDocument(title: string): EditableDocument {
  // The other five demo sections are absent. Saving this list drops them.
  return {
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "only-text",
          type: "text",
          title,
          description: "The other sections are gone.",
          titleColor: "#112233",
          descriptionColor: "#334455",
        },
      ],
    },
  };
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
 * Puts one invalid color on the first text section.
 *
 * Purpose: the shared schema rejects a color that is not #RGB or #RRGGBB.
 * Inputs: document, a valid demo document. color, the rejected color text.
 * Side effects: none.
 */
function withTitleColor(document: EditableDocument, color: string): unknown {
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
        return { ...item, titleColor: color };
      }),
    },
  };
}

/**
 * Puts one URL on the first CTA.
 *
 * Purpose: the shared schema rejects a URL that is not absolute http(s).
 * Inputs: document, a valid demo document. url, the rejected URL.
 * Side effects: none.
 */
function withCtaUrl(document: EditableDocument, url: string): unknown {
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
        return { ...item, url };
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
 * Purpose: service-owned keys are not part of EditableDocument, and revision is not read from the body.
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
  // PUT requires application/json after the credential matches.
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
 * Reads the field messages from an error body.
 *
 * Purpose: a limit failure can be checked for the shared sentence as well as the path.
 * Inputs: body, a parsed error body.
 * Side effects: none.
 */
function issueMessages(body: ErrorBody): string[] {
  const messages: string[] = [];
  for (const issue of body.error.issues ?? []) {
    // The sentence is the schema text, such as the title ceiling.
    messages.push(issue.message);
  }
  return messages;
}

/**
 * Builds a document with one text section per index.
 *
 * Purpose: one past the section ceiling is a 422, and the sections themselves stay small.
 * Inputs: count, how many text sections to include.
 * Side effects: none.
 */
function documentWithSectionCount(count: number): unknown {
  const sections = [];
  for (let index = 0; index < count; index += 1) {
    // Each row is otherwise valid, so the failure is the list length.
    sections.push({
      id: `text-${index}`,
      type: "text",
      title: "T",
      description: "",
      titleColor: "#112233",
      descriptionColor: "#334455",
    });
  }
  return {
    schemaVersion: 1,
    data: { sections },
  };
}

/**
 * Builds a carousel with one slide per index.
 *
 * Purpose: one past the carousel ceiling is a 422, and each slide is a short valid URL.
 * Inputs: count, how many slides to include.
 * Side effects: none.
 */
function documentWithImageCount(count: number): unknown {
  const images = [];
  for (let index = 0; index < count; index += 1) {
    // The address is short and absolute. The failure is the slide count.
    images.push({
      id: `img-${index}`,
      url: "https://example.com/slide.jpg",
      alt: "",
    });
  }
  return {
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
  };
}

/**
 * Replaces the only title with one character past the ceiling.
 *
 * Purpose: the 422 names the title, and the stored row keeps the shorter title.
 * Inputs: document, a one-section text document.
 * Side effects: none. The input document is copied first.
 */
function withTitlePastTheLimit(document: EditableDocument): unknown {
  const copy = structuredClone(document);
  const section = copy.data.sections[0];
  // Index 0 is the only text block in the stored fixture.
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected a text section.");
  }
  // One past the shared ceiling. The copy is the rejected body.
  section.title = "T".repeat(LIMITS.maxTitleCharacters + 1);
  return copy;
}

/**
 * Builds a CTA whose label is only spaces.
 *
 * Purpose: a blank label is 422, and the other CTA fields are valid.
 * Inputs: none.
 * Side effects: none.
 */
function blankCtaDocument(): unknown {
  // The ends trim to nothing, so the label fails the non-blank check.
  return {
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
  };
}

/**
 * Posts one JSON body.
 *
 * Purpose: create the row the update tests then change.
 * Inputs: app, the server. payload, the JSON value.
 * Side effects: injects one POST.
 */
function postJson(app: FastifyInstance, payload: unknown): Promise<InjectedResponse> {
  // The payload is text so the test controls the bytes the parser sees.
  return app.inject({
    method: "POST",
    url: "/v1/configurations",
    headers: jsonHeaders(),
    payload: JSON.stringify(payload),
  });
}

/**
 * Loads one configuration.
 *
 * Purpose: read the document back after a write or a rejection.
 * Inputs: app, the server. id, the configuration id.
 * Side effects: injects one GET.
 */
function getJson(app: FastifyInstance, id: string, token = serviceToken): Promise<InjectedResponse> {
  // GET uses the bearer token and does not send If-Match.
  return app.inject({
    method: "GET",
    url: `/v1/configurations/${id}`,
    headers: readHeaders(token),
  });
}

/**
 * Replaces one configuration.
 *
 * Purpose: send a whole editable document and an optional If-Match validator.
 * Inputs: app, the server. id, the path id. payload, the JSON value. ifMatch, the header value when the test sends one.
 * Side effects: injects one PUT.
 */
function putJson(
  app: FastifyInstance,
  id: string,
  payload: unknown,
  ifMatch?: string,
  token = serviceToken,
  extraHeaders?: Record<string, string>,
): Promise<InjectedResponse> {
  const headers = {
    ...jsonHeaders(token),
    ...extraHeaders,
  };
  // Omit the header entirely when the test is the missing-precondition case.
  if (ifMatch !== undefined) {
    headers["if-match"] = ifMatch;
  }
  return app.inject({
    method: "PUT",
    url: `/v1/configurations/${id}`,
    headers,
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
 * Asserts a contract error body.
 *
 * Purpose: the JSON matches the shared error schema and carries no stack or token.
 * Inputs: response, the injected response. statusCode, code, and message, the expected error.
 * Side effects: none.
 */
function expectContractError(response: InjectedResponse, statusCode: number, code: ErrorCode, message: string): ErrorBody {
  const body = errorBodySchema.parse(response.json());
  // The status, code, and sentence are the contract. The request id matches the header.
  expect(response.statusCode).toBe(statusCode);
  expect(body.error.code).toBe(code);
  expect(body.error.message).toBe(message);
  expect(body.error.requestId).toBe(headerValue(response.headers, "x-request-id"));
  expect(response.body).not.toContain(serviceToken);
  expect(response.body).not.toContain(wrongToken);
  expect(response.body).not.toContain("stack");
  expect(response.headers.etag).toBeUndefined();
  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  return body;
}

/**
 * Asserts a successful replacement.
 *
 * Purpose: 200 returns the new configuration, the new strong ETag, and no Location.
 * Inputs: response, the injected response. document, the document that should now be stored. revision, the new revision.
 * Side effects: none.
 */
function expectUpdated(response: InjectedResponse, document: EditableDocument, revision: number): Configuration {
  const parsed = configurationSchema.parse(response.json());
  // The body is the schema value. A client-supplied revision is not echoed as the stored one.
  expect(response.json()).toEqual(parsed);
  expect(response.statusCode).toBe(200);
  expect(headerValue(response.headers, "content-type")).toContain("application/json");
  expect(headerValue(response.headers, "cache-control")).toBe("private, no-store");
  expectStrongEtag(response.headers, revision);
  expect(response.headers.location).toBeUndefined();
  expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  expect(parsed.revision).toBe(revision);
  expect(parsed.schemaVersion).toBe(1);
  expect(parsed.data).toEqual(document.data);
  expect(parsed.updatedAt.endsWith("Z")).toBe(true);
  expect(response.body).not.toContain(serviceToken);
  return parsed;
}

/**
 * Waits long enough for the database clock to move to a later millisecond.
 *
 * Purpose: the returned updatedAt is millisecond precision, so the next write must be visibly later.
 * Inputs: none.
 * Side effects: waits about 50 milliseconds.
 */
async function waitForClock(): Promise<void> {
  /**
   * Ends the wait.
   *
   * Purpose: finish the promise from the timer.
   * Inputs: resolve, the promise resolver.
   * Side effects: schedules a timer.
   */
  function finishWaiting(resolve: () => void): void {
    // The timer is the whole wait. It does not touch the database.
    setTimeout(resolve, 50);
  }

  await new Promise<void>(finishWaiting);
}

/**
 * Creates a document and loads the strong ETag.
 *
 * Purpose: the following PUT uses the ETag from GET, which matches the create response.
 * Inputs: app, the server. document, the editable document to store.
 * Side effects: inserts one row.
 */
async function createAndLoad(
  app: FastifyInstance,
  document: EditableDocument,
): Promise<{ configuration: Configuration; etag: string; body: unknown }> {
  const created = await postJson(app, document);
  const configuration = configurationSchema.parse(created.json());
  // Create is revision 1. The update tests start from that row.
  expect(created.statusCode).toBe(201);
  expectStrongEtag(created.headers, 1);
  const loaded = await getJson(app, configuration.id);
  const etag = headerValue(loaded.headers, "etag");
  // GET and the write agree. If-Match will send this quoted revision.
  expect(loaded.statusCode).toBe(200);
  expect(loaded.json()).toEqual(created.json());
  expect(etag).toBe(headerValue(created.headers, "etag"));
  expect(etag).toBe(`"${configuration.revision}"`);
  return { configuration, etag, body: loaded.json() };
}

/**
 * Asserts a matching If-Match replaces the whole document.
 *
 * Purpose: one field change round-trips, then a shorter document replaces every section.
 * Inputs: none.
 * Side effects: inserts one row, updates it twice, and deletes it during cleanup.
 */
async function expectUpdateRoundTripsTheWholeDocument(): Promise<void> {
  const document = demoDocument();
  const renamed = withTextTitle(document, "Updated this week");
  const replacement = oneSectionDocument("Only section");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    // The database timestamp has to move by at least one millisecond.
    await waitForClock();
    const updated = await putJson(app, created.configuration.id, renamed, created.etag, serviceToken, {
      "x-tenant-id": attackerTenant,
    });
    const updatedBody = expectUpdated(updated, renamed, created.configuration.revision + 1);
    const afterRename = await readStoredRow(created.configuration.id);
    // The caller header did not choose a tenant. The stored clock is later, and the revision grew by one.
    expect(updated.body).not.toContain(attackerTenant);
    expect(Date.parse(updatedBody.updatedAt)).toBeGreaterThan(Date.parse(created.configuration.updatedAt));
    expect(afterRename.updatedAt > before.updatedAt).toBe(true);
    expect(afterRename.revision).toBe("2");
    expect(afterRename.dataText).not.toBe(before.dataText);
    expect(updatedBody.data.sections.map((section) => section.type)).toEqual([
      "carousel",
      "text",
      "cta",
      "carousel",
      "text",
      "cta",
    ]);
    const loaded = await getJson(app, created.configuration.id);
    // GET returns the new sections, the new revision, and the later timestamp.
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(updated.json());
    expectStrongEtag(loaded.headers, 2);
    const replaced = await putJson(app, created.configuration.id, replacement, headerValue(updated.headers, "etag"));
    const replacedBody = expectUpdated(replaced, replacement, 3);
    const loadedReplacement = await getJson(app, created.configuration.id);
    // The second PUT stored only the one section. The earlier sections are gone.
    expect(loadedReplacement.json()).toEqual(replaced.json());
    expect(replacedBody.data.sections).toHaveLength(1);
    expect(JSON.stringify(loadedReplacement.json())).not.toContain("New this week");
    const beforePatch = await readStoredRow(created.configuration.id);
    const patched = await app.inject({
      method: "PATCH",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: {
        ...jsonHeaders(),
        "if-match": '"3"',
      },
      payload: JSON.stringify(renamed),
    });
    // PATCH is not a section edit. The stored row stays the full replacement.
    expect(patched.statusCode).toBe(404);
    expect(patched.body).not.toContain(serviceToken);
    expect(await readStoredRow(created.configuration.id)).toEqual(beforePatch);
    expect(await countTenantRows(attackerTenant)).toBe(0);
  });
}

/**
 * Asserts a stale If-Match does not replace the winner.
 *
 * Purpose: the previous ETag is 412 after a successful update, and GET still shows the winner.
 * Inputs: none.
 * Side effects: inserts one row, updates it once, and deletes it during cleanup.
 */
async function expectStaleIfMatchKeepsTheWinner(): Promise<void> {
  const document = demoDocument();
  const winner = withTextTitle(document, "Winner title");
  const loser = withTextTitle(document, "Loser title");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const won = await putJson(app, created.configuration.id, winner, created.etag);
    const wonBody = expectUpdated(won, winner, 2);
    const storedWinner = await readStoredRow(created.configuration.id);
    const stale = await putJson(app, created.configuration.id, loser, created.etag);
    const staleBody = expectContractError(stale, 412, "PRECONDITION_FAILED", PRECONDITION_FAILED_MESSAGE);
    // The loser did not write. The winner's JSON, revision, and timestamp stay together.
    expect(staleBody.error.issues).toBeUndefined();
    expect(headerValue(stale.headers, "cache-control")).toBe("private, no-store");
    expect(stale.body).not.toContain("Loser title");
    expect(await readStoredRow(created.configuration.id)).toEqual(storedWinner);
    const loaded = await getJson(app, created.configuration.id);
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(won.json());
    expect(configurationSchema.parse(loaded.json())).toEqual(wonBody);
  });
}

/**
 * Asserts exactly one of two original-ETag updates commits.
 *
 * Purpose: both callers send the revision from create. The stored revision increases by one.
 * Inputs: none.
 * Side effects: inserts one row, commits one update, and deletes it during cleanup.
 */
async function expectOneOfTwoOriginalEtagsCommits(): Promise<void> {
  const document = demoDocument();
  const leftDocument = withTextTitle(document, "Left concurrent title");
  const rightDocument = withTextTitle(document, "Right concurrent title");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const [left, right] = await Promise.all([
      putJson(app, created.configuration.id, leftDocument, created.etag),
      putJson(app, created.configuration.id, rightDocument, created.etag),
    ]);
    const statuses = [left.statusCode, right.statusCode].sort((first, second) => first - second);
    // One commit and one conflict. The revision does not become 3.
    expect(statuses).toEqual([200, 412]);
    const winner = left.statusCode === 200 ? left : right;
    const loser = winner === left ? right : left;
    const winnerDocument = winner === left ? leftDocument : rightDocument;
    const loserDocument = winner === left ? rightDocument : leftDocument;
    const winnerBody = expectUpdated(winner, winnerDocument, 2);
    const loserBody = expectContractError(loser, 412, "PRECONDITION_FAILED", PRECONDITION_FAILED_MESSAGE);
    expect(loserBody.error.issues).toBeUndefined();
    const winnerSection = winnerDocument.data.sections[1];
    const loserSection = loserDocument.data.sections[1];
    // Both documents change the same text section, so each title identifies one writer.
    if (winnerSection === undefined || winnerSection.type !== "text" || loserSection === undefined || loserSection.type !== "text") {
      throw new Error("Expected the racing text sections.");
    }
    expect(loser.body).not.toContain(loserSection.title);
    const loaded = await getJson(app, created.configuration.id);
    const stored = await readStoredRow(created.configuration.id);
    // GET shows the winner. The stored revision increased by one.
    expect(loaded.json()).toEqual(winner.json());
    expect(configurationSchema.parse(loaded.json())).toEqual(winnerBody);
    expect(stored.revision).toBe("2");
    expect(stored.dataText).toContain(winnerSection.title);
    expect(stored.dataText).not.toContain(loserSection.title);
  });
}

/**
 * Asserts missing, star, and weak preconditions do not write.
 *
 * Purpose: those If-Match values are 428, and the stored JSON stays put.
 * Inputs: none.
 * Side effects: inserts one row, rejects four puts, and deletes the row during cleanup.
 */
async function expectMissingWeakAndStarPreconditionsDoNotWrite(): Promise<void> {
  const document = demoDocument();
  const replacement = withTextTitle(document, "Must not replace");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const missing = await putJson(app, created.configuration.id, replacement);
    const star = await putJson(app, created.configuration.id, replacement, "*");
    const weak = await putJson(app, created.configuration.id, replacement, 'W/"1"');
    const unquoted = await putJson(app, created.configuration.id, replacement, "1");
    for (const response of [missing, star, weak, unquoted]) {
      const body = expectContractError(response, 428, "PRECONDITION_REQUIRED", PRECONDITION_REQUIRED_MESSAGE);
      // None of these is a stale revision. The row is not updated.
      expect(body.error.issues).toBeUndefined();
      expect(headerValue(response.headers, "cache-control")).toBe("private, no-store");
      expect(response.body).not.toContain("Must not replace");
      expect(await readStoredRow(created.configuration.id)).toEqual(before);
    }
    const loaded = await getJson(app, created.configuration.id);
    expect(loaded.json()).toEqual(created.body);
    expect(await countTenantRows(tenantId)).toBe(1);
  });
}

/**
 * Asserts an unknown id is not found and is not inserted.
 *
 * Purpose: PUT is not an upsert. A miss is 404 after the repository distinguishes it from a conflict.
 * Inputs: none.
 * Side effects: inserts nothing for the request tenant.
 */
async function expectUnknownIdDoesNotInsert(): Promise<void> {
  const document = demoDocument();
  const unknownIds = [`cfg_${crypto.randomUUID()}`, "not-a-configuration"];
  await withApp(requireRepository(), async (app) => {
    const first = await putJson(app, unknownIds[0] ?? "", document, '"1"');
    const second = await putJson(app, unknownIds[1] ?? "", document, '"9"');
    for (const response of [first, second]) {
      const body = expectContractError(response, 404, "NOT_FOUND", CONFIGURATION_NOT_FOUND_MESSAGE);
      // A well-formed revision for a missing id is not a 412, and the body does not describe a document.
      expect(body.error.issues).toBeUndefined();
      expect(headerValue(response.headers, "cache-control")).toBe("private, no-store");
      expect(response.body).not.toContain("schemaVersion");
      expect(response.body).not.toContain("New this week");
    }
    expect(responseOmitsIds(first.body, unknownIds)).toBe(true);
    expect(responseOmitsIds(second.body, unknownIds)).toBe(true);
    for (const unknownId of unknownIds) {
      expect(await countRowsForId(unknownId)).toBe(0);
    }
    expect(await countTenantRows(tenantId)).toBe(0);
  });
}

/**
 * Reports whether a body contains any of the ids.
 *
 * Purpose: a 404 must not echo the missing configuration id.
 * Inputs: body, the response text. ids, the ids that must stay out of it.
 * Side effects: none.
 */
function responseOmitsIds(body: string, ids: readonly string[]): boolean {
  for (const id of ids) {
    // One echoed id would tell the caller which path was stored.
    if (body.includes(id)) {
      return false;
    }
  }
  return true;
}

/**
 * Asserts another tenant's id is not updated.
 *
 * Purpose: the same id and revision in another tenant are still not-found here, and that row stays put.
 * Inputs: none.
 * Side effects: inserts one row for a different tenant and deletes it during cleanup.
 */
async function expectAnotherTenantIsNotUpdated(): Promise<void> {
  const otherTenant = `tenant_http_put_other_${crypto.randomUUID()}`;
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
  // The other tenant's revision is 1. A forgotten tenant predicate would match If-Match "1".
  expect(inserted.ok).toBe(true);
  const before = await readStoredRow(otherId, otherTenant);
  const replacement = withTextTitle(demoDocument(), "Must not replace");
  await withApp(requireRepository(), async (app) => {
    const response = await putJson(app, otherId, replacement, '"1"');
    const body = expectContractError(response, 404, "NOT_FOUND", CONFIGURATION_NOT_FOUND_MESSAGE);
    // The response does not reveal the other tenant's title, and this tenant gains no row.
    expect(body.error.issues).toBeUndefined();
    expect(response.body).not.toContain(privateTitle);
    expect(response.body).not.toContain("Must not replace");
    expect(response.body).not.toContain(otherTenant);
    expect(await countTenantRows(tenantId)).toBe(0);
    expect(await countRowsForId(otherId)).toBe(1);
  });
  expect(await readStoredRow(otherId, otherTenant)).toEqual(before);
}

/**
 * Asserts invalid documents do not change the stored JSON.
 *
 * Purpose: color, URL, duplicate ids, schema version, and a body revision fail before a write.
 * Inputs: none.
 * Side effects: inserts one row, rejects the puts, and deletes the row during cleanup.
 */
async function expectInvalidUpdatesLeaveTheStoredJson(): Promise<void> {
  const document = demoDocument();
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const cases: { payload: unknown; path: string }[] = [
      { payload: withSchemaVersionTwo(document), path: "schemaVersion" },
      { payload: withQuizSection(document), path: "data.sections[0].type" },
      { payload: withTitleColor(document, "#GGGGGG"), path: "data.sections[1].titleColor" },
      { payload: withTitleColor(document, "#12"), path: "data.sections[1].titleColor" },
      { payload: withCtaUrl(document, "javascript:alert(1)"), path: "data.sections[2].url" },
      { payload: withCtaUrl(document, "data:text/html,hello"), path: "data.sections[2].url" },
      { payload: withCtaUrl(document, "file:///C:/images/hero.jpg"), path: "data.sections[2].url" },
      { payload: withDuplicateSectionId(document), path: "data.sections[1].id" },
      { payload: withDuplicateImageId(document), path: "data.sections[0].images[1].id" },
      { payload: withPosition(document), path: "data.sections[0].position" },
      { payload: withOwnedKey(document, "id", "cfg_from_client"), path: "id" },
      { payload: withOwnedKey(document, "revision", 9), path: "revision" },
      { payload: withOwnedKey(document, "updatedAt", "2026-10-12T17:44:00.000Z"), path: "updatedAt" },
      { payload: withOwnedKey(document, "tenantId", attackerTenant), path: "tenantId" },
    ];
    for (const item of cases) {
      const response = await putJson(app, created.configuration.id, item.payload, created.etag);
      const body = expectContractError(response, 422, "VALIDATION_FAILED", VALIDATION_FAILED_MESSAGE);
      // The current ETag was valid. The bad payload still did not burn the revision.
      expect(issuePaths(body)).toContain(item.path);
      expect(headerValue(response.headers, "cache-control")).toBe("private, no-store");
      expect(await readStoredRow(created.configuration.id)).toEqual(before);
      const loaded = await getJson(app, created.configuration.id);
      expect(loaded.statusCode).toBe(200);
      expect(loaded.json()).toEqual(created.body);
    }
    expect(await countTenantRows(tenantId)).toBe(1);
    expect(await countTenantRows(attackerTenant)).toBe(0);
  });
}

/**
 * Asserts an invalid document does not call the repository.
 *
 * Purpose: validation runs before the conditional update, so a bad payload cannot increment a revision.
 * Inputs: none.
 * Side effects: injects one PUT against a spy.
 */
async function expectInvalidDocumentDoesNotCallTheRepository(): Promise<void> {
  const storage = createSpyRepository();
  const document = withTitleColor(demoDocument(), "#GGGGGG");
  await withApp(storage, async (app) => {
    const response = await putJson(app, "cfg_missing", document, '"1"');
    const body = expectContractError(response, 422, "VALIDATION_FAILED", VALIDATION_FAILED_MESSAGE);
    // The id is unknown too. The schema failure is returned before that lookup.
    expect(issuePaths(body)).toContain("data.sections[1].titleColor");
    expect(storage.insertConfiguration).not.toHaveBeenCalled();
    expect(storage.getConfiguration).not.toHaveBeenCalled();
    expect(storage.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts accepted colors are normalized and stored.
 *
 * Purpose: #123 and #12ABEF are accepted on PUT and saved as lowercase #rrggbb.
 * Inputs: none.
 * Side effects: inserts one row, updates it, and deletes it during cleanup.
 */
async function expectPutNormalizesColors(): Promise<void> {
  const original: EditableDocument = {
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "text-1",
          type: "text",
          title: "Color",
          description: "",
          titleColor: "#112233",
          descriptionColor: "#445566",
        },
      ],
    },
  };
  const payload = {
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "text-1",
          type: "text",
          title: "Color",
          description: "",
          titleColor: "#123",
          descriptionColor: "#12ABEF",
        },
        {
          id: "cta-1",
          type: "cta",
          label: "  Go  ",
          url: "https://example.com/go",
          backgroundColor: "#abc",
          labelColor: "#fff",
        },
      ],
    },
  };
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, original);
    const updated = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: {
        ...jsonHeaders(),
        "content-type": "application/json; charset=utf-8",
        "if-match": created.etag,
      },
      payload: JSON.stringify(payload),
    });
    const body = configurationSchema.parse(updated.json());
    // The short and mixed-case colors expand. The CTA label loses its end spaces.
    expect(updated.statusCode).toBe(200);
    expect(body.revision).toBe(2);
    expect(body.data.sections).toEqual([
      {
        id: "text-1",
        type: "text",
        title: "Color",
        description: "",
        titleColor: "#112233",
        descriptionColor: "#12abef",
      },
      {
        id: "cta-1",
        type: "cta",
        label: "Go",
        url: "https://example.com/go",
        backgroundColor: "#aabbcc",
        labelColor: "#ffffff",
      },
    ]);
    expect(await readStoredData(body.id)).toEqual(body.data);
    const loaded = await getJson(app, body.id);
    expect(loaded.json()).toEqual(updated.json());
  });
}

/**
 * Asserts a missing or wrong token does not call the repository.
 *
 * Purpose: update rejects a bad credential before a read or a write.
 * Inputs: none.
 * Side effects: injects two requests against a spy.
 */
async function expectRejectedCredentialsDoNotCallTheRepository(): Promise<void> {
  const storage = createSpyRepository();
  const document = demoDocument();
  await withApp(storage, async (app) => {
    const missing = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      headers: {
        "content-type": "application/json",
        "if-match": '"1"',
      },
      payload: JSON.stringify(document),
    });
    const wrong = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      headers: {
        authorization: `Bearer ${wrongToken}`,
        "content-type": "application/json",
        "if-match": '"1"',
        "x-tenant-id": attackerTenant,
      },
      payload: JSON.stringify(document),
    });
    for (const response of [missing, wrong]) {
      const body = expectContractError(response, 401, "UNAUTHORIZED", AUTHENTICATION_FAILED_MESSAGE);
      // The body does not say which credential check failed.
      expect(body.error.issues).toBeUndefined();
      expect(response.body).not.toContain(attackerTenant);
    }
    expect(storage.insertConfiguration).not.toHaveBeenCalled();
    expect(storage.getConfiguration).not.toHaveBeenCalled();
    expect(storage.updateConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts a missing or wrong token leaves the stored row in place.
 *
 * Purpose: an unauthenticated PUT does not replace the document or its timestamp.
 * Inputs: none.
 * Side effects: inserts one row, rejects two puts, and deletes the row during cleanup.
 */
async function expectRejectedCredentialsLeaveTheRow(): Promise<void> {
  const document = demoDocument();
  const replacement = withTextTitle(document, "Must not be stored");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const countBefore = await countTenantRows(tenantId);
    const missing = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: {
        "content-type": "application/json",
        "if-match": created.etag,
        "x-tenant-id": attackerTenant,
      },
      payload: JSON.stringify(replacement),
    });
    const wrong = await putJson(app, created.configuration.id, replacement, created.etag, wrongToken);
    // Both credentials fail before the conditional update.
    expect(missing.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(missing.body).not.toContain("Must not be stored");
    expect(wrong.body).not.toContain("Must not be stored");
    expect(await readStoredRow(created.configuration.id)).toEqual(before);
    expect(await countTenantRows(tenantId)).toBe(countBefore);
    expect(await countTenantRows(attackerTenant)).toBe(0);
    const loaded = await getJson(app, created.configuration.id);
    expect(loaded.json()).toEqual(created.body);
  });
}

/**
 * Asserts a repository exception stays internal.
 *
 * Purpose: the JSON is 500 INTERNAL, with the request id and no stack or token.
 * Inputs: none.
 * Side effects: injects one PUT against a spy.
 */
async function expectRepositoryThrowIsInternal(): Promise<void> {
  const storage = createSpyRepository();
  const failure = new Error(`UPDATE ${serviceToken} CorruptStoredTitle FROM configurations`);
  failure.stack = `${failure.stack ?? failure.message}\n    at updateConfiguration (repository.ts:12:3)`;
  vi.mocked(storage.updateConfiguration).mockRejectedValue(failure);
  const document = demoDocument();
  await withApp(storage, async (app) => {
    const response = await app.inject({
      method: "PUT",
      url: "/v1/configurations/cfg_demo",
      headers: {
        ...jsonHeaders(),
        "if-match": '"1"',
        "x-request-id": "put-trace-07",
      },
      payload: JSON.stringify(document),
    });
    const body = expectContractError(response, 500, "INTERNAL", INTERNAL_FAILURE_MESSAGE);
    // The safe sentence replaces the driver text. The caller id is the one we sent.
    expect(body.error.requestId).toBe("put-trace-07");
    expect(headerValue(response.headers, "x-request-id")).toBe("put-trace-07");
    expect(response.body).not.toContain("CorruptStoredTitle");
    expect(response.body).not.toContain("UPDATE");
    expect(response.body).not.toContain("repository.ts");
    expect(storage.updateConfiguration).toHaveBeenCalledTimes(1);
    expect(storage.insertConfiguration).not.toHaveBeenCalled();
  });
}

/**
 * Asserts parser failures do not change the row.
 *
 * Purpose: 400, 413, and 415 stay on the prompt 05 behavior for PUT.
 * Inputs: none.
 * Side effects: inserts one row, rejects three puts, and deletes the row during cleanup.
 */
async function expectParserFailuresDoNotUpdate(): Promise<void> {
  const document = demoDocument();
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const broken = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: {
        ...jsonHeaders(),
        "if-match": created.etag,
      },
      payload: "{",
    });
    const brokenBody = expectContractError(broken, 400, "MALFORMED_JSON", "The request body is not valid JSON.");
    expect(brokenBody.error.issues).toBeUndefined();
    const oversized = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: {
        ...jsonHeaders(),
        "if-match": created.etag,
      },
      payload: Buffer.alloc(LIMITS.maxPayloadBytes + 1, 0x7b),
    });
    expectContractError(oversized, 413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    const plain = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "content-type": "text/plain",
        "if-match": created.etag,
      },
      payload: JSON.stringify(withTextTitle(document, "Must not replace")),
    });
    expectContractError(plain, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
    // The matching ETag never reached a committed update.
    expect(await readStoredRow(created.configuration.id)).toEqual(before);
    const loaded = await getJson(app, created.configuration.id);
    expect(loaded.json()).toEqual(created.body);
  });
}

/**
 * Compares two UTC timestamps at millisecond resolution.
 *
 * Purpose: the response clock and the database clock are the same instant. The column keeps microseconds.
 * Inputs: left and right, ISO-8601 UTC timestamps.
 * Side effects: none.
 */
function sameDatabaseInstant(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  // A value that does not parse is not a database timestamp.
  if (Number.isNaN(leftMs) || Number.isNaN(rightMs)) {
    return false;
  }
  // Truncating microseconds can leave the two readings on adjacent milliseconds.
  return Math.abs(leftMs - rightMs) < 2;
}

/**
 * Reverses section order and the first carousel's slides.
 *
 * Purpose: the stored arrays follow the submitted order.
 * Inputs: document, a demo document with at least one carousel.
 * Side effects: none. The input document is not changed.
 */
function withReversedSections(document: EditableDocument): EditableDocument {
  const copy = structuredClone(document);
  // Screen order is the array order. The later section becomes the first.
  copy.data.sections.reverse();
  for (const section of copy.data.sections) {
    // The first carousel in the reversed list has its slides reversed too.
    if (section.type === "carousel") {
      section.images.reverse();
      break;
    }
  }
  return copy;
}

/**
 * Builds a document with no sections.
 *
 * Purpose: an empty list is a whole document, and saving it removes every previous section.
 * Inputs: none.
 * Side effects: none.
 */
function emptySectionDocument(): EditableDocument {
  // schemaVersion 1 accepts an empty section list.
  return {
    schemaVersion: 1,
    data: { sections: [] },
  };
}

/**
 * Builds a request that repeats If-Match.
 *
 * Purpose: supply two occurrences. The route must not keep only the first quoted revision.
 * Inputs: none.
 * Side effects: none.
 */
function duplicateIfMatchHeaders(): Record<string, string> {
  const headers = {
    authorization: `Bearer ${serviceToken}`,
    "content-type": "application/json",
    "if-match": ['"1"', '"2"'],
  };
  // The inject types list If-Match as one string. The array is the repeated header.
  return headers as unknown as Record<string, string>;
}

/**
 * Asserts non-canonical If-Match values do not write, and the current ETag still can.
 *
 * Purpose: leading zeros, lists, weak tags, an out-of-range integer, a query string, and duplicate headers are 428.
 * Inputs: none.
 * Side effects: inserts one row, updates it once, and deletes it during cleanup.
 */
async function expectNonCanonicalIfMatchDoesNotWrite(): Promise<void> {
  const document = demoDocument();
  const replacement = withTextTitle(document, "Must not land from a bad validator");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const headers: Array<string | undefined> = [
      "",
      "   ",
      " * ",
      ' W/"1"',
      "W/1",
      'w/"12"',
      'W/"caller-supplied-tag"',
      '""',
      '"0"',
      '"01"',
      '"-1"',
      '"1.5"',
      '"*"',
      '" 1"',
      '"1 "',
      '"+1"',
      '"1",',
      '"1", "2"',
      '"2147483648"',
      `"${"9".repeat(40)}"`,
    ];
    for (const ifMatch of headers) {
      const response = await putJson(app, created.configuration.id, replacement, ifMatch);
      const body = expectContractError(response, 428, "PRECONDITION_REQUIRED", PRECONDITION_REQUIRED_MESSAGE);
      // A leading zero is not revision 1, and an oversized integer is not a database error.
      expect(body.error.issues).toBeUndefined();
      expect(headerValue(response.headers, "cache-control")).toBe("private, no-store");
      expect(response.body).not.toContain("Must not land from a bad validator");
      expect(response.body).not.toContain("caller-supplied-tag");
      expect(await readStoredRow(created.configuration.id)).toEqual(before);
    }
    const duplicated = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: duplicateIfMatchHeaders(),
      payload: JSON.stringify(replacement),
    });
    const duplicatedBody = expectContractError(duplicated, 428, "PRECONDITION_REQUIRED", PRECONDITION_REQUIRED_MESSAGE);
    // Two If-Match headers are a list. The first quoted revision is not selected.
    expect(duplicatedBody.error.issues).toBeUndefined();
    expect(await readStoredRow(created.configuration.id)).toEqual(before);
    const queried = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}?if-match=${encodeURIComponent('"1"')}`,
      headers: jsonHeaders(),
      payload: JSON.stringify(replacement),
    });
    // The revision comes from the header. The query string is not a second If-Match.
    expectContractError(queried, 428, "PRECONDITION_REQUIRED", PRECONDITION_REQUIRED_MESSAGE);
    expect(await readStoredRow(created.configuration.id)).toEqual(before);
    const updated = await putJson(app, created.configuration.id, replacement, created.etag);
    // None of the rejected headers consumed revision 1.
    expectUpdated(updated, replacement, 2);
    expect((await readStoredRow(created.configuration.id)).revision).toBe("2");
  });
}

/**
 * Asserts a well-formed revision that is not current returns 412.
 *
 * Purpose: a future revision and the largest stored revision are conflicts, and the current ETag still updates.
 * Inputs: none.
 * Side effects: inserts one row, updates it once, and deletes it during cleanup.
 */
async function expectWellFormedMismatchDoesNotWrite(): Promise<void> {
  const document = demoDocument();
  const replacement = withTextTitle(document, "Future title");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    for (const ifMatch of ['"2"', '"2147483647"']) {
      const response = await putJson(app, created.configuration.id, replacement, ifMatch);
      const body = expectContractError(response, 412, "PRECONDITION_FAILED", PRECONDITION_FAILED_MESSAGE);
      // The row exists, so this is not 404, and the body does not carry the stored clock or revision.
      expect(body.error.issues).toBeUndefined();
      expect(headerValue(response.headers, "cache-control")).toBe("private, no-store");
      expect(response.body).not.toContain("Future title");
      expect(response.body).not.toContain('"revision"');
      expect(response.body).not.toContain(created.configuration.updatedAt);
      expect(response.body).not.toContain(before.updatedAt);
      expect(await readStoredRow(created.configuration.id)).toEqual(before);
    }
    const updated = await putJson(app, created.configuration.id, replacement, created.etag);
    // The conflict did not consume revision 1.
    expectUpdated(updated, replacement, 2);
    expect((await readStoredRow(created.configuration.id)).revision).toBe("2");
  });
}

/**
 * Asserts the write checks run in order.
 *
 * Purpose: authentication, the parser, and If-Match run before schema validation, and validation runs before the revision check.
 * Inputs: none.
 * Side effects: inserts one row, updates it once, and deletes it during cleanup.
 */
async function expectCheckOrder(): Promise<void> {
  const document = demoDocument();
  const replacement = withTextTitle(document, "Must not land early");
  const invalidColor = withTitleColor(document, "#GGGGGG");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const unauthenticated = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(invalidColor),
    });
    // A missing credential wins over a missing If-Match and an invalid document.
    expectContractError(unauthenticated, 401, "UNAUTHORIZED", AUTHENTICATION_FAILED_MESSAGE);
    const plain = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: {
        authorization: `Bearer ${serviceToken}`,
        "content-type": "text/plain",
      },
      payload: JSON.stringify(replacement),
    });
    // The media type is checked before If-Match.
    expectContractError(plain, 415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
    const broken = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: jsonHeaders(),
      payload: "{",
    });
    // Malformed JSON is 400 when If-Match is also missing.
    expectContractError(broken, 400, "MALFORMED_JSON", "The request body is not valid JSON.");
    const oversized = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: jsonHeaders(),
      payload: Buffer.alloc(LIMITS.maxPayloadBytes + 1, 0x7b),
    });
    // The size limit is 413 when If-Match is also missing.
    expectContractError(oversized, 413, "PAYLOAD_TOO_LARGE", "The request body is too large.");
    const missingHeader = await putJson(app, created.configuration.id, invalidColor);
    const missingBody = expectContractError(missingHeader, 428, "PRECONDITION_REQUIRED", PRECONDITION_REQUIRED_MESSAGE);
    // An unusable If-Match wins over a document that would also fail validation.
    expect(missingBody.error.issues).toBeUndefined();
    expect(missingHeader.body).not.toContain("#GGGGGG");
    const staleInvalid = await putJson(app, created.configuration.id, invalidColor, '"99"');
    const staleBody = expectContractError(staleInvalid, 422, "VALIDATION_FAILED", VALIDATION_FAILED_MESSAGE);
    // A bad document is 422 before the revision is compared, so a future ETag does not become 412.
    expect(issuePaths(staleBody)).toContain("data.sections[1].titleColor");
    expect(await readStoredRow(created.configuration.id)).toEqual(before);
    const updated = await putJson(app, created.configuration.id, replacement, created.etag);
    // The 422 did not consume revision 1.
    expectUpdated(updated, replacement, 2);
  });
}

/**
 * Asserts JSON that is not a document does not replace the row.
 *
 * Purpose: null, an array, a boolean, an empty object, and a body If-Match field are 422.
 * Inputs: none.
 * Side effects: inserts one row, rejects the puts, and deletes the row during cleanup.
 */
async function expectNonDocumentsDoNotReplace(): Promise<void> {
  const document = demoDocument();
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const cases: { payload: unknown; path: string }[] = [
      { payload: null, path: "$" },
      { payload: [], path: "$" },
      { payload: true, path: "$" },
      { payload: {}, path: "schemaVersion" },
      { payload: { ...document, ifMatch: created.etag }, path: "ifMatch" },
    ];
    for (const item of cases) {
      const response = await putJson(app, created.configuration.id, item.payload, created.etag);
      const body = expectContractError(response, 422, "VALIDATION_FAILED", VALIDATION_FAILED_MESSAGE);
      // The current ETag was usable. The payload is still not an editable document.
      expect(issuePaths(body)).toContain(item.path);
      expect(await readStoredRow(created.configuration.id)).toEqual(before);
      const loaded = await getJson(app, created.configuration.id);
      expect(loaded.json()).toEqual(created.body);
    }
  });
}

/**
 * Asserts an unchanged document still advances the revision.
 *
 * Purpose: a matching If-Match commits even when the section list is the same, and surrounding whitespace is still that ETag.
 * Inputs: none.
 * Side effects: inserts one row, updates it once, and deletes it during cleanup.
 */
async function expectSameDocumentStillAdvancesTheRevision(): Promise<void> {
  const document = demoDocument();
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    // The database timestamp has to move by at least one millisecond.
    await waitForClock();
    const updated = await putJson(app, created.configuration.id, document, `  ${created.etag}  `);
    const updatedBody = expectUpdated(updated, document, 2);
    const stored = await readStoredRow(created.configuration.id);
    // The same sections were written again. Revision and updatedAt still move, and the response clock is the database clock.
    expect(stored.revision).toBe("2");
    expect(stored.updatedAt > before.updatedAt).toBe(true);
    expect(sameDatabaseInstant(stored.updatedAt, updatedBody.updatedAt)).toBe(true);
    expect(await readStoredData(created.configuration.id)).toEqual(document.data);
    const loaded = await getJson(app, created.configuration.id);
    expect(loaded.json()).toEqual(updated.json());
    const stale = await putJson(app, created.configuration.id, document, created.etag);
    // The spaced header was the revision 1 validator. That validator is now stale.
    expectContractError(stale, 412, "PRECONDITION_FAILED", PRECONDITION_FAILED_MESSAGE);
    expect(await readStoredRow(created.configuration.id)).toEqual(stored);
  });
}

/**
 * Asserts the submitted order replaces the stored document.
 *
 * Purpose: reversed sections and slides are stored in that order, and a later empty list removes them.
 * Inputs: none.
 * Side effects: inserts one row, updates it twice, and deletes it during cleanup.
 */
async function expectSubmittedOrderReplacesTheDocument(): Promise<void> {
  const document = demoDocument();
  const reversed = withReversedSections(document);
  const emptied = emptySectionDocument();
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const reordered = await putJson(app, created.configuration.id, reversed, created.etag);
    const reorderedBody = expectUpdated(reordered, reversed, 2);
    // The first section is the old last section, and its carousel slides follow the submitted array.
    expect(reorderedBody.data.sections.map((section) => section.id)).toEqual(
      reversed.data.sections.map((section) => section.id),
    );
    const loaded = await getJson(app, created.configuration.id);
    expect(loaded.json()).toEqual(reordered.json());
    expect(await readStoredData(created.configuration.id)).toEqual(reversed.data);
    const cleared = await putJson(app, created.configuration.id, emptied, headerValue(reordered.headers, "etag"));
    const clearedBody = expectUpdated(cleared, emptied, 3);
    const loadedCleared = await getJson(app, created.configuration.id);
    // The empty list is the whole document. The earlier titles are gone.
    expect(loadedCleared.json()).toEqual(cleared.json());
    expect(clearedBody.data.sections).toEqual([]);
    expect(loadedCleared.body).not.toContain("New this week");
    expect(await readStoredData(created.configuration.id)).toEqual({ sections: [] });
  });
}

/**
 * Asserts a rate-limited update does not replace the row.
 *
 * Purpose: the authenticated PUT that exceeds the write ceiling is 429, and the previous commit stays readable.
 * Inputs: none.
 * Side effects: inserts one row, updates it once, rejects the next put, and deletes the row during cleanup.
 */
async function expectRateLimitLeavesTheEarlierUpdate(): Promise<void> {
  const document = demoDocument();
  const counted = withTextTitle(document, "Counted write");
  const blocked = withTextTitle(document, "Over the limit");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const updated = await putJson(app, created.configuration.id, counted, created.etag);
    const updatedBody = expectUpdated(updated, counted, 2);
    const beforeLimit = await readStoredRow(created.configuration.id);
    const limited = await putJson(app, created.configuration.id, blocked, headerValue(updated.headers, "etag"));
    const limitedBody = expectContractError(limited, 429, "RATE_LIMITED", RATE_LIMITED_MESSAGE);
    // The third authenticated write does not reach the conditional update.
    expect(limitedBody.error.issues).toBeUndefined();
    expect(limited.body).not.toContain("Over the limit");
    expect(await readStoredRow(created.configuration.id)).toEqual(beforeLimit);
    const loaded = await getJson(app, created.configuration.id);
    expect(loaded.json()).toEqual(updated.json());
    expect(configurationSchema.parse(loaded.json())).toEqual(updatedBody);
  }, 2);
}

/**
 * Asserts a blank server tenant does not update.
 *
 * Purpose: a blank or unset DEMO_TENANT_ID is 500, and the stored row stays with this tenant.
 * Inputs: none.
 * Side effects: inserts one row, rejects two puts, and deletes the row during cleanup.
 */
async function expectBlankTenantDoesNotUpdate(): Promise<void> {
  const document = demoDocument();
  const replacement = withTextTitle(document, "Must not change tenant");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    process.env[tenantKey] = "   ";
    const blank = await putJson(app, created.configuration.id, replacement, created.etag, serviceToken, {
      "x-tenant-id": attackerTenant,
    });
    delete process.env[tenantKey];
    const missing = await putJson(app, created.configuration.id, replacement, created.etag, serviceToken, {
      "x-tenant-id": attackerTenant,
    });
    for (const response of [blank, missing]) {
      const body = expectContractError(response, 500, "INTERNAL", INTERNAL_FAILURE_MESSAGE);
      // The caller header is not a tenant, and the response does not describe the document.
      expect(body.error.issues).toBeUndefined();
      expect(response.body).not.toContain(attackerTenant);
      expect(response.body).not.toContain("Must not change tenant");
      expect(response.body).not.toContain("DEMO_TENANT_ID");
    }
    expect(await readStoredRow(created.configuration.id)).toEqual(before);
    expect(await countRowsForId(created.configuration.id)).toBe(1);
    expect(await countTenantRows(attackerTenant)).toBe(0);
  });
}

/**
 * Asserts one invalid document reports every failed field.
 *
 * Purpose: a color and a URL that both fail are listed together, and the row stays put.
 * Inputs: none.
 * Side effects: inserts one row, rejects one put, and deletes the row during cleanup.
 */
async function expectUpdateListsEveryInvalidField(): Promise<void> {
  const document = demoDocument();
  const payload = withCtaUrl(withTitleColor(document, "#12") as EditableDocument, "javascript:alert(1)");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const response = await putJson(app, created.configuration.id, payload, created.etag);
    const body = expectContractError(response, 422, "VALIDATION_FAILED", VALIDATION_FAILED_MESSAGE);
    const paths = issuePaths(body);
    // Both fields are in the issues list. The response keeps path and message only.
    expect(paths).toContain("data.sections[1].titleColor");
    expect(paths).toContain("data.sections[2].url");
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const issue of body.error.issues ?? []) {
      expect(Object.keys(issue).sort()).toEqual(["message", "path"]);
    }
    expect(response.body).not.toContain("#12");
    expect(response.body).not.toContain("javascript:");
    expect(await readStoredRow(created.configuration.id)).toEqual(before);
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

/**
 * Asserts one-past-limit writes leave the stored row alone.
 *
 * Purpose: body size, section count, image count, title length, and a blank CTA label fail before a write.
 * Inputs: none.
 * Side effects: inserts one row, rejects five puts, and deletes the row during cleanup.
 */
async function expectLimitViolationsLeaveTheStoredRow(): Promise<void> {
  const document = oneSectionDocument("Stored title");
  await withApp(requireRepository(), async (app) => {
    const created = await createAndLoad(app, document);
    const before = await readStoredRow(created.configuration.id);
    const oversized = await app.inject({
      method: "PUT",
      url: `/v1/configurations/${created.configuration.id}`,
      headers: {
        ...jsonHeaders(),
        "if-match": created.etag,
      },
      // One byte past the shared ceiling. The bytes are not parsed as a document.
      payload: Buffer.alloc(LIMITS.maxPayloadBytes + 1, 0x7b),
    });
    expectContractError(oversized, 413, "PAYLOAD_TOO_LARGE", PAYLOAD_TOO_LARGE_MESSAGE);
    // The oversized body did not replace the stored title.
    expect(await readStoredRow(created.configuration.id)).toEqual(before);
    const cases: { payload: unknown; path: string; message: string }[] = [
      {
        payload: documentWithSectionCount(LIMITS.maxSections + 1),
        path: "data.sections",
        message: SECTION_LIMIT_MESSAGE,
      },
      {
        payload: documentWithImageCount(LIMITS.maxImagesPerCarousel + 1),
        path: "data.sections[0].images",
        message: CAROUSEL_IMAGE_LIMIT_MESSAGE,
      },
      {
        payload: withTitlePastTheLimit(document),
        path: "data.sections[0].title",
        message: TITLE_LIMIT_MESSAGE,
      },
      {
        payload: blankCtaDocument(),
        path: "data.sections[0].label",
        message: CTA_LABEL_REQUIRED_MESSAGE,
      },
    ];
    for (const item of cases) {
      const response = await putJson(app, created.configuration.id, item.payload, created.etag);
      const body = expectContractError(response, 422, "VALIDATION_FAILED", VALIDATION_FAILED_MESSAGE);
      // The path and the shared sentence name the limit. The stored row is still the original.
      expect(issuePaths(body)).toContain(item.path);
      expect(issueMessages(body)).toContain(item.message);
      expect(await readStoredRow(created.configuration.id)).toEqual(before);
    }
    const loaded = await getJson(app, created.configuration.id);
    // GET still returns the document that was created, including its revision.
    expect(loaded.statusCode).toBe(200);
    expect(loaded.json()).toEqual(created.body);
  });
}

rememberEnv();
beforeAll(openDatabase, 20_000);
beforeEach(applyAuthEnv);
afterEach(cleanupTest);
afterAll(closeDatabase, 20_000);

describe("conditional update", () => {
  it("updates a document when If-Match is the current strong ETag", expectUpdateRoundTripsTheWholeDocument, 20_000);
  it("returns 412 for the previous ETag and keeps the winner", expectStaleIfMatchKeepsTheWinner, 20_000);
  it("accepts one of two updates that send the original ETag", expectOneOfTwoOriginalEtagsCommits, 20_000);
  it("returns 428 when If-Match is missing, star, or weak", expectMissingWeakAndStarPreconditionsDoNotWrite, 20_000);
  it("returns 404 for an unknown id and does not insert", expectUnknownIdDoesNotInsert, 20_000);
  it("does not update another tenant's configuration", expectAnotherTenantIsNotUpdated, 20_000);
  it("returns 422 for an invalid document and leaves the stored JSON unchanged", expectInvalidUpdatesLeaveTheStoredJson, 20_000);
  it("validates the document before the conditional update", expectInvalidDocumentDoesNotCallTheRepository, 20_000);
  it("normalizes accepted colors on update", expectPutNormalizesColors, 20_000);
  it("rejects a missing or wrong token before the repository", expectRejectedCredentialsDoNotCallTheRepository, 20_000);
  it("does not change the row when the token is missing or wrong", expectRejectedCredentialsLeaveTheRow, 20_000);
  it("returns 500 when the repository throws", expectRepositoryThrowIsInternal, 20_000);
  it("keeps malformed, oversized, and non-JSON bodies from updating", expectParserFailuresDoNotUpdate, 20_000);
  it("returns 428 for a non-canonical If-Match and still accepts the current ETag", expectNonCanonicalIfMatchDoesNotWrite, 20_000);
  it("returns 412 for a well-formed revision that is not current", expectWellFormedMismatchDoesNotWrite, 20_000);
  it("checks the credential, parser, and If-Match before validation", expectCheckOrder, 20_000);
  it("returns 422 for JSON that is not a document", expectNonDocumentsDoNotReplace, 20_000);
  it("advances the revision when the submitted document is unchanged", expectSameDocumentStillAdvancesTheRevision, 20_000);
  it("stores the submitted section order and an empty section list", expectSubmittedOrderReplacesTheDocument, 20_000);
  it("returns 429 before a later update and keeps the earlier write", expectRateLimitLeavesTheEarlierUpdate, 20_000);
  it("returns 500 when the server tenant is blank and does not update", expectBlankTenantDoesNotUpdate, 20_000);
  it("lists every invalid field and leaves the stored JSON unchanged", expectUpdateListsEveryInvalidField, 20_000);
  it("returns 413 or 422 one past each limit and leaves the stored row unchanged", expectLimitViolationsLeaveTheStoredRow, 20_000);
});
