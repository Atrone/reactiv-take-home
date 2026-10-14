import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createDemoDocument,
  editableDocumentSchema,
  type Configuration,
  type EditableDocument,
} from "@reactiv/contracts";
import type { Pool, PoolClient } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "../db/migrate.js";
import { migrationsDirectory } from "../db/paths.js";
import { rollbackQuietly } from "../db/rollback.js";
import { createTestPool } from "../db/test-database.js";
import {
  CONDITIONAL_UPDATE_SQL,
  ConfigurationContractError,
  INSERT_CONFIGURATION_SQL,
  SELECT_CONFIGURATION_SQL,
  TENANT_SCOPED_EXISTS_SQL,
  createConfigurationRepository,
  updateConfigurationOnClient,
  type ConfigurationRepository,
  type GetConfigurationResult,
  type InsertConfigurationResult,
  type UpdateConfigurationInput,
  type UpdateConfigurationResult,
} from "./repository.js";

let pool: Pool | undefined;
let repository: ConfigurationRepository | undefined;
const created: { tenantId: string; id: string }[] = [];

/**
 * Returns the open test pool.
 *
 * Purpose: fail the test when a helper runs before the database is open.
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
 * Returns the repository under test.
 *
 * Purpose: keep each test on the pool opened in beforeAll.
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
 * Remembers a row this file created.
 *
 * Purpose: delete test rows without touching a future demo seed.
 * Inputs: tenantId and id, the row key.
 * Side effects: appends that key to the cleanup list.
 */
function track(tenantId: string, id: string): void {
  // The demo seed is a later prompt. These tests keep their own keys.
  if (tenantId === "tenant_demo" || id === "cfg_demo") {
    throw new Error("Repository tests keep their rows out of the demo seed.");
  }
  created.push({ tenantId, id });
}

/**
 * Builds a new tenant id for one test.
 *
 * Purpose: isolate rows from other tests and from the demo tenant.
 * Inputs: none.
 * Side effects: none.
 */
function newTenantId(): string {
  // The prefix is not tenant_demo.
  return `tenant_repo_${crypto.randomUUID()}`;
}

/**
 * Builds a new configuration id for one test.
 *
 * Purpose: the repository receives an id. This prompt does not generate ids in the service.
 * Inputs: none.
 * Side effects: none.
 */
