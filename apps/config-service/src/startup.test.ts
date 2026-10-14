import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readDotEnv } from "./db/env-file.js";
import { envFilePath, repositoryRoot } from "./db/paths.js";

const serviceDir = fileURLToPath(new URL("..", import.meta.url));
const secretToken = "secret-token-value";
const demoTenant = "tenant_demo";

/**
 * Copies the process variables Node needs on Windows.
 *
 * Purpose: start a child without inheriting service credentials from this shell.
 * Inputs: overrides, service variables to set. An undefined value leaves the key unset.
 * Side effects: none.
 */
function childEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Keep the operating-system paths required to spawn Node. Do not copy the token.
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
 * Reserves a free loopback port.
 *
 * Purpose: give a startup test a port that is not already taken.
 * Inputs: none.
 * Side effects: briefly listens, then closes that socket.
 */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      // An unexpected address means the reservation failed.
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not reserve a port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

/**
 * Stops a service process.
 *
 * Purpose: release the port after an assertion, including when the assertion fails.
 * Inputs: child, the service process.
 * Side effects: signals the process and waits for it to exit.
 */
function stopChild(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    // A process that already left does not need another signal.
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      child.kill();
    }, 2000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

/**
 * Starts the configuration service entrypoint.
 *
 * Purpose: run the real boot path with an isolated environment.
 * Inputs: overrides, variables added to the child environment.
 * Side effects: spawns a process and collects its output.
 */
function startEntry(overrides: Record<string, string | undefined>): ChildProcess & { output: () => string } {
  let collected = "";
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: serviceDir,
    env: childEnv(overrides),
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Keep both streams. Startup errors go to stderr and Fastify logs go to stdout.
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    collected += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    collected += chunk;
  });
  return Object.assign(child, {
    /**
     * Returns the output collected so far.
     *
     * Purpose: let an assertion search startup text.
     * Inputs: none.
     * Side effects: none.
     */
    output(): string {
      return collected;
    },
  });
}

/**
 * Waits until the entry process exits.
 *
 * Purpose: observe a fail-closed boot.
 * Inputs: overrides, the child environment.
 * Side effects: spawns the service and kills it if it is still running after 10 seconds.
 */
