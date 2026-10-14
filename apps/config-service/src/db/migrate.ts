import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Pool, type PoolClient } from "pg";
import { rollbackQuietly } from "./rollback.js";

/** Session lock so two migrators apply the same directory one at a time. */
const MIGRATION_LOCK_KEY = 81404001;

/**
 * Bookkeeping table for applied filenames.
 *
 * This is created by the runner, not by a migration file, so the first run has
 * somewhere to record the file it just applied.
 */
const CREATE_SCHEMA_MIGRATIONS_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)
`;

/**
 * Orders migration filenames.
 *
 * Purpose: apply 001 before 002, including when a later file is not zero-padded.
 * Inputs: left and right, two filenames.
 * Side effects: none.
 */
function compareMigrationNames(left: string, right: string): number {
  // Numeric comparison keeps 2 before 10. The locale is fixed so the order does not follow the machine.
  return left.localeCompare(right, "en", { numeric: true });
}

/**
 * Lists SQL migration filenames.
 *
 * Purpose: the runner applies every .sql file and ignores anything else in the directory.
 * Inputs: directory, the migrations directory.
 * Side effects: reads the directory listing.
 */
async function listMigrationFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    // Directories and non-SQL files are not migrations.
    if (!entry.isFile() || !entry.name.endsWith(".sql")) {
      continue;
    }
    names.push(entry.name);
  }
  // Filename order is the apply order.
  names.sort(compareMigrationNames);
  // A wrong directory should fail here instead of reporting that everything is already applied.
  if (names.length === 0) {
    throw new Error(`No SQL migrations found in ${directory}`);
  }
  return names;
}

/**
 * Creates the migration bookkeeping table.
 *
 * Purpose: record applied filenames. A second run sees the same table.
 * Inputs: client, the locked connection.
 * Side effects: creates schema_migrations when it is missing.
 */
async function ensureSchemaMigrations(client: PoolClient): Promise<void> {
  // IF NOT EXISTS makes this statement safe on every run.
  await client.query(CREATE_SCHEMA_MIGRATIONS_SQL);
}

/**
 * Applies one pending file and records its name.
 *
 * Purpose: commit the SQL and the bookkeeping row together.
 * Inputs: client, the locked connection. directory, the migrations directory. filename, the pending file.
 * Side effects: writes the schema and one schema_migrations row, or rolls both back.
 */
async function applyOneMigration(client: PoolClient, directory: string, filename: string): Promise<void> {
  // Read the file only after deciding it has not been applied.
  const sql = await readFile(join(directory, filename), "utf8");
  // The filename is bound. The SQL text comes from the migration file.
  await client.query("BEGIN");
  try {
    // The migration file is one or more statements. It carries no parameters.
    await client.query(sql);
    // Record the name in the same transaction as the schema change.
    await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [filename]);
    await client.query("COMMIT");
  } catch (error) {
    // Drop the schema change when the file or the bookkeeping insert fails.
    await rollbackQuietly(client);
    throw error;
  }
}

/**
 * Applies pending SQL migrations in filename order.
 *
 * Purpose: bring a database up to the files in db/migrations. A second call applies nothing.
 * Inputs: pool, the database to migrate. directory, the folder of .sql files.
 * Side effects: creates schema_migrations, applies pending files, and records their names.
 */
export async function applyMigrations(pool: Pool, directory: string): Promise<string[]> {
  const filenames = await listMigrationFiles(directory);
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    // Hold the lock on this connection until every pending file has been considered.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    await ensureSchemaMigrations(client);
    const existing = await client.query<{ name: string }>("SELECT name FROM schema_migrations");
    const seen = new Set<string>();
    for (const row of existing.rows) {
      seen.add(row.name);
    }
    for (const filename of filenames) {
      // A recorded name is skipped, so the command is safe to run twice.
      if (seen.has(filename)) {
        continue;
      }
      await applyOneMigration(client, directory, filename);
      applied.push(filename);
    }
    return applied;
  } finally {
    try {
      // Release the session lock before the connection returns to the pool.
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    } catch {
      // Closing the connection also drops a session lock.
    }
    client.release();
  }
}
