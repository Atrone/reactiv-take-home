import { missingRequiredEnvProblem, readOptionalEnv, serviceTokenProblem } from "../env.js";

/** Values the seed command needs after the setup checks have passed. */
export type SeedSettings = {
  databaseUrl: string;
  tenantId: string;
  configurationId: string;
};

/**
 * Collects the reasons the seed must refuse to run.
 *
 * Purpose: stop before Postgres when the token is the example placeholder or a demo id is blank.
 * Inputs: CONFIG_SERVICE_TOKEN, DATABASE_URL, DEMO_TENANT_ID, and DEMO_CONFIGURATION_ID from the environment.
 * Side effects: none. The messages name the variables and do not include the values.
 */
export function collectSeedProblems(): string[] {
  // Report every gap. One missing id does not hide the placeholder token.
  const problems: string[] = [];
  // replace-me is not a credential. A blank token is missing, not a built-in secret.
  const tokenProblem = serviceTokenProblem();
  if (tokenProblem !== undefined) {
    problems.push(tokenProblem);
  }
  // The seed writes to this database. It does not invent a URL.
  const databaseProblem = missingRequiredEnvProblem("DATABASE_URL");
  if (databaseProblem !== undefined) {
    problems.push(databaseProblem);
  }
  // The demo row belongs to the server-selected tenant.
  const tenantProblem = missingRequiredEnvProblem("DEMO_TENANT_ID");
  if (tenantProblem !== undefined) {
    problems.push(tenantProblem);
  }
  // The demo row uses the server-selected configuration id.
  const configurationProblem = missingRequiredEnvProblem("DEMO_CONFIGURATION_ID");
  if (configurationProblem !== undefined) {
    problems.push(configurationProblem);
  }
  return problems;
}

/**
 * Reads the database URL and the demo ids.
 *
 * Purpose: give the seed command the values it will write, after collectSeedProblems is empty.
 * Inputs: DATABASE_URL, DEMO_TENANT_ID, and DEMO_CONFIGURATION_ID from the environment.
 * Side effects: throws when a required value is blank. The thrown text does not include the value.
 */
export function readSeedSettings(): SeedSettings {
  // These are the same non-blank reads the problem list uses.
  const databaseUrl = readOptionalEnv("DATABASE_URL");
  const tenantId = readOptionalEnv("DEMO_TENANT_ID");
  const configurationId = readOptionalEnv("DEMO_CONFIGURATION_ID");
  // The command should have exited before this when any of them is blank.
  if (databaseUrl === undefined || tenantId === undefined || configurationId === undefined) {
    throw new Error("Seed settings were read before the environment was checked.");
  }
  return {
    databaseUrl,
    tenantId,
    configurationId,
  };
}
