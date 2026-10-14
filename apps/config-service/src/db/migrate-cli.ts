import { Pool } from "pg";
import { applyDotEnv } from "./env-file.js";
import { applyMigrations } from "./migrate.js";
import { envFilePath, migrationsDirectory } from "./paths.js";

/**
 * Reads DATABASE_URL for the migration command.
 *
 * Purpose: fail closed when the database URL is missing, without printing a URL.
 * Inputs: DATABASE_URL from the environment, after the env file has been applied.
 * Side effects: writes one stderr line and exits with status 1 when the URL is missing or blank.
 */
function requiredDatabaseUrl(): string {
  const value = process.env.DATABASE_URL;
  // Unset and blank both count as missing. Do not invent a URL.
  if (value === undefined || value.trim() === "") {
    console.error("Missing required environment variable: DATABASE_URL");
    process.exit(1);
  }
  return value;
}

/**
 * Prints which files this run applied.
 *
 * Purpose: show the migration result without printing the connection string.
 * Inputs: applied, the filenames recorded on this run.
 * Side effects: writes one stdout line per file, or one line when nothing was pending.
 */
function writeMigrationReport(applied: readonly string[]): void {
  // An empty list means every filename was already in schema_migrations.
  if (applied.length === 0) {
    console.log("No pending migrations.");
    return;
  }
  for (const name of applied) {
    console.log(`Applied ${name}`);
  }
}

/**
 * Reports a migration failure without printing the database URL.
 *
 * Purpose: turn a connection or SQL failure into a non-zero exit.
 * Inputs: error, the failure from main.
 * Side effects: writes a message to stderr and exits with status 1.
 */
function reportMigrationFailure(error: unknown): void {
  // Use the error text only. Do not read DATABASE_URL here.
  const message = error instanceof Error ? error.message : "Migration failed";
  console.error(message);
  process.exit(1);
}

/**
 * Applies db/migrations to DATABASE_URL.
 *
 * Purpose: the `pnpm db:migrate` command.
 * Inputs: DATABASE_URL from the shell or the uncommitted .env file.
 * Side effects: migrates that database and exits the process on failure.
 */
async function main(): Promise<void> {
  // Fill unset keys from .env. A shell DATABASE_URL stays in place.
  applyDotEnv(envFilePath());
  const databaseUrl = requiredDatabaseUrl();
  const pool = new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 5000,
    application_name: "reactiv-migrate",
    allowExitOnIdle: true,
  });
  try {
    const applied = await applyMigrations(pool, migrationsDirectory());
    writeMigrationReport(applied);
  } finally {
    // Close the pool so the process can exit after the report.
    await pool.end();
  }
}

main().catch(reportMigrationFailure);
