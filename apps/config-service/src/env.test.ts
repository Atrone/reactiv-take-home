import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDotEnv } from "./db/env-file.js";
import { repositoryRoot } from "./db/paths.js";
import {
  assertRequiredServerEnv,
  DEFAULT_WRITE_RATE_LIMIT_PER_MINUTE,
  readConfiguredServiceToken,
  readDatabaseUrl,
  readListenHost,
  readListenPort,
  readWriteRateLimitPerMinute,
} from "./env.js";

const managedKeys = [
  "CONFIG_SERVICE_TOKEN",
  "DATABASE_URL",
  "DEMO_TENANT_ID",
  "DEMO_CONFIGURATION_ID",
  "HOST",
  "PORT",
  "CONFIG_SERVICE_HOST",
  "CONFIG_SERVICE_PORT",
  "RATE_LIMIT_WRITES_PER_MINUTE",
] as const;

/** Environment values from before this file mutates them. */
const originalEnv = new Map<string, string | undefined>();

/**
 * Remembers the current service environment.
 *
 * Purpose: restore variables after every test that mutates them.
 * Inputs: none.
 * Side effects: records the current values of the managed keys.
 */
function rememberEnv(): void {
  // Snapshot only the keys this file writes. Keep the snapshot for every restore.
  for (const key of managedKeys) {
    originalEnv.set(key, process.env[key]);
  }
}

/**
 * Puts the service environment back.
 *
 * Purpose: keep one test from changing the next test's inputs.
 * Inputs: none.
 * Side effects: writes the original values back to process.env.
 */
function restoreEnv(): void {
  // Replace each managed key with the original snapshot, including an unset value.
  for (const [key, value] of originalEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Applies a partial environment for one assertion.
 *
 * Purpose: set only the variables named by a case.
 * Inputs: values, the keys to set. An undefined entry deletes that key.
 * Side effects: mutates process.env until restoreEnv runs.
 */
function applyEnv(values: Partial<Record<(typeof managedKeys)[number], string | undefined>>): void {
  // Start from a clean set of managed keys so a parent shell cannot leak in.
  for (const key of managedKeys) {
    delete process.env[key];
  }
  // Apply the case. Undefined leaves the key unset.
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Captures a fail-closed exit without stopping the test runner.
 *
 * Purpose: record the exit status and stderr lines from a startup check.
 * Inputs: run, the check to execute.
 * Side effects: stubs process.exit and console.error for the call, then restores them.
 */
function captureExit(run: () => void): { code: number | undefined; errors: string[] } {
  // Collect stderr text. The real console stays quiet.
  const errors: string[] = [];
  const errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args.map((part) => String(part)).join(" "));
  });
  // Stand in for process.exit so the runner keeps going.
  let code: number | undefined;
  const exitSpy = vi.spyOn(process, "exit").mockImplementation(((status?: number) => {
    code = status;
    throw new Error("process.exit");
  }) as typeof process.exit);
  try {
    run();
  } catch (error) {
    // Only the stubbed exit is expected. Any other failure still fails the test.
    if (!(error instanceof Error) || error.message !== "process.exit") {
      throw error;
    }
  } finally {
    exitSpy.mockRestore();
    errorSpy.mockRestore();
  }
  return { code, errors };
}

/**
 * Asserts a missing-variable exit.
 *
 * Purpose: require a non-zero exit that names each missing variable and no credential.
 * Inputs: names, the variables that must appear; values, the environment for the case.
 * Side effects: mutates process.env, then restores it through the suite hook.
 */
function expectMissing(names: string[], values: Partial<Record<(typeof managedKeys)[number], string | undefined>>): void {
  // Apply the case before the check reads the environment.
  applyEnv(values);
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  // The process must stop, and the message must name the gap rather than invent a token.
  expect(result.code).toBe(1);
  expect(result.errors).toEqual(names.map((name) => `Missing required environment variable: ${name}`));
  expect(result.errors.join("\n")).not.toContain("replace-me");
  expect(result.errors.join("\n")).not.toContain("postgres://");
}

/**
 * Asserts that a real token and database URL allow startup checks to return.
 *
 * Purpose: a non-placeholder credential is enough to pass the boot check.
 * Inputs: none. The environment is applied inside the function.
 * Side effects: mutates process.env for the assertion.
 */
function expectRealTokenBoots(): void {
  // The token is not the example placeholder.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBeUndefined();
  expect(result.errors).toEqual([]);
}

