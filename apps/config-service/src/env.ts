/** The example file's token. It is not a credential. */
export const PLACEHOLDER_SERVICE_TOKEN = "replace-me";

/** Authenticated writes allowed per minute when the environment does not override it. */
export const DEFAULT_WRITE_RATE_LIMIT_PER_MINUTE = 600;

const INVALID_WRITE_RATE_LIMIT = "Invalid environment variable: RATE_LIMIT_WRITES_PER_MINUTE";

/**
 * Reads one non-blank environment variable.
 *
 * Purpose: tell a missing setting apart from a value that is only whitespace.
 * Inputs: name, the environment variable to read.
 * Side effects: none. The value is not logged.
 */
export function readOptionalEnv(name: string): string | undefined {
  // Read the process environment. There is no fallback credential.
  const value = process.env[name];
  // Unset and blank both count as missing.
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  // Keep the original text so a later check can see the real value.
  return value;
}

/**
 * Names a missing or blank required variable.
 *
 * Purpose: startup and the seed share one sentence that names the variable and not the value.
 * Inputs: name, the environment variable to require.
 * Side effects: none.
 */
export function missingRequiredEnvProblem(name: string): string | undefined {
  // Unset and whitespace are the same gap. There is no built-in fallback.
  if (readOptionalEnv(name) === undefined) {
    return `Missing required environment variable: ${name}`;
  }
  return undefined;
}

/**
 * Names a token that is missing or still the example placeholder.
 *
 * Purpose: replace-me is not a credential, and a blank token is not replaced with one.
 * Inputs: CONFIG_SERVICE_TOKEN from the environment.
 * Side effects: none. The token text is not included.
 */
export function serviceTokenProblem(): string | undefined {
  // Read the original text. Blank is missing.
  const token = readOptionalEnv("CONFIG_SERVICE_TOKEN");
  if (token === undefined) {
    return "Missing required environment variable: CONFIG_SERVICE_TOKEN";
  }
  // Surrounding spaces do not turn the example placeholder into a credential.
  if (token.trim() === PLACEHOLDER_SERVICE_TOKEN) {
    return "Invalid environment variable: CONFIG_SERVICE_TOKEN";
  }
  return undefined;
}

/**
 * Reads the bearer token the service will accept.
 *
 * Purpose: give authentication one source for the server credential.
 * Inputs: CONFIG_SERVICE_TOKEN from the environment.
 * Side effects: none. The token is not logged.
 */
export function readConfiguredServiceToken(): string | undefined {
  // Missing, blank, and the example placeholder are not credentials.
  if (serviceTokenProblem() !== undefined) {
    return undefined;
  }
  // A usable token keeps its original text, including surrounding spaces.
  return readOptionalEnv("CONFIG_SERVICE_TOKEN");
}

/**
 * Reads the authenticated write limit.
 *
 * Purpose: honor RATE_LIMIT_WRITES_PER_MINUTE, or use 600 when it is unset.
 * Inputs: RATE_LIMIT_WRITES_PER_MINUTE from the environment.
 * Side effects: throws when the value is set and is not a positive integer. The thrown message does not include the value.
 */
export function readWriteRateLimitPerMinute(): number {
  // An unset or blank limit stays on the default.
  const raw = readOptionalEnv("RATE_LIMIT_WRITES_PER_MINUTE");
  if (raw === undefined) {
    return DEFAULT_WRITE_RATE_LIMIT_PER_MINUTE;
  }
  // Number() accepts "1" and rejects blanks, which were already filtered.
  const limit = Number(raw);
  // Zero, fractions, and text are not a usable quota.
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(INVALID_WRITE_RATE_LIMIT);
  }
  return limit;
}

/**
 * Resolves the write limit for one server instance.
 *
 * Purpose: let a test pass a low limit without changing the process default.
 * Inputs: override, a positive integer. Omit it to read the environment.
 * Side effects: throws when override is not a positive integer, or when the environment value is unusable.
 */
export function resolveWriteRateLimitPerMinute(override?: number): number {
  // The environment is the process setting. An override is for one constructed server.
  if (override === undefined) {
    return readWriteRateLimitPerMinute();
  }
  // A test limit still has to be a whole number of attempts.
  if (!Number.isInteger(override) || override < 1) {
    throw new Error(INVALID_WRITE_RATE_LIMIT);
  }
  return override;
}

/**
 * Turns an unusable write limit into a startup problem line.
 *
 * Purpose: report the variable name without printing the rejected text.
 * Inputs: RATE_LIMIT_WRITES_PER_MINUTE from the environment.
 * Side effects: none.
 */
