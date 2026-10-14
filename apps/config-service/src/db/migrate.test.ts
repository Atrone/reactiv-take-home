import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { escapeIdentifier, type Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rollbackQuietly } from "./rollback.js";
import { createTestPool } from "./test-database.js";
import { applyMigrations } from "./migrate.js";

let pool: Pool | undefined;

/**
 * Returns the open test pool.
 *
 * Purpose: fail a helper that runs before the database is open.
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
 * Opens the migrated test database.
 *
 * Purpose: migration behavior is checked against reactiv_test, not the dev database.
 * Inputs: none.
 * Side effects: creates reactiv_test when needed and applies db/migrations.
 */
async function openPool(): Promise<void> {
  pool = await createTestPool();
}

/**
 * Closes the test pool.
 *
 * Purpose: release connections after the migration suite.
 * Inputs: none.
 * Side effects: ends the pool when it was opened.
 */
async function closePool(): Promise<void> {
  // A failed beforeAll leaves no pool to close.
  if (pool === undefined) {
    return;
  }
  await pool.end();
  pool = undefined;
}

/**
 * Reports whether a table is visible on the search path.
 *
 * Purpose: show that a migration created or rolled back a table.
 * Inputs: database, the test pool. name, the table name.
 * Side effects: reads the catalog.
 */
async function tableExists(database: Pool, name: string): Promise<boolean> {
  const result = await database.query<{ reg: string | null }>("SELECT to_regclass($1) AS reg", [name]);
  // A missing relation comes back as SQL NULL.
  return result.rows.at(0)?.reg != null;
}

/**
 * Counts bookkeeping rows for one filename.
 *
 * Purpose: a skipped or rolled-back file must not gain extra records.
 * Inputs: database, the test pool. filename, the migration name.
 * Side effects: reads schema_migrations.
 */
async function recordedCount(database: Pool, filename: string): Promise<number> {
  const result = await database.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM schema_migrations WHERE name = $1",
    [filename],
  );
  return result.rows.at(0)?.count ?? 0;
}

/**
 * Drops a probe table and forgets its migration name.
 *
 * Purpose: leave reactiv_test without the tables this file created.
 * Inputs: database, the test pool. tableName, the probe table. filename, the recorded name.
 * Side effects: drops the table when it exists and deletes that bookkeeping row.
 */
async function forgetProbe(database: Pool, tableName: string, filename: string): Promise<void> {
  // The name is one of this file's constants. Quote it so it cannot be read as SQL.
  await database.query(`DROP TABLE IF EXISTS ${escapeIdentifier(tableName)}`);
  await database.query("DELETE FROM schema_migrations WHERE name = $1", [filename]);
}

/**
 * Restores DATABASE_URL_TEST after a guard test.
 *
 * Purpose: later tests in this file keep using the real test database URL.
 * Inputs: previous, the value from before the test. Undefined means the key was unset.
 * Side effects: writes process.env.
 */
function restoreTestUrl(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env.DATABASE_URL_TEST;
    return;
  }
  process.env.DATABASE_URL_TEST = previous;
}

/**
 * Asserts filenames sort numerically and a recorded name is not applied again.
 *
 * Purpose: 2 applies before 10, notes and nested files are ignored, and a drop is not recreated.
 * Inputs: none.
 * Side effects: creates probe tables, then drops them and removes their bookkeeping rows.
 */
