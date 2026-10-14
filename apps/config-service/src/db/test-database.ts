import { Pool } from "pg";
import { readDotEnv } from "./env-file.js";
import { applyMigrations } from "./migrate.js";
import { envFilePath, migrationsDirectory } from "./paths.js";
import { isPgErrorCode } from "./pg-error.js";

/** Compose creates this database for the reactiv user. CREATE DATABASE runs from it. */
const MAINTENANCE_DATABASE = "reactiv";

/** Repository tests own this database. They do not migrate the dev database. */
const TEST_DATABASE = "reactiv_test";

/**
 * Reads DATABASE_URL_TEST for repository tests.
 *
 * Purpose: use the shell value when it is set, otherwise the uncommitted env file.
 * Inputs: DATABASE_URL_TEST from the environment or .env.
 * Side effects: reads .env when the variable is unset. Does not write process.env.
 */
export function readTestDatabaseUrl(): string {
  const fromEnv = process.env.DATABASE_URL_TEST;
  // A present non-blank value wins so a CI shell can point tests at its own server.
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return fromEnv;
  }
  const fromFile = readDotEnv(envFilePath()).get("DATABASE_URL_TEST");
  // The file value is the local example URL after .env.example is copied.
  if (fromFile !== undefined && fromFile.trim() !== "") {
    return fromFile;
  }
  throw new Error("DATABASE_URL_TEST is not set. Copy .env.example to .env.");
}

/**
 * Reads the database name from a Postgres URL.
 *
 * Purpose: refuse to create or migrate any database other than reactiv_test from the test setup.
 * Inputs: connectionString, a postgres URL.
 * Side effects: none.
 */
function databaseName(connectionString: string): string {
  const url = new URL(connectionString);
  // The pathname is "/reactiv_test". Drop the leading slash.
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

/**
 * Rewrites a Postgres URL onto another database on the same server.
 *
 * Purpose: connect to the maintenance database before CREATE DATABASE.
 * Inputs: connectionString, the test URL. database, the database name to open.
 * Side effects: none.
 */
function connectionStringForDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  // Keep the user, password, host, and port. Change only the database name.
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Creates reactiv_test when the server does not already have it.
 *
 * Purpose: the test database is not created by Compose, which only creates `reactiv`.
 * Inputs: testUrl, the DATABASE_URL_TEST value.
 * Side effects: may create the reactiv_test database. Does not migrate it.
 */
async function ensureDatabaseExists(testUrl: string): Promise<void> {
  const name = databaseName(testUrl);
  // Tests must not create or migrate the dev database by accident.
  if (name !== TEST_DATABASE) {
    throw new Error("DATABASE_URL_TEST must point at the reactiv_test database.");
  }
  const admin = new Pool({
    connectionString: connectionStringForDatabase(testUrl, MAINTENANCE_DATABASE),
    connectionTimeoutMillis: 5000,
    max: 1,
    application_name: "reactiv-create-test-db",
  });
  try {
    const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DATABASE]);
    // The database is already present. A second test run leaves it in place.
    if ((existing.rowCount ?? 0) > 0) {
      return;
    }
    try {
      // CREATE DATABASE cannot run inside a transaction and cannot take a bound name.
      await admin.query(`CREATE DATABASE ${TEST_DATABASE}`);
    } catch (error) {
      // Another process created it between the lookup and this statement.
      if (!isPgErrorCode(error, "42P04")) {
        throw error;
      }
    }
  } finally {
    await admin.end();
  }
}

/**
 * Opens a migrated pool for reactiv_test.
 *
 * Purpose: repository tests run against a real database with the configuration table present.
 * Inputs: DATABASE_URL_TEST from the environment or .env.
 * Side effects: creates reactiv_test when needed, applies migrations, and returns an open pool.
 */
export async function createTestPool(): Promise<Pool> {
  const testUrl = readTestDatabaseUrl();
  // Create the empty database before opening the pool that will migrate it.
  await ensureDatabaseExists(testUrl);
  const pool = new Pool({
    connectionString: testUrl,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    max: 10,
    application_name: "reactiv-config-tests",
  });
  try {
    // The same runner as `pnpm db:migrate`, pointed at the test database.
    await applyMigrations(pool, migrationsDirectory());
    return pool;
  } catch (error) {
    // Do not leave a pool open when migration fails.
    await pool.end();
    throw error;
  }
}