function newConfigurationId(): string {
  // The prefix plus a UUID is not cfg_demo.
  return `cfg_${crypto.randomUUID()}`;
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
 * Purpose: round-trip sections, array order, and colors through Postgres.
 * Inputs: none.
 * Side effects: none.
 */
function demoDocument(): EditableDocument {
  // Ten generator calls cover two carousels, their slides, two text blocks, and two CTAs.
  return createDemoDocument(demoIdGenerator());
}

/**
 * Replaces the first demo text title.
 *
 * Purpose: build a second valid document that differs in stored JSON.
 * Inputs: document, a demo document. title, the replacement title.
 * Side effects: none. The input document is not changed.
 */
function withTextTitle(document: EditableDocument, title: string): EditableDocument {
  const sections = [];
  let replaced = false;
  for (const section of document.data.sections) {
    // Only the first "New this week" block changes. The other text block stays.
    if (!replaced && section.type === "text" && section.title === "New this week") {
      replaced = true;
      sections.push({ ...section, title });
      continue;
    }
    sections.push(section);
  }
  // A fixture drift should fail here instead of comparing two identical documents.
  if (!replaced) {
    throw new Error("The fixture text title was not replaced.");
  }
  return editableDocumentSchema.parse({
    schemaVersion: document.schemaVersion,
    data: { sections },
  });
}

/**
 * Lists section types in array order.
 *
 * Purpose: assert screen order without comparing every field first.
 * Inputs: document, a validated document.
 * Side effects: none.
 */
function sectionTypes(document: EditableDocument): string[] {
  const types: string[] = [];
  for (const section of document.data.sections) {
    types.push(section.type);
  }
  return types;
}

/**
 * Lists section ids in array order.
 *
 * Purpose: show that an update replaced the ordered list rather than merging it.
 * Inputs: document, a validated document.
 * Side effects: none.
 */
function sectionIds(document: EditableDocument): string[] {
  const ids: string[] = [];
  for (const section of document.data.sections) {
    ids.push(section.id);
  }
  return ids;
}

/**
 * Lists carousel image ids in array order.
 *
 * Purpose: image order is the array order inside the stored JSON.
 * Inputs: document, a validated document.
 * Side effects: none.
 */
function imageIds(document: EditableDocument): string[] {
  const ids: string[] = [];
  for (const section of document.data.sections) {
    // Text and CTA sections have no images.
    if (section.type !== "carousel") {
      continue;
    }
    for (const image of section.images) {
      ids.push(image.id);
    }
  }
  return ids;
}

/**
 * Builds an empty validated document.
 *
 * Purpose: the smallest payload the contract accepts.
 * Inputs: none.
 * Side effects: none.
 */
function emptyDocument(): EditableDocument {
  // schemaVersion 1 and an empty section list are valid. There is no position field.
  return editableDocumentSchema.parse({
    schemaVersion: 1,
    data: { sections: [] },
  });
}

/**
 * Builds a text-only document in the given section order.
 *
 * Purpose: updates can reorder, recolor, and drop sections.
 * Inputs: sections, the id, title, and title color of each text block, already in screen order.
 * Side effects: none.
 */
function textDocument(sections: readonly { id: string; title: string; titleColor: string }[]): EditableDocument {
  const blocks: {
    id: string;
    type: "text";
    title: string;
    description: string;
    titleColor: string;
    descriptionColor: string;
  }[] = [];
  for (const section of sections) {
    // Description stays empty. Title color is the field an update is allowed to replace.
    blocks.push({
      id: section.id,
      type: "text" as const,
      title: section.title,
      description: "",
      titleColor: section.titleColor,
      descriptionColor: "#445566",
    });
  }
  return editableDocumentSchema.parse({
    schemaVersion: 1,
    data: { sections: blocks },
  });
}

/**
 * Builds a one-carousel document with two slides in the given order.
 *
 * Purpose: an update can swap slide order without sorting by id.
 * Inputs: imageIds, the two slide ids in screen order.
 * Side effects: none.
 */
function carouselDocument(orderedImageIds: readonly [string, string]): EditableDocument {
  // Both URLs are absolute https URLs on example.com. Alt text stays short.
  return editableDocumentSchema.parse({
    schemaVersion: 1,
    data: {
      sections: [
        {
          id: "carousel-1",
          type: "carousel",
          aspectRatio: "square",
          images: [
            { id: orderedImageIds[0], url: "https://example.com/one.jpg", alt: "one" },
            { id: orderedImageIds[1], url: "https://example.com/two.jpg", alt: "two" },
          ],
        },
      ],
    },
  });
}

/**
 * Counts update results by outcome.
 *
 * Purpose: a concurrent pair must have one success and one revision conflict.
 * Inputs: results, the update results from one race.
 * Side effects: none.
 */
function countUpdateOutcomes(results: readonly UpdateConfigurationResult[]): {
  succeeded: number;
  conflicts: number;
  missing: number;
} {
  let succeeded = 0;
  let conflicts = 0;
  let missing = 0;
  for (const result of results) {
    // A success committed. The other two reasons are the typed misses.
    if (result.ok) {
      succeeded += 1;
      continue;
    }
    if (result.reason === "revision-conflict") {
      conflicts += 1;
      continue;
    }
    missing += 1;
  }
  return { succeeded, conflicts, missing };
}

/**
 * Unwraps a successful insert.
 *
 * Purpose: keep the rest of a test on the configuration object.
 * Inputs: result, the insert result.
 * Side effects: throws when the insert was a unique violation.
 */
function expectInserted(result: InsertConfigurationResult): Configuration {
  // A unique violation is a real result, and this helper is for the success path.
  if (!result.ok) {
    throw new Error(`Expected an insert, received ${result.reason}.`);
  }
  return result.configuration;
}

/**
 * Unwraps a successful update.
 *
 * Purpose: read the committed configuration from an update result.
 * Inputs: result, the update result.
 * Side effects: throws when the update was not-found or a revision conflict.
 */
function expectUpdated(result: UpdateConfigurationResult): Configuration {
  // A conflict or a miss is a real result, and this helper is for the success path.
  if (!result.ok) {
    throw new Error(`Expected an update, received ${result.reason}.`);
  }
  return result.configuration;
}

/**
 * Unwraps a successful get.
 *
 * Purpose: read the stored configuration after a write.
 * Inputs: result, the get result.
 * Side effects: throws when the row is not-found.
 */
function expectStored(result: GetConfigurationResult): Configuration {
  // not-found stops the test before a later field read.
  if (!result.ok) {
    throw new Error(`Expected a configuration, received ${result.reason}.`);
  }
  return result.configuration;
}

/**
 * Checks an ISO-8601 UTC timestamp from the database.
 *
 * Purpose: revision metadata includes a server timestamp close to the write.
 * Inputs: value, the updatedAt string.
 * Side effects: none. Failed expectations fail the test.
 */
function expectUtcTimestamp(value: string): void {
  // toISOString writes milliseconds and a Z suffix.
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const parsed = Date.parse(value);
  // The contract accepts the string, and it still has to be an instant.
  expect(Number.isNaN(parsed)).toBe(false);
  // The database clock and this process should agree within a minute.
  expect(Math.abs(Date.now() - parsed)).toBeLessThan(60_000);
}

/**
 * Waits for a short interval.
 *
 * Purpose: separate two database timestamps by more than one millisecond.
 * Inputs: milliseconds, how long to wait.
 * Side effects: schedules a timer.
 */
function wait(milliseconds: number): Promise<void> {
  return new Promise(finishWaiting);

  /**
   * Resolves the wait.
   *
   * Purpose: finish the promise from the timer.
   * Inputs: resolve, the promise resolver.
   * Side effects: schedules a timer.
   */
  function finishWaiting(resolve: () => void): void {
    // The timer is the whole wait. It does not touch the database.
    setTimeout(resolve, milliseconds);
  }
}

/** Stored JSON text and the database timestamp, both as text. */
type StoredJson = {
  data: string;
  updatedAt: string;
};

/**
 * Reads the stored JSON and timestamp as text.
 *
 * Purpose: compare the whole payload and the timestamp after a rejected update.
 * Inputs: tenantId and id, the row key.
 * Side effects: reads one row.
 */
async function readStoredJson(tenantId: string, id: string): Promise<StoredJson> {
  const result = await requirePool().query<{ data: string; updated_at: string }>(
    `SELECT data::text AS data,
            to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
     FROM configurations
     WHERE tenant_id = $1
       AND id = $2`,
    [tenantId, id],
  );
  const row = result.rows.at(0);
  // The caller inserted this key. A miss means the write did not land.
  if (row === undefined) {
    throw new Error("Expected a stored configuration row.");
  }
  return { data: row.data, updatedAt: row.updated_at };
}

/**
 * Opens reactiv_test and builds the repository.
 *
 * Purpose: run the suite against Postgres with migrations applied.
 * Inputs: DATABASE_URL_TEST from the environment or .env.
 * Side effects: creates the test database when it is missing and migrates it.
 */
async function openDatabase(): Promise<void> {
  pool = await createTestPool();
  repository = createConfigurationRepository(pool);
}

/**
 * Deletes rows this file inserted.
 *
 * Purpose: leave reactiv_test without sharing rows with a future seed.
 * Inputs: none. The cleanup list holds the keys.
 * Side effects: deletes those rows.
 */
async function removeTrackedRows(): Promise<void> {
  const current = pool;
  // A failed open has nothing to delete.
  if (current === undefined) {
    return;
  }
  for (const row of created) {
    // The delete is tenant-scoped, same as the repository predicates.
    await current.query("DELETE FROM configurations WHERE tenant_id = $1 AND id = $2", [row.tenantId, row.id]);
  }
  created.length = 0;
}

/**
 * Closes the test pool.
 *
 * Purpose: release connections after the last assertion.
 * Inputs: none.
 * Side effects: deletes leftover rows and ends the pool.
 */
async function closeDatabase(): Promise<void> {
  const current = pool;
  if (current === undefined) {
    return;
  }
  try {
    await removeTrackedRows();
  } finally {
    await current.end();
    pool = undefined;
    repository = undefined;
  }
}

/**
 * Returns a client to the pool.
 *
 * Purpose: end any open transaction before release.
 * Inputs: client, a checked-out connection.
 * Side effects: rolls back when a transaction is still open, then releases the client.
 */
async function releaseClient(client: PoolClient): Promise<void> {
  // ROLLBACK after COMMIT is a warning, and the connection can return to the pool.
  await rollbackQuietly(client);
  client.release();
}

/**
 * Runs one update and records when it finishes.
 *
 * Purpose: the overlap check needs to see that the second update is still waiting.
 * Inputs: client, the second connection. input, the losing update. flag, the finish marker.
 * Side effects: runs the conditional update on that connection.
 */
async function runBlockedUpdate(
  client: PoolClient,
  input: UpdateConfigurationInput,
  flag: { finished: boolean },
): Promise<UpdateConfigurationResult> {
  const result = await updateConfigurationOnClient(client, input);
  // The flag flips only after the UPDATE returns, which is after the first transaction commits.
  flag.finished = true;
  return result;
}

/**
 * Asserts that a second migrate applies nothing.
 *
 * Purpose: the runner is safe to run twice.
 * Inputs: none.
 * Side effects: runs the migration runner again.
 */
async function expectMigrationRecordsOnce(): Promise<void> {
  const again = await applyMigrations(requirePool(), migrationsDirectory());
  // The test pool already applied 001_configurations.sql while it was opening.
  expect(again).toEqual([]);
  const recorded = await requirePool().query<{ count: number }>(
    "SELECT count(*)::int AS count FROM schema_migrations WHERE name = $1",
    ["001_configurations.sql"],
  );
  expect(recorded.rows.at(0)?.count).toBe(1);
}

/**
 * Asserts the table shape from the migration.
 *
 * Purpose: metadata and revision are columns, and there is no position column or jsonb index.
 * Inputs: none.
 * Side effects: reads catalog tables.
 */
async function expectTableStoresMetadataWithoutPosition(): Promise<void> {
  const columns = await requirePool().query<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'configurations'
     ORDER BY column_name`,
  );
  const columnNames: string[] = [];
  for (const row of columns.rows) {
    columnNames.push(row.column_name);
  }
  expect(columnNames).toEqual(["data", "id", "revision", "schema_version", "tenant_id", "updated_at"]);
  const indexes = await requirePool().query<{ indexname: string }>(
    `SELECT indexname
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'configurations'
     ORDER BY indexname`,
  );
  const indexNames: string[] = [];
  for (const row of indexes.rows) {
    indexNames.push(row.indexname);
  }
  // The primary key is the only index. jsonb has no extra index.
  expect(indexNames).toEqual(["configurations_pkey"]);
}

/**
 * Asserts one raw insert fails with a SQLSTATE and leaves no row.
 *
 * Purpose: the table checks reject values the repository does not intend to write.
 * Inputs: id, the configuration id. sql, the insert statement. params, bound values. code, the SQLSTATE.
 * Side effects: attempts an insert.
 */
async function expectRejectedRow(id: string, sql: string, params: unknown[], code: string): Promise<void> {
  // A failed statement must not leave a readable configuration.
  await expect(requirePool().query(sql, params)).rejects.toMatchObject({ code });
  const found = await requirePool().query<{ count: number }>(
    "SELECT count(*)::int AS count FROM configurations WHERE id = $1",
    [id],
  );
  expect(found.rows.at(0)?.count).toBe(0);
}

/**
 * Asserts the table rejects revisions, payloads, and nulls outside the contract.
 *
 * Purpose: database checks are a backstop, and a rejected insert leaves an existing row in place.
 * Inputs: none.
 * Side effects: inserts one valid row and attempts inserts that the checks reject.
 */
async function expectTableRejectsInvalidBackstopRows(): Promise<void> {
  const tenantId = newTenantId();
  const keptId = newConfigurationId();
  track(tenantId, keptId);
  const kept = emptyDocument();
  const inserted = expectInserted(
    await requireRepository().insertConfiguration({ tenantId, id: keptId, document: kept }),
  );
  const revisionId = newConfigurationId();
  const versionId = newConfigurationId();
  const arrayId = newConfigurationId();
  const scalarId = newConfigurationId();
  const jsonNullId = newConfigurationId();
  const nullDataId = newConfigurationId();
  const nullTenantId = newConfigurationId();
  // Track ids that must not be inserted so a surprise row is still removed.
  track(tenantId, revisionId);
  track(tenantId, versionId);
  track(tenantId, arrayId);
  track(tenantId, scalarId);
  track(tenantId, jsonNullId);
  track(tenantId, nullDataId);
  track("tenant_null_probe", nullTenantId);
  const insertSql = `INSERT INTO configurations (tenant_id, id, schema_version, revision, data)
     VALUES ($1, $2, $3, $4, $5::jsonb)`;
  await expectRejectedRow(revisionId, insertSql, [tenantId, revisionId, 1, 0, '{"sections":[]}'], "23514");
  await expectRejectedRow(versionId, insertSql, [tenantId, versionId, 0, 1, '{"sections":[]}'], "23514");
  await expectRejectedRow(arrayId, insertSql, [tenantId, arrayId, 1, 1, "[]"], "23514");
  await expectRejectedRow(scalarId, insertSql, [tenantId, scalarId, 1, 1, '"text"'], "23514");
  await expectRejectedRow(jsonNullId, insertSql, [tenantId, jsonNullId, 1, 1, "null"], "23514");
  await expectRejectedRow(
    nullDataId,
    `INSERT INTO configurations (tenant_id, id, schema_version, revision, data)
     VALUES ($1, $2, 1, 1, NULL)`,
    [tenantId, nullDataId],
    "23502",
  );
  await expectRejectedRow(
    nullTenantId,
    `INSERT INTO configurations (tenant_id, id, schema_version, revision, data)
     VALUES (NULL, $1, 1, 1, '{"sections":[]}'::jsonb)`,
    [nullTenantId],
    "23502",
  );
  const stored = expectStored(await requireRepository().getConfiguration({ tenantId, id: keptId }));
  expect(stored).toEqual(inserted);
}

/**
 * Asserts every repository statement is tenant-scoped.
 *
 * Purpose: there is no load by id alone, and updated_at is assigned in SQL.
 * Inputs: none.
 * Side effects: reads the repository source.
 */
function expectTenantScopedSql(): void {
  const statements = [SELECT_CONFIGURATION_SQL, CONDITIONAL_UPDATE_SQL, TENANT_SCOPED_EXISTS_SQL];
  for (const sql of statements) {
    const whereAt = sql.indexOf("WHERE");
    // Each read and the update has a WHERE clause, and that clause names the tenant.
    expect(whereAt).toBeGreaterThan(-1);
    expect(sql.slice(whereAt)).toContain("tenant_id");
  }
  expect(INSERT_CONFIGURATION_SQL).toContain("tenant_id");
  expect(CONDITIONAL_UPDATE_SQL).toContain("AND id = $4");
  expect(CONDITIONAL_UPDATE_SQL).toContain("AND revision = $5");
  expect(CONDITIONAL_UPDATE_SQL).toContain("updated_at = now()");
  // The insert column list omits updated_at so Postgres fills it with now(). RETURNING still reads it.
  const insertColumns = INSERT_CONFIGURATION_SQL.slice(0, INSERT_CONFIGURATION_SQL.indexOf("VALUES"));
  expect(insertColumns.includes("updated_at")).toBe(false);
  const source = readFileSync(fileURLToPath(new URL("./repository.ts", import.meta.url)), "utf8");
  // A locked read would hide a lost update. The conditional UPDATE is the control.
  expect(source.includes("FOR UPDATE")).toBe(false);
}

/**
 * Asserts insert then get keeps sections, order, colors, revision, and a timestamp.
 *
 * Purpose: the jsonb payload keeps array order, and revision starts at 1.
 * Inputs: none.
 * Side effects: inserts one row.
 */
async function expectInsertRoundTrip(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const document = demoDocument();
  const inserted = expectInserted(
    await requireRepository().insertConfiguration({ tenantId, id, document }),
  );
  const loaded = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(loaded).toEqual(inserted);
  expect(loaded.id).toBe(id);
  expect(loaded.schemaVersion).toBe(1);
  expect(loaded.revision).toBe(1);
  expectUtcTimestamp(loaded.updatedAt);
  expect(sectionTypes(loaded)).toEqual(["carousel", "text", "cta", "carousel", "text", "cta"]);
  expect(loaded.data.sections[0]).toMatchObject({ type: "carousel", aspectRatio: "landscape" });
  expect(loaded.data.sections[1]).toMatchObject({
    type: "text",
    titleColor: "#112233",
    descriptionColor: "#334455",
  });
  expect(loaded.data.sections[2]).toMatchObject({
    type: "cta",
    backgroundColor: "#243044",
    labelColor: "#ffffff",
  });
  expect(loaded.data.sections[3]).toMatchObject({ type: "carousel", aspectRatio: "portrait" });
  expect(loaded.data.sections[4]).toMatchObject({
    type: "text",
    titleColor: "#3d2b1f",
    descriptionColor: "#5c6b73",
  });
  expect(loaded.data.sections[5]).toMatchObject({
    type: "cta",
    backgroundColor: "#1f4d3a",
    labelColor: "#f7f3ea",
  });
  // Section order, image order, and colors are the stored sections array.
  expect(loaded.data.sections).toEqual(document.data.sections);
}

/**
 * Asserts another tenant does not see this tenant's id.
 *
 * Purpose: the get predicate includes tenant_id. The same id may exist for a second tenant.
 * Inputs: none.
 * Side effects: inserts two rows with the same id and different tenants.
 */
async function expectOtherTenantMissesTheRow(): Promise<void> {
  const tenantId = newTenantId();
  const otherTenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  track(otherTenantId, id);
  const document = demoDocument();
  const inserted = expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const missing = await requireRepository().getConfiguration({ tenantId: otherTenantId, id });
  expect(missing).toEqual({ ok: false, reason: "not-found" });
  const otherDocument = withTextTitle(document, "Other tenant title");
  const otherInsert = expectInserted(
    await requireRepository().insertConfiguration({ tenantId: otherTenantId, id, document: otherDocument }),
  );
  expect(otherInsert.data).toEqual(otherDocument.data);
  const owner = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  const other = expectStored(await requireRepository().getConfiguration({ tenantId: otherTenantId, id }));
  expect(owner).toEqual(inserted);
  expect(other.data).toEqual(otherDocument.data);
}

/**
 * Asserts a second update with the original revision conflicts after the first commits.
 *
 * Purpose: the stored revision becomes 2, and the stale update does not make it 3.
 * Inputs: none.
 * Side effects: inserts one row and updates it once.
 */
async function expectStaleRevisionConflictsAfterCommit(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const document = demoDocument();
  const winner = withTextTitle(document, "Winner title");
  const loser = withTextTitle(document, "Loser title");
  expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const first = expectUpdated(
    await requireRepository().updateConfiguration({
      tenantId,
      id,
      expectedRevision: 1,
      document: winner,
    }),
  );
  expect(first.revision).toBe(2);
  // The first update has returned, so its transaction has committed.
  const second = await requireRepository().updateConfiguration({
    tenantId,
    id,
    expectedRevision: 1,
    document: loser,
  });
  expect(second).toEqual({ ok: false, reason: "revision-conflict" });
  const stored = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(stored.revision).toBe(2);
  expect(stored.data).toEqual(winner.data);
}

/**
 * Asserts exactly one of two overlapping revision-1 updates commits.
 *
 * Purpose: two connections race on one conditional UPDATE. The open transaction holds the row.
 * Inputs: none.
 * Side effects: inserts one row and commits one update.
 */
async function expectOneOverlappingUpdateCommits(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const document = demoDocument();
  const winner = withTextTitle(document, "Winner title");
  const loser = withTextTitle(document, "Loser title");
  expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const clientA = await requirePool().connect();
  try {
    const clientB = await requirePool().connect();
    let secondPromise: Promise<UpdateConfigurationResult> | undefined;
    try {
      // Begin, then run only the conditional UPDATE. Commit comes after the second update is waiting.
      await clientA.query("BEGIN");
      const first = await updateConfigurationOnClient(clientA, {
        tenantId,
        id,
        expectedRevision: 1,
        document: winner,
      });
      expect(first.ok).toBe(true);
      if (!first.ok) {
        throw new Error("The first conditional update did not match revision 1.");
      }
      expect(first.configuration.revision).toBe(2);
      expect(first.configuration.data).toEqual(winner.data);
      await clientB.query("BEGIN");
      const flag = { finished: false };
      secondPromise = runBlockedUpdate(
        clientB,
        { tenantId, id, expectedRevision: 1, document: loser },
        flag,
      );
      // The second UPDATE is blocked on the row lock held by the first transaction.
      await wait(200);
      expect(flag.finished).toBe(false);
      await clientA.query("COMMIT");
      const second = await secondPromise;
      secondPromise = undefined;
      expect(second).toEqual({ ok: false, reason: "revision-conflict" });
      await clientB.query("COMMIT");
      const stored = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
      expect(stored.revision).toBe(2);
      expect(stored.data).toEqual(winner.data);
      // Exactly one of the two revision-1 updates matched.
      let successCount = 0;
      if (first.ok) {
        successCount += 1;
      }
      if (second.ok) {
        successCount += 1;
      }
      expect(successCount).toBe(1);
    } finally {
      // Unblock the waiter before releasing its connection.
      if (secondPromise !== undefined) {
        await rollbackQuietly(clientA);
        await secondPromise.catch(swallowLateUpdate);
      }
      await releaseClient(clientB);
    }
  } finally {
    await releaseClient(clientA);
  }
}

/**
 * Ignores a late update error while a connection is being released.
 *
 * Purpose: cleanup still releases both connections when the overlap assertion fails.
 * Inputs: _error, the late failure. It is unused because the test already failed.
 * Side effects: none.
 */
function swallowLateUpdate(_error: unknown): void {
  // The assertion error is the one Vitest reports. This catch only frees the waiter.
  return;
}

/**
 * Asserts an unknown id is not-found and does not insert.
 *
 * Purpose: a conditional update is not an upsert.
 * Inputs: none.
 * Side effects: reads counts for an id that was never inserted.
 */
async function expectUnknownIdDoesNotInsert(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const document = demoDocument();
  const missing = await requireRepository().updateConfiguration({
    tenantId,
    id,
    expectedRevision: 1,
    document,
  });
  expect(missing).toEqual({ ok: false, reason: "not-found" });
  const loaded = await requireRepository().getConfiguration({ tenantId, id });
  expect(loaded).toEqual({ ok: false, reason: "not-found" });
  const count = await requirePool().query<{ count: number }>(
    "SELECT count(*)::int AS count FROM configurations WHERE id = $1",
    [id],
  );
  expect(count.rows.at(0)?.count).toBe(0);
}

/**
 * Asserts a successful update changes the database timestamp.
 *
 * Purpose: updated_at is assigned by Postgres now(), and the caller cannot pass it.
 * Inputs: none.
 * Side effects: inserts one row and updates it once.
 */
async function expectTimestampChangesOnUpdate(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const document = demoDocument();
  const winner = withTextTitle(document, "Later title");
  expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const before = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  const beforeJson = await readStoredJson(tenantId, id);
  const columnDefault = await requirePool().query<{ column_default: string | null }>(
    `SELECT column_default
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'configurations'
       AND column_name = 'updated_at'`,
  );
  // The column default is now(), and the update statement assigns now() too.
  expect(columnDefault.rows.at(0)?.column_default ?? "").toContain("now()");
  await wait(50);
  const updated = expectUpdated(
    await requireRepository().updateConfiguration({
      tenantId,
      id,
      expectedRevision: 1,
      document: winner,
    }),
  );
  const afterJson = await readStoredJson(tenantId, id);
  expectUtcTimestamp(updated.updatedAt);
  expect(updated.updatedAt).not.toBe(before.updatedAt);
  expect(afterJson.updatedAt).not.toBe(beforeJson.updatedAt);
  expect(afterJson.data).not.toBe(beforeJson.data);
  expect(updated.revision).toBe(2);
}

/**
 * Asserts a rejected conditional update leaves the JSON and timestamp in place.
 *
 * Purpose: a stale revision does not write data or updated_at.
 * Inputs: none.
 * Side effects: inserts one row and attempts one stale update.
 */
async function expectRejectedUpdateLeavesTheRow(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const document = demoDocument();
  const loser = withTextTitle(document, "Rejected title");
  expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const before = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  const beforeJson = await readStoredJson(tenantId, id);
  const failed = await requireRepository().updateConfiguration({
    tenantId,
    id,
    expectedRevision: 99,
    document: loser,
  });
  expect(failed).toEqual({ ok: false, reason: "revision-conflict" });
  const after = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  const afterJson = await readStoredJson(tenantId, id);
  // Whole JSON text, then the timestamp text, then the parsed contract fields.
  expect(afterJson.data).toBe(beforeJson.data);
  expect(afterJson.updatedAt).toBe(beforeJson.updatedAt);
  expect(after.data).toEqual(before.data);
  expect(after.updatedAt).toBe(before.updatedAt);
  expect(after.revision).toBe(1);
}

/**
 * Asserts a repeated tenant and id returns unique-violation.
 *
 * Purpose: insert does not upsert.
 * Inputs: none.
 * Side effects: inserts one row and attempts a second insert.
 */
async function expectUniqueViolationKeepsTheOriginal(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const document = demoDocument();
  const inserted = expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const other = withTextTitle(document, "Duplicate title");
  const duplicate = await requireRepository().insertConfiguration({ tenantId, id, document: other });
  expect(duplicate).toEqual({ ok: false, reason: "unique-violation" });
  const stored = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(stored).toEqual(inserted);
  expect(stored.revision).toBe(1);
}

/**
 * Asserts a stored object that fails the contract is an internal error.
 *
 * Purpose: get does not return a row the schema rejects.
 * Inputs: none.
 * Side effects: inserts one jsonb object that is not a document, then reads it.
 */
async function expectInvalidStoredRowIsAnInternalError(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  // The table accepts any jsonb object. The contract still requires sections.
  await requirePool().query(
    `INSERT INTO configurations (tenant_id, id, schema_version, revision, data)
     VALUES ($1, $2, 1, 1, '{}'::jsonb)`,
    [tenantId, id],
  );
  await expect(requireRepository().getConfiguration({ tenantId, id })).rejects.toBeInstanceOf(
    ConfigurationContractError,
  );
  await expect(requireRepository().getConfiguration({ tenantId, id })).rejects.toThrow(
    "Stored configuration does not match the contract schema.",
  );
}

/**
 * Asserts an empty document round-trips at revision 1.
 *
 * Purpose: a document with no sections is valid stored JSON.
 * Inputs: none.
 * Side effects: inserts one row.
 */
async function expectEmptyDocumentRoundTrip(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const document = emptyDocument();
  const inserted = expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const loaded = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(loaded).toEqual(inserted);
  expect(loaded.revision).toBe(1);
  expect(loaded.schemaVersion).toBe(1);
  expect(loaded.data.sections).toEqual([]);
  expectUtcTimestamp(loaded.updatedAt);
}

/**
 * Asserts a different id for the same tenant is not-found.
 *
 * Purpose: get is scoped to both tenant and id, and a miss does not affect the stored row.
 * Inputs: none.
 * Side effects: inserts one row.
 */
async function expectSameTenantMissesAnotherId(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  const otherId = newConfigurationId();
  track(tenantId, id);
  track(tenantId, otherId);
  const document = emptyDocument();
  const inserted = expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const missing = await requireRepository().getConfiguration({ tenantId, id: otherId });
  expect(missing).toEqual({ ok: false, reason: "not-found" });
  const stored = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(stored).toEqual(inserted);
}

/**
 * Asserts an update from another tenant does not change the owner's row.
 *
 * Purpose: the conditional update predicate includes tenant_id. A miss does not insert.
 * Inputs: none.
 * Side effects: inserts one row and attempts one update for a different tenant.
 */
async function expectOtherTenantUpdateMisses(): Promise<void> {
  const tenantId = newTenantId();
  const otherTenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  track(otherTenantId, id);
  const document = textDocument([{ id: "text-a", title: "Owned", titleColor: "#112233" }]);
  const intruder = textDocument([{ id: "text-a", title: "Intruder", titleColor: "#abcdef" }]);
  expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document }));
  const before = await readStoredJson(tenantId, id);
  const update = await requireRepository().updateConfiguration({
    tenantId: otherTenantId,
    id,
    expectedRevision: 1,
    document: intruder,
  });
  expect(update).toEqual({ ok: false, reason: "not-found" });
  const after = await readStoredJson(tenantId, id);
  expect(after.data).toBe(before.data);
  expect(after.updatedAt).toBe(before.updatedAt);
  const owner = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(owner.revision).toBe(1);
  expect(owner.data).toEqual(document.data);
  const otherRows = await requirePool().query<{ count: number }>(
    "SELECT count(*)::int AS count FROM configurations WHERE tenant_id = $1 AND id = $2",
    [otherTenantId, id],
  );
  expect(otherRows.rows.at(0)?.count).toBe(0);
}

/**
 * Asserts an update replaces the whole document and later revisions stay monotonic.
 *
 * Purpose: section order, colors, and dropped sections follow the written document. A stale revision does not write.
 * Inputs: none.
 * Side effects: inserts one row and updates it twice.
 */
async function expectUpdateReplacesTheWholeDocument(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const original = textDocument([
    { id: "text-a", title: "Alpha", titleColor: "#112233" },
    { id: "text-b", title: "Beta", titleColor: "#3d2b1f" },
  ]);
  const reordered = textDocument([
    { id: "text-b", title: "Beta", titleColor: "#3d2b1f" },
    { id: "text-a", title: "Alpha", titleColor: "#112233" },
  ]);
  const onlyBeta = textDocument([{ id: "text-b", title: "Beta kept", titleColor: "#aa00ff" }]);
  expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document: original }));
  const reorderedResult = expectUpdated(
    await requireRepository().updateConfiguration({
      tenantId,
      id,
      expectedRevision: 1,
      document: reordered,
    }),
  );
  expect(reorderedResult.revision).toBe(2);
  expect(sectionIds(reorderedResult)).toEqual(["text-b", "text-a"]);
  const loadedReorder = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(loadedReorder).toEqual(reorderedResult);
  const replaced = expectUpdated(
    await requireRepository().updateConfiguration({
      tenantId,
      id,
      expectedRevision: 2,
      document: onlyBeta,
    }),
  );
  expect(replaced.revision).toBe(3);
  expect(replaced.data).toEqual(onlyBeta.data);
  expect(sectionIds(replaced)).toEqual(["text-b"]);
  const stale = await requireRepository().updateConfiguration({
    tenantId,
    id,
    expectedRevision: 2,
    document: original,
  });
  expect(stale).toEqual({ ok: false, reason: "revision-conflict" });
  const stored = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(stored).toEqual(replaced);
  expect(stored.revision).toBe(3);
  expect(stored.data.sections[0]).toMatchObject({ title: "Beta kept", titleColor: "#aa00ff" });
}

/**
 * Asserts an update stores slide order as the array order.
 *
 * Purpose: swapping two images does not sort them by id.
 * Inputs: none.
 * Side effects: inserts one row and updates it once.
 */
async function expectUpdateKeepsImageOrder(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const original = carouselDocument(["image-1", "image-2"]);
  const swapped = carouselDocument(["image-2", "image-1"]);
  expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document: original }));
  const updated = expectUpdated(
    await requireRepository().updateConfiguration({
      tenantId,
      id,
      expectedRevision: 1,
      document: swapped,
    }),
  );
  expect(updated.revision).toBe(2);
  expect(imageIds(updated)).toEqual(["image-2", "image-1"]);
  const loaded = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(loaded.data).toEqual(swapped.data);
  expect(imageIds(loaded)).toEqual(["image-2", "image-1"]);
}

/**
 * Asserts two public updates that both expect revision 1 produce one commit.
 *
 * Purpose: updateConfiguration commits the conditional update, so one caller wins.
 * Inputs: none.
 * Side effects: inserts one row and runs two updates together.
 */
async function expectOnePublicUpdateWins(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  const leftDocument = textDocument([{ id: "text-a", title: "Left", titleColor: "#112233" }]);
  const rightDocument = textDocument([{ id: "text-a", title: "Right", titleColor: "#abcdef" }]);
  expectInserted(await requireRepository().insertConfiguration({ tenantId, id, document: emptyDocument() }));
  const left = requireRepository().updateConfiguration({
    tenantId,
    id,
    expectedRevision: 1,
    document: leftDocument,
  });
  const right = requireRepository().updateConfiguration({
    tenantId,
    id,
    expectedRevision: 1,
    document: rightDocument,
  });
  const results = await Promise.all([left, right]);
  const outcomes = countUpdateOutcomes(results);
  expect(outcomes).toEqual({ succeeded: 1, conflicts: 1, missing: 0 });
  const stored = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(stored.revision).toBe(2);
  let winnerData = stored.data;
  for (const result of results) {
    // The committed result is the one whose document is now stored.
    if (result.ok) {
      winnerData = result.configuration.data;
      expect(result.configuration.revision).toBe(2);
      expect(result.configuration.updatedAt).toBe(stored.updatedAt);
    }
  }
  expect(stored.data).toEqual(winnerData);
  expect(stored.data).not.toEqual(emptyDocument().data);
}

/**
 * Asserts a check failure is thrown and leaves the id unused.
 *
 * Purpose: only unique violations become the typed result. The failed insert rolls back.
 * Inputs: none.
 * Side effects: attempts one invalid insert, then inserts a valid row for a new id.
 */
async function expectCheckFailureIsNotAUniqueViolation(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  // schemaVersion 0 is outside the contract type. The table check is what should reject it.
  const invalid = {
    schemaVersion: 0,
    data: { sections: [] },
  } as unknown as EditableDocument;
  await expect(
    requireRepository().insertConfiguration({ tenantId, id, document: invalid }),
  ).rejects.toMatchObject({ code: "23514" });
  const missing = await requireRepository().getConfiguration({ tenantId, id });
  expect(missing).toEqual({ ok: false, reason: "not-found" });
  const inserted = expectInserted(
    await requireRepository().insertConfiguration({ tenantId, id, document: emptyDocument() }),
  );
  expect(inserted.revision).toBe(1);
  expect(inserted.data.sections).toEqual([]);
}

/**
 * Asserts a stale update of a contract-invalid row returns a conflict and keeps the JSON.
 *
 * Purpose: the existence check does not parse the payload, and it does not repair the row.
 * Inputs: none.
 * Side effects: inserts one jsonb object that is not a document, then attempts an update.
 */
async function expectStaleUpdateLeavesInvalidJson(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  await requirePool().query(
    `INSERT INTO configurations (tenant_id, id, schema_version, revision, data)
     VALUES ($1, $2, 1, 1, '{}'::jsonb)`,
    [tenantId, id],
  );
  const before = await readStoredJson(tenantId, id);
  const failed = await requireRepository().updateConfiguration({
    tenantId,
    id,
    expectedRevision: 99,
    document: emptyDocument(),
  });
  expect(failed).toEqual({ ok: false, reason: "revision-conflict" });
  const after = await readStoredJson(tenantId, id);
  expect(after.data).toBe(before.data);
  expect(after.updatedAt).toBe(before.updatedAt);
  expect(after.data).toBe("{}");
  await expect(requireRepository().getConfiguration({ tenantId, id })).rejects.toBeInstanceOf(
    ConfigurationContractError,
  );
}

/**
 * Asserts a matching update replaces a payload that fails the contract.
 *
 * Purpose: the written document is what gets stored. The old JSON is not revalidated in place.
 * Inputs: none.
 * Side effects: inserts one invalid object and replaces it.
 */
async function expectMatchingUpdateReplacesInvalidJson(): Promise<void> {
  const tenantId = newTenantId();
  const id = newConfigurationId();
  track(tenantId, id);
  await requirePool().query(
    `INSERT INTO configurations (tenant_id, id, schema_version, revision, data)
     VALUES ($1, $2, 1, 1, '{}'::jsonb)`,
    [tenantId, id],
  );
  const document = textDocument([{ id: "text-a", title: "Repaired", titleColor: "#112233" }]);
  const updated = expectUpdated(
    await requireRepository().updateConfiguration({
      tenantId,
      id,
      expectedRevision: 1,
      document,
    }),
  );
  expect(updated.revision).toBe(2);
  expect(updated.data).toEqual(document.data);
  const loaded = expectStored(await requireRepository().getConfiguration({ tenantId, id }));
  expect(loaded).toEqual(updated);
}

/**
 * Registers the repository suite.
 *
 * Purpose: open Postgres once and run the persistence checks against reactiv_test.
 * Inputs: none.
 * Side effects: registers hooks and tests with Vitest.
 */
function registerRepositoryTests(): void {
  // One pool for the file. Each test deletes the rows it tracked.
  beforeAll(openDatabase, 20_000);
  afterEach(removeTrackedRows);
  afterAll(closeDatabase);
  it("records the migration once", expectMigrationRecordsOnce);
  it("stores metadata and revision without a position column", expectTableStoresMetadataWithoutPosition);
  it("rejects revisions, schema versions, nulls, and non-object payloads", expectTableRejectsInvalidBackstopRows);
  it("keeps tenant_id in every repository predicate", expectTenantScopedSql);
  it("returns the inserted sections, order, colors, revision, and timestamp", expectInsertRoundTrip);
  it("returns an empty section list at revision 1", expectEmptyDocumentRoundTrip);
  it("returns not-found for another id owned by the same tenant", expectSameTenantMissesAnotherId);
  it("returns not-found when another tenant loads the same id", expectOtherTenantMissesTheRow);
  it("returns not-found when another tenant updates the same id", expectOtherTenantUpdateMisses);
  it("conflicts when a second update still expects revision 1", expectStaleRevisionConflictsAfterCommit);
  it("replaces the whole document and keeps later revisions monotonic", expectUpdateReplacesTheWholeDocument);
  it("stores swapped carousel slides in the written order", expectUpdateKeepsImageOrder);
  it("commits exactly one of two overlapping revision-1 updates", expectOneOverlappingUpdateCommits, 20_000);
  it("commits exactly one of two public updates that both expect revision 1", expectOnePublicUpdateWins, 20_000);
  it("returns not-found for an unknown id and does not insert", expectUnknownIdDoesNotInsert);
  it("changes updated_at on a successful update", expectTimestampChangesOnUpdate);
  it("leaves data and updated_at unchanged when the revision does not match", expectRejectedUpdateLeavesTheRow);
  it("returns unique-violation when the tenant and id already exist", expectUniqueViolationKeepsTheOriginal);
  it("throws a check failure instead of a unique violation and leaves the id unused", expectCheckFailureIsNotAUniqueViolation);
  it("rejects a stored row that fails the contract schema", expectInvalidStoredRowIsAnInternalError);
  it("returns a revision conflict for a contract-invalid row and keeps its JSON", expectStaleUpdateLeavesInvalidJson);
  it("replaces a contract-invalid payload when the revision matches", expectMatchingUpdateReplacesInvalidJson);
}

describe("postgres configuration repository", registerRepositoryTests);