/**
 * Asserts that the example placeholder refuses to listen.
 *
 * Purpose: replace-me is not a credential, even when the database URL is present.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectPlaceholderRefusesToBoot(): void {
  // The literal placeholder is present and must still stop the process.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "replace-me",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBe(1);
  expect(result.errors).toEqual(["Invalid environment variable: CONFIG_SERVICE_TOKEN"]);
  expect(result.errors.join("\n")).not.toContain("replace-me");
}

/**
 * Asserts that padding around the placeholder still refuses to listen.
 *
 * Purpose: spaces do not turn replace-me into a credential.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectPaddedPlaceholderRefusesToBoot(): void {
  // Trimmed, the value is still the literal placeholder.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "  replace-me  ",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBe(1);
  expect(result.errors).toEqual(["Invalid environment variable: CONFIG_SERVICE_TOKEN"]);
  expect(result.errors.join("\n")).not.toContain("replace-me");
}

/**
 * Asserts that a token which only contains the placeholder text can boot.
 *
 * Purpose: the rejection is the literal replace-me, not a substring.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectLongerTokenBoots(): void {
  // This is a different credential from the example placeholder.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "replace-me-extra",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBeUndefined();
}

/**
 * Asserts that padding around a real token still counts as present.
 *
 * Purpose: only a blank value is missing. Surrounding spaces are not a second credential check.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectPaddedTokenBoots(): void {
  // The trimmed text is not empty and is not the placeholder.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "  local-service-token  ",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBeUndefined();
}

/**
 * Asserts that the placeholder and a missing database URL are both named.
 *
 * Purpose: one bad token does not hide the missing database URL.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectPlaceholderAndMissingDatabase(): void {
  // The placeholder is invalid and the database URL is absent.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "replace-me",
    DEMO_TENANT_ID: "tenant_demo",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBe(1);
  expect(result.errors).toEqual([
    "Invalid environment variable: CONFIG_SERVICE_TOKEN",
    "Missing required environment variable: DATABASE_URL",
  ]);
  expect(result.errors.join("\n")).not.toContain("replace-me");
}

/**
 * Asserts that the placeholder and a missing demo tenant are both named.
 *
 * Purpose: one bad token does not hide the missing tenant when the database URL is present.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectPlaceholderAndMissingTenant(): void {
  // The database URL is present. The token and the tenant are the problems.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "replace-me",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBe(1);
  expect(result.errors).toEqual([
    "Invalid environment variable: CONFIG_SERVICE_TOKEN",
    "Missing required environment variable: DEMO_TENANT_ID",
  ]);
  expect(result.errors.join("\n")).not.toContain("replace-me");
  expect(result.errors.join("\n")).not.toContain("postgres://");
}

/**
 * Asserts that a missing demo tenant and a bad write limit are both named.
 *
 * Purpose: the tenant check does not stop the startup report before the write limit.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectMissingTenantAndInvalidWriteLimit(): void {
  applyEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    RATE_LIMIT_WRITES_PER_MINUTE: "0",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBe(1);
  expect(result.errors).toEqual([
    "Missing required environment variable: DEMO_TENANT_ID",
    "Invalid environment variable: RATE_LIMIT_WRITES_PER_MINUTE",
  ]);
  expect(result.errors.join("\n")).not.toContain("local-service-token");
}

/**
 * Asserts startup does not require the demo configuration id.
 *
 * Purpose: DEMO_CONFIGURATION_ID is a seed setting. The service can listen without it.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectStartupDoesNotRequireTheConfigurationId(): void {
  applyEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
    DEMO_CONFIGURATION_ID: undefined,
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBeUndefined();
  expect(result.errors).toEqual([]);
}

/**
 * Asserts that a low write limit is accepted.
 *
 * Purpose: tests can set RATE_LIMIT_WRITES_PER_MINUTE without refusing to boot.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectLowWriteLimitBoots(): void {
  // One attempt per minute is a positive integer.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
    RATE_LIMIT_WRITES_PER_MINUTE: "1",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBeUndefined();
  expect(readWriteRateLimitPerMinute()).toBe(1);
}

/**
 * Asserts that an unusable write limit refuses to listen.
 *
 * Purpose: zero and text are not a quota, and the rejected text is not printed.
 * Inputs: raw, the rejected environment value.
 * Side effects: mutates process.env for the assertion.
 */