async function runUntilExit(overrides: Record<string, string | undefined>): Promise<{ code: number | null; output: string }> {
  const child = startEntry(overrides);
  // A boot that ignores the check would listen forever, so stop it.
  const timer = setTimeout(() => {
    child.kill();
  }, 10000);
  const code = await new Promise<number | null>((resolve) => {
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  return { code, output: child.output() };
}

/**
 * Asserts that a missing token and database URL stop the process.
 *
 * Purpose: the entrypoint, not only the helper, refuses to listen.
 * Inputs: none.
 * Side effects: spawns the service.
 */
async function expectProcessNamesBothMissingVariables(): Promise<void> {
  const result = await runUntilExit({ HOST: "127.0.0.1", PORT: "0" });
  expect(result.code).toBe(1);
  expect(result.output).toContain("Missing required environment variable: CONFIG_SERVICE_TOKEN");
  expect(result.output).toContain("Missing required environment variable: DATABASE_URL");
  expect(result.output).toContain("Missing required environment variable: DEMO_TENANT_ID");
  expect(result.output).not.toContain("replace-me");
}

/**
 * Asserts that a present token is not written when the database URL is missing.
 *
 * Purpose: the entrypoint names DATABASE_URL and does not echo the token.
 * Inputs: none.
 * Side effects: spawns the service.
 */
async function expectProcessHidesTheToken(): Promise<void> {
  const result = await runUntilExit({
    HOST: "127.0.0.1",
    CONFIG_SERVICE_TOKEN: secretToken,
    DEMO_TENANT_ID: demoTenant,
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain("Missing required environment variable: DATABASE_URL");
  expect(result.output).not.toContain(secretToken);
}

/**
 * Asserts that an invalid port is rejected by the entrypoint.
 *
 * Purpose: the process uses the port parser before it listens.
 * Inputs: none.
 * Side effects: spawns the service.
 */
async function expectProcessRejectsAnInvalidPort(): Promise<void> {
  const result = await runUntilExit({
    CONFIG_SERVICE_TOKEN: secretToken,
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:1/reactiv",
    DEMO_TENANT_ID: demoTenant,
    PORT: "nope",
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain("Invalid environment variable: PORT");
  expect(result.output).not.toContain(secretToken);
}

/**
 * Waits briefly before the next health poll.
 *
 * Purpose: avoid a tight loop while the service is still starting.
 * Inputs: none.
 * Side effects: waits 100 milliseconds.
 */
function waitForListen(): Promise<void> {
  return new Promise((resolve) => {
    // The server needs a moment between failed connection attempts.
    setTimeout(resolve, 100);
  });
}

/**
 * Asserts health responds before any database connection.
 *
 * Purpose: a required database URL does not make GET /health open Postgres.
 * Inputs: none.
 * Side effects: spawns the service, requests health, then stops the process.
 */
async function expectHealthWithoutADatabase(): Promise<void> {
  const port = await reservePort();
  const child = startEntry({
    HOST: "127.0.0.1",
    PORT: String(port),
    CONFIG_SERVICE_TOKEN: secretToken,
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:1/reactiv",
    DEMO_TENANT_ID: demoTenant,
  });
  try {
    let body = "";
    let status = 0;
    const deadline = Date.now() + 15000;
    // Poll until the server is listening or the process gives up.
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`Service exited ${child.exitCode}: ${child.output()}`);
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          headers: { authorization: `Bearer ${secretToken}` },
        });
        status = response.status;
        body = await response.text();
        break;
      } catch {
        await waitForListen();
      }
    }
    expect(status).toBe(200);
    expect(body).toBe('{"status":"ok"}');
    expect(body).not.toContain(secretToken);
    expect(child.output()).not.toContain(secretToken);
  } finally {
    await stopChild(child);
  }
}

/**
 * Asserts that the example placeholder stops the process.
 *
 * Purpose: the entrypoint refuses to listen when the token is replace-me.
 * Inputs: none.
 * Side effects: spawns the service.
 */
async function expectProcessRejectsThePlaceholderToken(): Promise<void> {
  const result = await runUntilExit({
    HOST: "127.0.0.1",
    PORT: "0",
    CONFIG_SERVICE_TOKEN: "replace-me",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: demoTenant,
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain("Invalid environment variable: CONFIG_SERVICE_TOKEN");
  expect(result.output).not.toContain("replace-me");
  expect(result.output).not.toContain("postgres://");
}

/**
 * Asserts a blank demo tenant stops the process.
 *
 * Purpose: the entrypoint names DEMO_TENANT_ID when the token and database URL are present.
 * Inputs: none.
 * Side effects: spawns the service.
 */
async function expectProcessNamesABlankTenant(): Promise<void> {
  const result = await runUntilExit({
    HOST: "127.0.0.1",
    PORT: "0",
    CONFIG_SERVICE_TOKEN: secretToken,
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv",
    DEMO_TENANT_ID: "   ",
  });
  // The blank tenant is missing. The token and the database URL stay out of the message.
  expect(result.code).toBe(1);
  expect(result.output).toContain("Missing required environment variable: DEMO_TENANT_ID");
  expect(result.output).not.toContain(secretToken);
  expect(result.output).not.toContain("postgres://");
}

/**
 * Asserts that the example file, copied unchanged, does not boot.
 *
 * Purpose: replace-me is the token in .env.example, and the process refuses to listen.
 * Inputs: none. The child receives the example file's values.
 * Side effects: spawns the service. Does not write .env.
 */
async function expectExampleFileRefusesToBoot(): Promise<void> {
  // Read the committed template. An unchanged copy is these values.
  const example = readDotEnv(join(repositoryRoot(), ".env.example"));
  const token = example.get("CONFIG_SERVICE_TOKEN");
  // The template has no usable secret.
  expect(token).toBe("replace-me");
  const result = await runUntilExit({
    HOST: "127.0.0.1",
    PORT: "0",
    CONFIG_SERVICE_TOKEN: token,
    DATABASE_URL: example.get("DATABASE_URL"),
    DEMO_TENANT_ID: example.get("DEMO_TENANT_ID"),
    DEMO_CONFIGURATION_ID: example.get("DEMO_CONFIGURATION_ID"),
    CONFIG_SERVICE_URL: example.get("CONFIG_SERVICE_URL"),
  });
  // The placeholder stops the process before it listens or prints the database URL.
  expect(result.code).toBe(1);
  expect(result.output).toContain("Invalid environment variable: CONFIG_SERVICE_TOKEN");
  expect(result.output).not.toContain("replace-me");
  expect(result.output).not.toContain("postgres://");
}

/**
 * Asserts the process ignores .env when its own environment is empty.
 *
 * Purpose: a file on disk is not a fallback credential for the service.
 * Inputs: none. The child receives no service variables. .env stays on disk.
 * Side effects: spawns the service.
 */
async function expectProcessIgnoresTheEnvFile(): Promise<void> {
  const file = readDotEnv(envFilePath());
  const databaseUrl = file.get("DATABASE_URL") ?? "";
  const token = file.get("CONFIG_SERVICE_TOKEN") ?? "";
  const tenant = file.get("DEMO_TENANT_ID") ?? "";
  // The local file has the settings. The child does not receive them.
  expect(databaseUrl.trim().length).toBeGreaterThan(0);
  expect(token.trim().length).toBeGreaterThan(0);
  expect(tenant.trim().length).toBeGreaterThan(0);
  const result = await runUntilExit({
    HOST: "127.0.0.1",
    PORT: "0",
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain("Missing required environment variable: CONFIG_SERVICE_TOKEN");
  expect(result.output).toContain("Missing required environment variable: DATABASE_URL");
  expect(result.output).toContain("Missing required environment variable: DEMO_TENANT_ID");
  expect(result.output.includes(databaseUrl)).toBe(false);
  expect(result.output.includes(token)).toBe(false);
}

describe("configuration service entrypoint", () => {
  it("exits when the token and database URL are unset", expectProcessNamesBothMissingVariables, 15000);
  it("exits without printing the token when the database URL is unset", expectProcessHidesTheToken, 15000);
  it("exits when PORT is not a number", expectProcessRejectsAnInvalidPort, 15000);
  it("exits when the token is the example placeholder", expectProcessRejectsThePlaceholderToken, 15000);
  it("exits when the demo tenant is blank", expectProcessNamesABlankTenant, 15000);
  it("exits when started from the unchanged example file", expectExampleFileRefusesToBoot, 15000);
  it("ignores .env when the process environment is empty", expectProcessIgnoresTheEnvFile, 15000);
  it("serves health without connecting to Postgres", expectHealthWithoutADatabase, 20000);
});