async function expectNumericOrderAndRecordedNames(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "reactiv-migrate-"));
  const database = requirePool();
  try {
    await mkdir(join(directory, "nested"));
    // Lexicographic order would apply 10 before 2. Numeric order does the reverse.
    await writeFile(join(directory, "10_later.sql"), "CREATE TABLE migration_order_later (id int);\n", "utf8");
    await writeFile(join(directory, "2_earlier.sql"), "CREATE TABLE migration_order_earlier (id int);\n", "utf8");
    await writeFile(join(directory, "notes.txt"), "not a migration\n", "utf8");
    await writeFile(
      join(directory, "nested", "3_hidden.sql"),
      "CREATE TABLE migration_hidden_probe (id int);\n",
      "utf8",
    );
    const applied = await applyMigrations(database, directory);
    expect(applied).toEqual(["2_earlier.sql", "10_later.sql"]);
    expect(await tableExists(database, "migration_order_earlier")).toBe(true);
    expect(await tableExists(database, "migration_order_later")).toBe(true);
    expect(await tableExists(database, "migration_hidden_probe")).toBe(false);
    expect(await tableExists(database, "configurations")).toBe(true);
    expect(await recordedCount(database, "notes.txt")).toBe(0);
    expect(await recordedCount(database, "3_hidden.sql")).toBe(0);
    expect(await applyMigrations(database, directory)).toEqual([]);
    // The name stays recorded, so dropping the table does not make the file run again.
    await database.query(`DROP TABLE ${escapeIdentifier("migration_order_earlier")}`);
    expect(await applyMigrations(database, directory)).toEqual([]);
    expect(await tableExists(database, "migration_order_earlier")).toBe(false);
    expect(await tableExists(database, "migration_order_later")).toBe(true);
  } finally {
    await forgetProbe(database, "migration_order_earlier", "2_earlier.sql");
    await forgetProbe(database, "migration_order_later", "10_later.sql");
    await forgetProbe(database, "migration_hidden_probe", "3_hidden.sql");
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Asserts every statement in one file commits together.
 *
 * Purpose: a migration file may contain more than one statement.
 * Inputs: none.
 * Side effects: creates a probe table, then drops it and removes its bookkeeping row.
 */
async function expectMultiStatementFileCommits(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "reactiv-migrate-"));
  const database = requirePool();
  try {
    await writeFile(
      join(directory, "4_multi.sql"),
      "CREATE TABLE migration_multi_probe (id int);\nINSERT INTO migration_multi_probe (id) VALUES (1);\n",
      "utf8",
    );
    expect(await applyMigrations(database, directory)).toEqual(["4_multi.sql"]);
    const rows = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM migration_multi_probe",
    );
    expect(rows.rows.at(0)?.count).toBe(1);
    expect(await recordedCount(database, "4_multi.sql")).toBe(1);
    expect(await applyMigrations(database, directory)).toEqual([]);
  } finally {
    await forgetProbe(database, "migration_multi_probe", "4_multi.sql");
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Asserts a failing file rolls back its schema change and leaves the pool usable.
 *
 * Purpose: the bookkeeping row and the table commit together, or neither does.
 * Inputs: none.
 * Side effects: attempts a failing migration, then removes any probe it left behind.
 */
async function expectFailedMigrationRollsBack(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "reactiv-migrate-"));
  const database = requirePool();
  try {
    await writeFile(
      join(directory, "5_fail.sql"),
      "CREATE TABLE migration_failure_probe (id int);\nSELECT 1/0;\n",
      "utf8",
    );
    await expect(applyMigrations(database, directory)).rejects.toThrow();
    expect(await tableExists(database, "migration_failure_probe")).toBe(false);
    expect(await recordedCount(database, "5_fail.sql")).toBe(0);
    const stillOpen = await database.query<{ ok: number }>("SELECT 1 AS ok");
    expect(stillOpen.rows.at(0)?.ok).toBe(1);
    expect(await recordedCount(database, "001_configurations.sql")).toBe(1);
  } finally {
    await forgetProbe(database, "migration_failure_probe", "5_fail.sql");
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Asserts an empty directory fails before it changes bookkeeping.
 *
 * Purpose: a wrong folder is an error, not a report that every migration is done.
 * Inputs: none.
 * Side effects: creates an empty temp directory and removes it.
 */
async function expectEmptyDirectoryThrows(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "reactiv-migrate-"));
  const database = requirePool();
  try {
    await expect(applyMigrations(database, directory)).rejects.toThrow(/No SQL migrations found/);
    expect(await recordedCount(database, "001_configurations.sql")).toBe(1);
    expect(await tableExists(database, "configurations")).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Asserts two migrators record one new file once.
 *
 * Purpose: the session lock keeps overlapping runs from applying the same file twice.
 * Inputs: none.
 * Side effects: creates a probe table, then drops it and removes its bookkeeping row.
 */
async function expectConcurrentApplyRecordsOnce(): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "reactiv-migrate-"));
  const database = requirePool();
  try {
    await writeFile(join(directory, "6_lock.sql"), "CREATE TABLE migration_lock_probe (id int);\n", "utf8");
    const first = applyMigrations(database, directory);
    const second = applyMigrations(database, directory);
    const applied = await Promise.all([first, second]);
    let seen = 0;
    for (const batch of applied) {
      for (const name of batch) {
        // Count the filename rather than assuming which call won the lock.
        if (name === "6_lock.sql") {
          seen += 1;
        }
      }
    }
    expect(seen).toBe(1);
    expect(await recordedCount(database, "6_lock.sql")).toBe(1);
    expect(await tableExists(database, "migration_lock_probe")).toBe(true);
  } finally {
    await forgetProbe(database, "migration_lock_probe", "6_lock.sql");
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Asserts an idle rollback and a rollback after a failed statement both clear the session.
 *
 * Purpose: a caught database error can return its connection to the pool.
 * Inputs: none.
 * Side effects: opens one connection, rolls it back, and releases it.
 */
async function expectRollbackClearsAFailedTransaction(): Promise<void> {
  const client = await requirePool().connect();
  try {
    // ROLLBACK on an idle session must not throw or block the next statement.
    await rollbackQuietly(client);
    const idle = await client.query<{ ok: number }>("SELECT 1 AS ok");
    expect(idle.rows.at(0)?.ok).toBe(1);
    await client.query("BEGIN");
    await expect(client.query("SELECT 1/0")).rejects.toThrow();
    await rollbackQuietly(client);
    const cleared = await client.query<{ ok: number }>("SELECT 1 AS ok");
    expect(cleared.rows.at(0)?.ok).toBe(1);
  } finally {
    client.release();
  }
}

/**
 * Asserts the test setup refuses a database other than reactiv_test.
 *
 * Purpose: a mispointed URL must fail before a connection attempt.
 * Inputs: none.
 * Side effects: changes DATABASE_URL_TEST for the duration of the call, then restores it.
 */
async function expectOtherDatabaseIsRefused(): Promise<void> {
  const previous = process.env.DATABASE_URL_TEST;
  // Port 1 would hang if the guard connected. The name check happens first.
  process.env.DATABASE_URL_TEST = "postgres://reactiv:reactiv@127.0.0.1:1/reactiv";
  try {
    await expect(createTestPool()).rejects.toThrow("DATABASE_URL_TEST must point at the reactiv_test database.");
  } finally {
    restoreTestUrl(previous);
  }
}

/**
 * Asserts a blank test URL falls through to .env and still opens reactiv_test.
 *
 * Purpose: an empty shell value is treated as unset.
 * Inputs: none.
 * Side effects: opens a second pool and closes it. Restores DATABASE_URL_TEST.
 */
async function expectBlankTestUrlUsesTheEnvFile(): Promise<void> {
  const previous = process.env.DATABASE_URL_TEST;
  let extra: Pool | undefined;
  process.env.DATABASE_URL_TEST = "   ";
  try {
    extra = await createTestPool();
    const result = await extra.query<{ name: string }>("SELECT current_database() AS name");
    expect(result.rows.at(0)?.name).toBe("reactiv_test");
  } finally {
    restoreTestUrl(previous);
    if (extra !== undefined) {
      await extra.end();
    }
  }
}

/**
 * Registers the migration suite.
 *
 * Purpose: cover ordering, rollback, locking, and the test-database guard.
 * Inputs: none.
 * Side effects: registers hooks and tests.
 */
function registerMigrationTests(): void {
  beforeAll(openPool, 20_000);
  afterAll(closePool);
  it("applies 2 before 10 and does not reapply a recorded name", expectNumericOrderAndRecordedNames);
  it("commits every statement in one migration file", expectMultiStatementFileCommits);
  it("rolls back a failing migration and leaves the pool usable", expectFailedMigrationRollsBack);
  it("throws for an empty directory and keeps the applied migration", expectEmptyDirectoryThrows);
  it("records one file when two migrators run together", expectConcurrentApplyRecordsOnce);
  it("clears an idle session and a failed transaction", expectRollbackClearsAFailedTransaction);
  it("refuses a test URL that does not name reactiv_test", expectOtherDatabaseIsRefused, 15_000);
  it("uses .env when DATABASE_URL_TEST is blank", expectBlankTestUrlUsesTheEnvFile, 20_000);
}

describe("postgres migrations", registerMigrationTests);