function expectInvalidWriteLimit(raw: string): void {
  // The token and database URL are present so the rate limit is the only problem.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
    RATE_LIMIT_WRITES_PER_MINUTE: raw,
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBe(1);
  expect(result.errors).toEqual(["Invalid environment variable: RATE_LIMIT_WRITES_PER_MINUTE"]);
  expect(result.errors.join("\n")).not.toContain(raw);
}

/**
 * Asserts the write limit when the variable is unset.
 *
 * Purpose: an omitted quota is 600 attempts per minute.
 * Inputs: none.
 * Side effects: clears the managed environment.
 */
function expectDefaultWriteLimit(): void {
  applyEnv({});
  // No RATE_LIMIT_WRITES_PER_MINUTE is the default.
  expect(readWriteRateLimitPerMinute()).toBe(DEFAULT_WRITE_RATE_LIMIT_PER_MINUTE);
}

/**
 * Asserts a blank write limit uses the default.
 *
 * Purpose: whitespace is not a quota and does not stop startup.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectBlankWriteLimitUsesTheDefault(): void {
  applyEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
    RATE_LIMIT_WRITES_PER_MINUTE: "   ",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBeUndefined();
  expect(readWriteRateLimitPerMinute()).toBe(DEFAULT_WRITE_RATE_LIMIT_PER_MINUTE);
}

/**
 * Asserts surrounding spaces on a numeric limit are still that limit.
 *
 * Purpose: a padded positive integer is a usable quota.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectPaddedWriteLimit(): void {
  applyEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
    RATE_LIMIT_WRITES_PER_MINUTE: " 2 ",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBeUndefined();
  expect(readWriteRateLimitPerMinute()).toBe(2);
}

/**
 * Asserts a different case from the placeholder is a real token.
 *
 * Purpose: only the exact example text is refused.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectCapitalizedPlaceholderBoots(): void {
  applyEnv({
    CONFIG_SERVICE_TOKEN: "Replace-me",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "tenant_demo",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBeUndefined();
  expect(readConfiguredServiceToken()).toBe("Replace-me");
}

/**
 * Asserts that a secret is not copied into the missing-variable message.
 *
 * Purpose: fail closed without echoing CONFIG_SERVICE_TOKEN.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectSecretStaysOutOfTheMessage(): void {
  // The token is present and the database URL is not.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "secret-token-value",
    DATABASE_URL: undefined,
    DEMO_TENANT_ID: "tenant_demo",
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  expect(result.code).toBe(1);
  expect(result.errors.join("\n")).not.toContain("secret-token-value");
}

/**
 * Asserts a missing or blank demo tenant refuses to listen.
 *
 * Purpose: DEMO_TENANT_ID is required, and the message names that variable.
 * Inputs: raw, the unset or blank tenant value.
 * Side effects: mutates process.env for the assertion.
 */
function expectMissingTenant(raw: string | undefined): void {
  // The token and database URL are present so the tenant is the only problem.
  applyEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: raw,
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  // The exit names the tenant. It does not invent one or print the token.
  expect(result.code).toBe(1);
  expect(result.errors).toEqual(["Missing required environment variable: DEMO_TENANT_ID"]);
  expect(result.errors.join("\n")).not.toContain("local-service-token");
  expect(result.errors.join("\n")).not.toContain("postgres://");
}

/**
 * Asserts that copying .env.example unchanged does not boot.
 *
 * Purpose: the example token is replace-me, and startup does not treat that file as a credential.
 * Inputs: none. The values come from .env.example.
 * Side effects: mutates process.env for the assertion.
 */
function expectUnchangedExampleFileRefusesToBoot(): void {
  // Read the committed example. This does not copy it over the local .env file.
  const example = readDotEnv(join(repositoryRoot(), ".env.example"));
  const token = example.get("CONFIG_SERVICE_TOKEN");
  // The template token is the placeholder, so an unchanged copy has no usable secret.
  expect(token).toBe("replace-me");
  applyEnv({
    CONFIG_SERVICE_TOKEN: token,
    DATABASE_URL: example.get("DATABASE_URL"),
    DEMO_TENANT_ID: example.get("DEMO_TENANT_ID"),
    DEMO_CONFIGURATION_ID: example.get("DEMO_CONFIGURATION_ID"),
  });
  const result = captureExit(() => {
    assertRequiredServerEnv();
  });
  // The placeholder stops startup. The database URL from the example is not printed.
  expect(result.code).toBe(1);
  expect(result.errors).toEqual(["Invalid environment variable: CONFIG_SERVICE_TOKEN"]);
  expect(result.errors.join("\n")).not.toContain("replace-me");
  expect(result.errors.join("\n")).not.toContain("postgres://");
}

