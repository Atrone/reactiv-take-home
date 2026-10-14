import { Pool } from "pg";
import { createConfigurationRepository } from "../configurations/repository.js";
import { applyDotEnv } from "./env-file.js";
import { envFilePath } from "./paths.js";
import { seedDemoConfiguration, type SeedOutcome } from "./seed.js";
import { collectSeedProblems, readSeedSettings } from "./seed-env.js";

/**
 * Prints every setup problem and stops.
 *
 * Purpose: refuse the seed before opening a database connection.
 * Inputs: problems, the lines from collectSeedProblems. Each line names a variable.
 * Side effects: writes those lines to stderr and exits with status 1.
 */
function refuseSeed(problems: readonly string[]): never {
  // Name each gap. The values themselves are not in these lines.
  for (const problem of problems) {
    console.error(problem);
  }
  process.exit(1);
}

/**
 * Opens a pool for the seed command.
 *
 * Purpose: connect only after the environment checks have passed. This does not create tables.
 * Inputs: connectionString, DATABASE_URL. It is not logged.
 * Side effects: creates a pool. The first query waits until the seed runs.
 */
function openSeedPool(connectionString: string): Pool {
  // The timeout bounds a refused connection. Migrations are not applied here.
  return new Pool({
    connectionString,
    connectionTimeoutMillis: 5000,
    statement_timeout: 8000,
    max: 1,
    application_name: "reactiv-seed",
    allowExitOnIdle: true,
  });
}

/**
 * Prints whether this run inserted the demo row.
 *
 * Purpose: say that the row was inserted, or that the existing row was left alone.
 * Inputs: outcome, the result of seedDemoConfiguration.
 * Side effects: writes one stdout line. Does not print the database URL or the token.
 */
function writeSeedReport(outcome: SeedOutcome): void {
  // The insert path is the only one that writes revision 1.
  if (outcome === "inserted") {
    console.log("Inserted the demo configuration.");
    return;
  }
  // An existing row keeps its revision, timestamp, and document.
  console.log("Left the existing row alone.");
}

/**
 * Reports a seed failure without printing the database URL.
 *
 * Purpose: turn a connection or SQL failure into a non-zero exit.
 * Inputs: error, the failure from main.
 * Side effects: writes a message to stderr and exits with status 1.
 */
function reportSeedFailure(error: unknown): void {
  // Use the error text only. Do not read DATABASE_URL or the token here.
  const message = error instanceof Error ? error.message : "Seed failed";
  console.error(message);
  process.exit(1);
}

/**
 * Inserts the demo configuration when it is not already stored.
 *
 * Purpose: the `pnpm db:seed` command. A second run leaves the stored row in place.
 * Inputs: the shell environment, filled from .env when a key is unset.
 * Side effects: may insert one row, then exits. Does not create tables and does not update an existing row.
 */
async function main(): Promise<void> {
  // Fill unset keys from .env. A shell assignment stays in place, including a blank one.
  applyDotEnv(envFilePath());
  // Stop before connecting when the token is replace-me or a demo id is blank.
  const problems = collectSeedProblems();
  if (problems.length > 0) {
    refuseSeed(problems);
  }
  // The checks above passed, so these three values are present.
  const settings = readSeedSettings();
  const pool = openSeedPool(settings.databaseUrl);
  try {
    // The repository insert sets revision 1. GET is not on this path.
    const repository = createConfigurationRepository(pool);
    const outcome = await seedDemoConfiguration(repository, {
      tenantId: settings.tenantId,
      configurationId: settings.configurationId,
    });
    writeSeedReport(outcome);
  } finally {
    // Close the pool so the process can exit after the report.
    await pool.end();
  }
}

main().catch(reportSeedFailure);
