import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const serviceDir = fileURLToPath(new URL("../..", import.meta.url));
const exampleDatabaseUrl = "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv";

/**
 * Copies the process variables Node needs on Windows.
 *
 * Purpose: start the migrator without inheriting a parent DATABASE_URL.
 * Inputs: overrides, variables to set. An undefined value leaves the key unset.
 * Side effects: none.
 */
function childEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Keep the operating-system paths required to spawn Node. Do not copy service URLs.
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "TEMP", "TMP", "USERPROFILE"]) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Runs the migration command and collects its output.
 *
 * Purpose: observe the exit code and text of `pnpm db:migrate` without a shell wrapper.
 * Inputs: overrides, the child environment on top of the Windows path variables.
 * Side effects: spawns a process and kills it if it is still running after 15 seconds.
 */
function runMigrate(overrides: Record<string, string | undefined>): Promise<{ code: number | null; output: string }> {
  return new Promise(finishRun);

  /**
   * Starts the child and resolves when it exits.
   *
   * Purpose: collect stdout and stderr for one assertion.
   * Inputs: resolve, the promise resolver.
   * Side effects: spawns the migrator.
   */
  function finishRun(resolve: (result: { code: number | null; output: string }) => void): void {
    let collected = "";
    const child = spawn(process.execPath, ["--import", "tsx", "src/db/migrate-cli.ts"], {
      cwd: serviceDir,
      env: childEnv(overrides),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // Startup and SQL errors go to stderr. The report goes to stdout.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", appendChunk);
    child.stderr?.on("data", appendChunk);
    const timer = setTimeout(() => {
      child.kill();
    }, 15000);
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve({ code: exitCode, output: collected });
    });

    /**
     * Appends one chunk of command output.
     *
     * Purpose: keep both streams in one string.
     * Inputs: chunk, the encoded text from the child.
     * Side effects: appends to the closed-over output.
     */
    function appendChunk(chunk: string): void {
      collected += chunk;
    }
  }
}

/**
 * Asserts an unset DATABASE_URL is filled from .env and the report hides the URL.
 *
 * Purpose: the command migrates the dev database and does not print the connection string.
 * Inputs: none.
 * Side effects: runs the migrator against the database named in .env.
 */
async function expectUnsetUrlUsesTheEnvFile(): Promise<void> {
  const result = await runMigrate({});
  expect(result.code).toBe(0);
  expect(result.output).toContain("No pending migrations.");
  expect(result.output.includes("postgres://")).toBe(false);
}

/**
 * Asserts a blank shell DATABASE_URL is missing and is not replaced by .env.
 *
 * Purpose: a shell value wins, and a blank URL is still a failure.
 * Inputs: none.
 * Side effects: runs the migrator, which exits before connecting.
 */
async function expectBlankUrlIsMissing(): Promise<void> {
  const result = await runMigrate({ DATABASE_URL: "   " });
  expect(result.code).toBe(1);
  expect(result.output).toContain("Missing required environment variable: DATABASE_URL");
  expect(result.output.includes("postgres://")).toBe(false);
  expect(result.output.includes("127.0.0.1")).toBe(false);
}

/**
 * Asserts a connection failure does not print the password from the URL.
 *
 * Purpose: the command reports the driver error without echoing DATABASE_URL.
 * Inputs: none.
 * Side effects: attempts a connection to a closed port.
 */
async function expectConnectionFailureHidesThePassword(): Promise<void> {
  const result = await runMigrate({
    DATABASE_URL: "postgres://reactiv:super-secret-password@127.0.0.1:1/reactiv",
  });
  expect(result.code).toBe(1);
  expect(result.output.includes("super-secret-password")).toBe(false);
  expect(result.output.includes(exampleDatabaseUrl)).toBe(false);
}

/**
 * Registers the migration command suite.
 *
 * Purpose: cover the env-file handoff and the failure text.
 * Inputs: none.
 * Side effects: registers the tests.
 */
function registerMigrateCliTests(): void {
  it("uses .env when DATABASE_URL is unset and does not print the URL", expectUnsetUrlUsesTheEnvFile, 20_000);
  it("names a blank DATABASE_URL and does not read a replacement from .env", expectBlankUrlIsMissing);
  it("does not print the database password when the connection fails", expectConnectionFailureHidesThePassword, 20_000);
}

describe("db:migrate command", registerMigrateCliTests);
