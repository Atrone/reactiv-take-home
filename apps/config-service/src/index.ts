import { CONTRACTS_PACKAGE_NAME } from "@reactiv/contracts";
import { createConfigurationRepository } from "./configurations/repository.js";
import { openServicePool } from "./db/service-pool.js";
import { assertRequiredServerEnv, readDatabaseUrl, readListenHost, readListenPort } from "./env.js";
import { buildServer } from "./server.js";

/**
 * Boots the configuration service or exits.
 *
 * Purpose: refuse to listen when the token, database URL, or demo tenant is missing, or the token is the placeholder replace-me.
 * Inputs: CONFIG_SERVICE_TOKEN, DATABASE_URL, DEMO_TENANT_ID, HOST, PORT, CONFIG_SERVICE_HOST, CONFIG_SERVICE_PORT, and RATE_LIMIT_WRITES_PER_MINUTE.
 * Side effects: may exit with status 1, otherwise opens a pool and binds an HTTP server. Health does not query the pool.
 */
async function main(): Promise<void> {
  // Stop before opening a socket when the token, database URL, or demo tenant is missing, or the token is the placeholder.
  assertRequiredServerEnv();
  // The pool connects on the first create, load, or update. Constructing it does not query.
  const pool = openServicePool(readDatabaseUrl());
  const app = buildServer(CONTRACTS_PACKAGE_NAME, undefined, {
    repository: createConfigurationRepository(pool),
  });

  /**
   * Closes the database pool when the server closes.
   *
   * Purpose: release clients after the process stops listening.
   * Inputs: none. The pool is the one opened for this process.
   * Side effects: ends the pool.
   */
  async function closeServicePool(): Promise<void> {
    // end() waits for an active query. Health does not start one.
    await pool.end();
  }

  app.addHook("onClose", closeServicePool);
  // Unset HOST and PORT fall back to 127.0.0.1 and 4001.
  const host = readListenHost();
  const port = readListenPort();
  // Listening does not query DATABASE_URL. The first query is create, load, or update.
  await app.listen({ host, port });
}

/**
 * Reports a startup failure without printing environment values.
 *
 * Purpose: turn a listen rejection into a non-zero exit.
 * Inputs: error, the failure from main.
 * Side effects: writes a message to stderr and exits with status 1.
 */
function reportStartupFailure(error: unknown): void {
  // Use the error text only. Do not read CONFIG_SERVICE_TOKEN here.
  const message = error instanceof Error ? error.message : "Configuration service failed to start";
  console.error(message);
  process.exit(1);
}

main().catch(reportStartupFailure);
