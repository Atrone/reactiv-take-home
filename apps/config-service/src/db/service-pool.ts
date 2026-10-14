import { Pool } from "pg";

/**
 * Reports an idle pool failure without the connection string.
 *
 * Purpose: keep the process alive when a checked-in client errors, and keep the URL out of the log.
 * Inputs: none. The driver error is ignored because its text can contain the URL.
 * Side effects: writes one fixed line to stderr.
 */
function reportIdlePoolError(): void {
  // Do not interpolate the driver error. It can repeat DATABASE_URL.
  console.error("The configuration database pool reported an idle client error.");
}

/**
 * Opens the pool for the configuration service process.
 *
 * Purpose: give create and load a Postgres pool without querying during construction.
 * Inputs: connectionString, DATABASE_URL. It is not logged.
 * Side effects: creates a pool. The first connection waits until a query runs.
 */
export function openServicePool(connectionString: string): Pool {
  const pool = new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    max: 10,
    application_name: "reactiv-config-service",
  });
  // An idle client error can include the connection string. The listener logs a fixed sentence.
  pool.on("error", reportIdlePoolError);
  return pool;
}