/**
 * Asserts the loopback host default.
 *
 * Purpose: an unset host stays on 127.0.0.1.
 * Inputs: none.
 * Side effects: clears the host variables.
 */
function expectDefaultHost(): void {
  applyEnv({});
  expect(readListenHost()).toBe("127.0.0.1");
}

/**
 * Asserts HOST wins over CONFIG_SERVICE_HOST.
 *
 * Purpose: the process variable is the first choice.
 * Inputs: none.
 * Side effects: sets both host variables.
 */
function expectHostWins(): void {
  applyEnv({ HOST: "0.0.0.0", CONFIG_SERVICE_HOST: "127.0.0.1" });
  expect(readListenHost()).toBe("0.0.0.0");
}

/**
 * Asserts a blank HOST falls through to CONFIG_SERVICE_HOST.
 *
 * Purpose: whitespace is not a bind address.
 * Inputs: none.
 * Side effects: sets a blank HOST and a real CONFIG_SERVICE_HOST.
 */
function expectBlankHostFallsThrough(): void {
  applyEnv({ HOST: "   ", CONFIG_SERVICE_HOST: "0.0.0.0" });
  expect(readListenHost()).toBe("0.0.0.0");
}

/**
 * Asserts the port default.
 *
 * Purpose: an unset port is 4001.
 * Inputs: none.
 * Side effects: clears the port variables.
 */
function expectDefaultPort(): void {
  applyEnv({});
  expect(readListenPort()).toBe(4001);
}

/**
 * Asserts PORT wins over CONFIG_SERVICE_PORT.
 *
 * Purpose: the generic port variable is the first choice.
 * Inputs: none.
 * Side effects: sets both port variables.
 */
function expectPortWins(): void {
  applyEnv({ PORT: "4123", CONFIG_SERVICE_PORT: "4001" });
  expect(readListenPort()).toBe(4123);
}

/**
 * Asserts a blank PORT falls through to CONFIG_SERVICE_PORT.
 *
 * Purpose: whitespace does not hide the example-file port.
 * Inputs: none.
 * Side effects: sets a blank PORT and a numeric CONFIG_SERVICE_PORT.
 */
function expectBlankPortFallsThrough(): void {
  applyEnv({ PORT: "   ", CONFIG_SERVICE_PORT: "4123" });
  expect(readListenPort()).toBe(4123);
}

/**
 * Asserts the inclusive ends of the TCP port range.
 *
 * Purpose: 1 and 65535 are usable ports.
 * Inputs: none.
 * Side effects: sets PORT twice.
 */
function expectPortBounds(): void {
  applyEnv({ PORT: "1" });
  expect(readListenPort()).toBe(1);
  applyEnv({ PORT: "65535" });
  expect(readListenPort()).toBe(65535);
}

/**
 * Asserts an invalid port names the variable that supplied it.
 *
 * Purpose: reject values Fastify cannot bind.
 * Inputs: key, the variable under test; raw, the rejected text.
 * Side effects: sets that variable and stubs process.exit.
 */
function expectInvalidPort(key: "PORT" | "CONFIG_SERVICE_PORT", raw: string): void {
  applyEnv({ [key]: raw });
  const result = captureExit(() => {
    readListenPort();
  });
  expect(result.code).toBe(1);
  expect(result.errors).toEqual([`Invalid environment variable: ${key}`]);
}

rememberEnv();
afterEach(restoreEnv);