function writeRateLimitProblem(): string | undefined {
  try {
    // A valid limit is not a startup problem.
    readWriteRateLimitPerMinute();
    return undefined;
  } catch (error) {
    // Use the stable message. Do not append the rejected text.
    if (error instanceof Error) {
      return error.message;
    }
    return INVALID_WRITE_RATE_LIMIT;
  }
}

/**
 * Requires the token, database URL, and demo tenant before the process listens.
 *
 * Purpose: fail closed when required server configuration is absent or the token is the example placeholder.
 * Inputs: CONFIG_SERVICE_TOKEN, DATABASE_URL, DEMO_TENANT_ID, and RATE_LIMIT_WRITES_PER_MINUTE from the environment.
 * Side effects: writes one stderr line per problem and exits with status 1.
 */
export function assertRequiredServerEnv(): void {
  // Gather every gap so one startup names each problem.
  const problems: string[] = [];
  // No default token. replace-me is present but not a credential.
  const tokenProblem = serviceTokenProblem();
  if (tokenProblem !== undefined) {
    problems.push(tokenProblem);
  }
  // Health does not connect, but the service still refuses to boot without a URL.
  const databaseProblem = missingRequiredEnvProblem("DATABASE_URL");
  if (databaseProblem !== undefined) {
    problems.push(databaseProblem);
  }
  // The tenant is selected by the server. A blank value is not filled in from the request.
  const tenantProblem = missingRequiredEnvProblem("DEMO_TENANT_ID");
  if (tenantProblem !== undefined) {
    problems.push(tenantProblem);
  }
  // A bad write quota is named. The rejected text is not printed.
  const rateLimitProblem = writeRateLimitProblem();
  if (rateLimitProblem !== undefined) {
    problems.push(rateLimitProblem);
  }
  // Stay up only when every required check passed.
  if (problems.length === 0) {
    return;
  }
  // Name the problems. Do not print a sample credential.
  for (const problem of problems) {
    console.error(problem);
  }
  process.exit(1);
}

/**
 * Reads the Postgres URL for the configuration service.
 *
 * Purpose: give the process pool one connection string after startup checks have passed.
 * Inputs: DATABASE_URL from the environment.
 * Side effects: none. The URL is not logged.
 */
export function readDatabaseUrl(): string {
  // Blank was already rejected at startup. This is the same check for a direct caller.
  const value = readOptionalEnv("DATABASE_URL");
  if (value === undefined) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }
  return value;
}

/**
 * Reads the address the configuration service should bind.
 *
 * Purpose: honor HOST, then CONFIG_SERVICE_HOST, then loopback.
 * Inputs: HOST and CONFIG_SERVICE_HOST from the environment.
 * Side effects: none.
 */
export function readListenHost(): string {
  // HOST is the process setting. The example file also names CONFIG_SERVICE_HOST.
  const configured = readOptionalEnv("HOST") ?? readOptionalEnv("CONFIG_SERVICE_HOST");
  // An unset host stays on loopback. Compose sets HOST itself when it publishes the port.
  if (configured === undefined) {
    return "127.0.0.1";
  }
  return configured;
}

/**
 * Reads the port the configuration service should bind.
 *
 * Purpose: honor PORT, then CONFIG_SERVICE_PORT, then 4001.
 * Inputs: PORT and CONFIG_SERVICE_PORT from the environment.
 * Side effects: exits with status 1 when a provided port is not a usable integer.
 */
export function readListenPort(): number {
  // Check the generic name first so a shell PORT override wins.
  const fromPort = readOptionalEnv("PORT");
  if (fromPort !== undefined) {
    return parsePort("PORT", fromPort);
  }
  // The example file uses CONFIG_SERVICE_PORT when PORT is unset.
  const fromServicePort = readOptionalEnv("CONFIG_SERVICE_PORT");
  if (fromServicePort !== undefined) {
    return parsePort("CONFIG_SERVICE_PORT", fromServicePort);
  }
  // The documented default matches the example URL.
  return 4001;
}

/**
 * Parses a port value from a named environment variable.
 *
 * Purpose: reject a port that Fastify cannot bind.
 * Inputs: name, the variable being parsed; raw, its non-blank text.
 * Side effects: exits with status 1 when raw is not an integer from 1 through 65535.
 */
function parsePort(name: string, raw: string): number {
  // Number() accepts "4001" and rejects blanks, which were already filtered.
  const port = Number(raw);
  // A host port must be an integer in the TCP range.
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`Invalid environment variable: ${name}`);
    process.exit(1);
  }
  return port;
}