describe("required server environment", () => {
  it("names the token, database URL, and demo tenant when they are unset", () => {
    expectMissing(["CONFIG_SERVICE_TOKEN", "DATABASE_URL", "DEMO_TENANT_ID"], {});
  });

  it("names a whitespace token", () => {
    expectMissing(["CONFIG_SERVICE_TOKEN"], {
      CONFIG_SERVICE_TOKEN: "   ",
      DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
      DEMO_TENANT_ID: "tenant_demo",
    });
  });

  it("names a missing database URL", () => {
    expectMissing(["DATABASE_URL"], {
      CONFIG_SERVICE_TOKEN: "local-service-token",
      DEMO_TENANT_ID: "tenant_demo",
    });
  });

  it("names a whitespace database URL", () => {
    expectMissing(["DATABASE_URL"], {
      CONFIG_SERVICE_TOKEN: "local-service-token",
      DATABASE_URL: "   ",
      DEMO_TENANT_ID: "tenant_demo",
    });
  });

  it("names a missing demo tenant", () => {
    expectMissingTenant(undefined);
  });

  it("names a whitespace demo tenant", () => {
    expectMissingTenant("   ");
  });

  it("rejects the example file when it is copied unchanged", expectUnchangedExampleFileRefusesToBoot);

  it("accepts a real token when both values are present", expectRealTokenBoots);

  it("rejects the example placeholder", expectPlaceholderRefusesToBoot);

  it("rejects a padded example placeholder", expectPaddedPlaceholderRefusesToBoot);

  it("accepts a token that only contains the placeholder text", expectLongerTokenBoots);

  it("accepts a token that has surrounding spaces", expectPaddedTokenBoots);

  it("names the placeholder and a missing database URL", expectPlaceholderAndMissingDatabase);
  it("names the placeholder and a missing demo tenant", expectPlaceholderAndMissingTenant);
  it("names a missing demo tenant and an invalid write limit", expectMissingTenantAndInvalidWriteLimit);
  it("does not require the demo configuration id", expectStartupDoesNotRequireTheConfigurationId);

  it("accepts a write limit of one per minute", expectLowWriteLimitBoots);

  it("rejects a write limit of zero", () => {
    expectInvalidWriteLimit("0");
  });

  it("rejects a write limit that is not a number", () => {
    expectInvalidWriteLimit("nope");
  });

  it("rejects a fractional write limit", () => {
    expectInvalidWriteLimit("1.5");
  });

  it("rejects a negative write limit", () => {
    expectInvalidWriteLimit("-5");
  });

  it("uses the default write limit when the variable is unset", expectDefaultWriteLimit);
  it("uses the default write limit when the variable is blank", expectBlankWriteLimitUsesTheDefault);
  it("accepts a write limit with surrounding spaces", expectPaddedWriteLimit);
  it("accepts a token that differs from the placeholder by case", expectCapitalizedPlaceholderBoots);

  it("does not print the token while naming the missing database URL", expectSecretStaysOutOfTheMessage);
});

describe("listen address", () => {
  it("defaults the host to loopback", expectDefaultHost);
  it("prefers HOST over CONFIG_SERVICE_HOST", expectHostWins);
  it("skips a blank HOST", expectBlankHostFallsThrough);
  it("defaults the port to 4001", expectDefaultPort);
  it("prefers PORT over CONFIG_SERVICE_PORT", expectPortWins);
  it("skips a blank PORT", expectBlankPortFallsThrough);
  it("accepts the ends of the TCP range", expectPortBounds);

  it("rejects a non-numeric PORT", () => {
    expectInvalidPort("PORT", "abc");
  });

  it("rejects port 0", () => {
    expectInvalidPort("PORT", "0");
  });

  it("rejects a port above 65535", () => {
    expectInvalidPort("PORT", "65536");
  });

  it("rejects a fractional port", () => {
    expectInvalidPort("PORT", "4001.5");
  });

  it("names CONFIG_SERVICE_PORT when that value is invalid", () => {
    expectInvalidPort("CONFIG_SERVICE_PORT", "nope");
  });
});

/**
 * Asserts the database URL is returned as stored.
 *
 * Purpose: the pool receives the environment text, including surrounding spaces.
 * Inputs: none.
 * Side effects: sets DATABASE_URL until the suite restores it.
 */
function expectDatabaseUrlIsReturned(): void {
  const url = " postgres://reactiv:reactiv@127.0.0.1:5432/reactiv ";
  applyEnv({ DATABASE_URL: url });
  // Spaces stay. Trimming them would change a password that uses them.
  expect(readDatabaseUrl()).toBe(url);
}

/**
 * Asserts a missing database URL fails closed.
 *
 * Purpose: a direct caller gets the same missing-variable error as startup, without a sample URL.
 * Inputs: raw, the unset or blank value.
 * Side effects: sets DATABASE_URL until the suite restores it.
 */
function expectMissingDatabaseUrl(raw: string | undefined): void {
  applyEnv({ DATABASE_URL: raw });
  // The message names the variable. It does not invent a connection string.
  expect(() => {
    readDatabaseUrl();
  }).toThrowError(/^Missing required environment variable: DATABASE_URL$/);
}

describe("database URL", () => {
  it("returns the configured URL without trimming it", expectDatabaseUrlIsReturned);

  it("rejects a missing database URL", () => {
    expectMissingDatabaseUrl(undefined);
  });

  it("rejects a blank database URL", () => {
    expectMissingDatabaseUrl("   ");
  });
});
