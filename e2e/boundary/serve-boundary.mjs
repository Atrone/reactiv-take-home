import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactCredential } from "./credential-scan.mjs";
import { startObserver } from "./config-double.mjs";
import {
  BOUNDARY_DATABASE,
  BOUNDARY_TOKEN,
  COMPOSE_DATABASE_URL,
  CONFIGURATION_ID,
  EDITOR_PORT,
  OBSERVER_ORIGIN,
  OBSERVER_PORT,
  PROCESS_LOG,
  REPO_ROOT,
  SERVICE_ORIGIN,
  SERVICE_PORT,
  TENANT_ID,
} from "./boundary-env.mjs";

/** Resolves pg from the configuration service, which is the package that depends on it. */
const requireFromService = createRequire(new URL("../../apps/config-service/package.json", import.meta.url));
const { Client } = requireFromService("pg");

/** tsx binary used to run the configuration service and its database commands. */
const TSX_CLI = path.join(REPO_ROOT, "apps/config-service/node_modules/tsx/dist/cli.mjs");

/** Directory whose src/ tree the service commands run in. */
const SERVICE_CWD = path.join(REPO_ROOT, "apps/config-service");

/** React Router CLI. `dev` is the editor the browser talks to. */
const ROUTER_BIN = path.join(REPO_ROOT, "apps/editor/node_modules/@react-router/dev/bin.js");

/** Editor package. Vite reads EDITOR_PORT from the environment of this process. */
const EDITOR_CWD = path.join(REPO_ROOT, "apps/editor");

/** Child processes started for the service and the editor. */
const children = [];

/** Set when this process is already stopping, so an editor exit is not reported twice. */
let shuttingDown = false;

/**
 * Hides the credential and database URLs in text that may be printed.
 *
 * Purpose: setup failures stay readable without copying a secret into the Playwright log.
 * Inputs: text, the child output.
 * Side effects: none.
 */
function redactSecrets(text) {
  // The boundary credential is replaced first. An empty replacement would erase the string.
  const withoutToken = redactCredential(text, BOUNDARY_TOKEN);
  // A connection string can contain a password. The host is not needed in the failure text.
  return withoutToken.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[redacted]");
}

/**
 * Appends raw child output and prints a redacted copy.
 *
 * Purpose: the test can search the raw log, and the console does not repeat the credential.
 * Inputs: chunk, one stdout or stderr buffer.
 * Side effects: appends the raw bytes to the process log and writes redacted text to this process.
 */
function recordOutput(chunk) {
  // The raw bytes are the evidence. Redaction happens only on the stream Playwright displays.
  appendFileSync(PROCESS_LOG, chunk);
  process.stdout.write(redactSecrets(chunk.toString("utf8")));
}

/**
 * Watches one long-running child.
 *
 * Purpose: keep its output in the log and stop this launcher if that child exits early.
 * Inputs: child, the spawned process. label, a name that does not include a secret.
 * Side effects: registers stream and exit handlers.
 */
function watchChild(child, label) {
  // Missing pipes happen only when stdio was inherited. These children use pipes.
  /**
   * Stops the launcher when this child exits on its own.
   *
   * Purpose: a crashed editor or service must fail the Playwright server.
   * Inputs: code, the exit code, or null when the process was killed.
   * Side effects: may exit this process.
   */
  function stopIfChildExited(code) {
    // A shutdown we started is not a second failure.
    if (shuttingDown) {
      return;
    }
    console.error(`${label} exited (${code ?? "unknown"}).`);
    process.exit(code === null ? 1 : code);
  }

  child.stdout?.on("data", recordOutput);
  child.stderr?.on("data", recordOutput);
  child.on("exit", stopIfChildExited);
}

/**
 * Stops every child process tree.
 *
 * Purpose: Playwright killing this launcher must not leave the editor or the service running.
 * Inputs: none.
 * Side effects: taskkill on each child pid.
 */
function stopChildren() {
  shuttingDown = true;
  for (const child of children) {
    // A child that never received a pid is already gone.
    if (child.pid === undefined) {
      continue;
    }
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { shell: true, stdio: "ignore" });
  }
}

/**
 * Reads one assignment from an env file.
 *
 * Purpose: find DATABASE_URL without printing the file.
 * Inputs: filePath, the env file. key, the variable name.
 * Side effects: reads the file when it exists.
 */
function readEnvAssignment(filePath, key) {
  // A missing file is not a database URL.
  if (!existsSync(filePath)) {
    return undefined;
  }
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    // Comments and blank lines are not assignments.
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const name = trimmed.slice(0, separator).trim();
    if (name !== key) {
      continue;
    }
    const value = trimmed.slice(separator + 1).trim();
    // A blank assignment is missing. Do not fall through to a later duplicate.
    if (value === "") {
      return undefined;
    }
    return value;
  }
  return undefined;
}

/**
 * Rewrites a Postgres URL onto another database on the same server.
 *
 * Purpose: create and migrate reactiv_boundary without changing the maintenance database.
 * Inputs: connectionString, a reachable URL. database, the database name to open.
 * Side effects: none.
 */
function databaseUrlFor(connectionString, database) {
  // Keep the user, password, host, and port. Change only the database name.
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Reports whether Postgres accepts a connection.
 *
 * Purpose: choose the real service only when a server is actually reachable.
 * Inputs: connectionString, the URL to try.
 * Side effects: opens and closes one connection. Does not print the URL.
 */
async function postgresReachable(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 2000 });
  try {
    // A refused port or a bad password throws. Either one means this URL is not usable.
    await client.connect();
    await client.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    // end() can throw when connect never succeeded. That is still "not reachable".
    await client.end().catch(() => undefined);
  }
}

/**
 * Finds a Postgres URL this machine will accept.
 *
 * Purpose: prefer the shell, then .env, then the Compose URL, and skip any that do not connect.
 * Inputs: none.
 * Side effects: may open short connections. Does not print a URL.
 */
async function findMaintenanceUrl() {
  const candidates = [];
  const fromShell = process.env.DATABASE_URL;
  // A shell value wins when it connects. A blank shell value is not a candidate.
  if (fromShell !== undefined && fromShell.trim() !== "") {
    candidates.push(fromShell.trim());
  }
  const fromFile = readEnvAssignment(path.join(REPO_ROOT, ".env"), "DATABASE_URL");
  if (fromFile !== undefined && !candidates.includes(fromFile)) {
    candidates.push(fromFile);
  }
  // Compose publishes this URL. It is the last try, not a replacement for a reachable shell URL.
  if (!candidates.includes(COMPOSE_DATABASE_URL)) {
    candidates.push(COMPOSE_DATABASE_URL);
  }
  for (const candidate of candidates) {
    // The first URL that accepts select 1 is the maintenance database.
    if (await postgresReachable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Creates the boundary database when it is missing.
 *
 * Purpose: migrate and seed a database that is not the dev database.
 * Inputs: maintenanceUrl, a connection to an existing database on the same server.
 * Side effects: may run CREATE DATABASE.
 */
async function ensureBoundaryDatabase(maintenanceUrl) {
  // The name is a fixed identifier. Refuse anything else before it is interpolated.
  if (!/^[a-z_]+$/.test(BOUNDARY_DATABASE)) {
    throw new Error("The boundary database name is not a safe identifier.");
  }
  const client = new Client({ connectionString: maintenanceUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    const existing = await client.query("select 1 from pg_database where datname = $1", [BOUNDARY_DATABASE]);
    // An existing boundary database is reused. Its demo row is deleted before seed.
    if (existing.rowCount !== 0) {
      return;
    }
    await client.query(`create database ${BOUNDARY_DATABASE}`);
  } finally {
    await client.end();
  }
}

/**
 * Deletes the demo row so seed inserts the known document.
 *
 * Purpose: a previous Save must not rename the text section this browser session selects.
 * Inputs: databaseUrl, the boundary database.
 * Side effects: deletes at most one row.
 */
async function resetDemoRow(databaseUrl) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 });
  await client.connect();
  try {
    // Seed inserts the row again. Other tenants and ids stay.
    await client.query("delete from configurations where tenant_id = $1 and id = $2", [TENANT_ID, CONFIGURATION_ID]);
  } finally {
    await client.end();
  }
}

/**
 * Builds the environment for the real configuration service and its database commands.
 *
 * Purpose: force the distinctive credential and the boundary database over any inherited values.
 * Inputs: databaseUrl, the boundary database URL.
 * Side effects: none.
 */
function serviceEnv(databaseUrl) {
  // Spread first so PATH remains. The assignments below replace inherited secrets and ports.
  return {
    ...process.env,
    CONFIG_SERVICE_TOKEN: BOUNDARY_TOKEN,
    DATABASE_URL: databaseUrl,
    DEMO_TENANT_ID: TENANT_ID,
    DEMO_CONFIGURATION_ID: CONFIGURATION_ID,
    HOST: "127.0.0.1",
    PORT: String(SERVICE_PORT),
    CONFIG_SERVICE_HOST: "127.0.0.1",
    CONFIG_SERVICE_PORT: String(SERVICE_PORT),
  };
}

/**
 * Builds the environment for the editor dev server.
 *
 * Purpose: point the server client at the observer and give it the same distinctive credential.
 * Inputs: none.
 * Side effects: none.
 */
function editorEnv() {
  // The editor does not receive DATABASE_URL from this function. Inherited values are not printed.
  return {
    ...process.env,
    EDITOR_PORT: String(EDITOR_PORT),
    CONFIG_SERVICE_URL: OBSERVER_ORIGIN,
    CONFIG_SERVICE_TOKEN: BOUNDARY_TOKEN,
    DEMO_TENANT_ID: TENANT_ID,
    DEMO_CONFIGURATION_ID: CONFIGURATION_ID,
  };
}

/**
 * Runs one Node command and waits for it to exit.
 *
 * Purpose: migrate and seed must finish before the service listens.
 * Inputs: args, arguments after the Node binary. cwd, the working directory. env, the child environment. label, the failure name.
 * Side effects: writes child output to the process log. Throws when the status is not 0.
 */
function runNode(args, cwd, env, label) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
  });
  // Raw output stays in the log. The thrown message is redacted.
  appendFileSync(PROCESS_LOG, result.stdout ?? "");
  appendFileSync(PROCESS_LOG, result.stderr ?? "");
  if (result.status !== 0) {
    const visible = redactSecrets(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    throw new Error(`${label} failed.\n${visible}`);
  }
}

/**
 * Waits a short interval before the next health poll.
 *
 * Purpose: a closed port is not hammered for the whole deadline.
 * Inputs: none.
 * Side effects: resolves after 200 milliseconds.
 */
function pauseBeforeRetry() {
  // The resolver is the promise callback. The delay is the whole body.
  return new Promise(resolveAfterPause);
}

/**
 * Resolves a pause after 200 milliseconds.
 *
 * Purpose: the health loop continues without a busy spin.
 * Inputs: resolve, the promise resolver.
 * Side effects: schedules that resolve.
 */
function resolveAfterPause(resolve) {
  // 200 milliseconds is short compared with the 30 second deadline.
  setTimeout(resolve, 200);
}

/**
 * Polls an HTTP URL until it returns a success status.
 *
 * Purpose: the editor must not start until the configuration service is listening.
 * Inputs: url, the health URL. timeoutMs, how long to wait.
 * Side effects: sends GET requests. Throws when the deadline passes.
 */
async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      // Any 2xx means the process is accepting connections.
      if (response.ok) {
        return;
      }
    } catch {
      // The port is still closed. The next loop waits.
    }
    await pauseBeforeRetry();
  }
  throw new Error(`Timed out waiting for ${url}`);
}

/**
 * Starts the real configuration service and the spy in front of it.
 *
 * Purpose: browser traffic still ends at the editor, and the spy records the server client's Authorization header.
 * Inputs: maintenanceUrl, a reachable Postgres URL.
 * Side effects: creates a database, migrates, seeds, and listens. Throws when setup fails.
 */
async function startRealUpstream(maintenanceUrl) {
  // The boundary database is not the dev database named in the maintenance URL.
  await ensureBoundaryDatabase(maintenanceUrl);
  const databaseUrl = databaseUrlFor(maintenanceUrl, BOUNDARY_DATABASE);
  const env = serviceEnv(databaseUrl);
  // Tables first. The delete runs only after the configurations table exists.
  runNode([TSX_CLI, "src/db/migrate-cli.ts"], SERVICE_CWD, env, "migrate");
  await resetDemoRow(databaseUrl);
  runNode([TSX_CLI, "src/db/seed-cli.ts"], SERVICE_CWD, env, "seed");
  const service = spawn(process.execPath, [TSX_CLI, "src/index.ts"], {
    cwd: SERVICE_CWD,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(service);
  watchChild(service, "config-service");
  // Health does not query Postgres. The seed already did.
  await waitForHttp(`${SERVICE_ORIGIN}/health`, 30_000);
  // The editor calls the spy. The spy forwards to the service that just became healthy.
  await startObserver({
    mode: "postgres",
    listenPort: OBSERVER_PORT,
    upstreamPort: SERVICE_PORT,
    token: BOUNDARY_TOKEN,
    configurationId: CONFIGURATION_ID,
  });
  // The mode line is not a credential. The test reads it from the same log as the child output.
  appendFileSync(PROCESS_LOG, "boundary-mode=postgres\n");
  console.log("boundary-mode=postgres");
}

/**
 * Starts the stub observer.
 *
 * Purpose: the editor's real server client still sends GET and PUT when Postgres is down.
 * Inputs: none.
 * Side effects: listens on the observer port.
 */
async function startStub() {
  await startObserver({
    mode: "stub",
    listenPort: OBSERVER_PORT,
    token: BOUNDARY_TOKEN,
    configurationId: CONFIGURATION_ID,
  });
  // The mode line is not a credential. The test reads it from the same log as the child output.
  appendFileSync(PROCESS_LOG, "boundary-mode=stub\n");
  console.log("boundary-mode=stub");
}

/**
 * Starts the editor dev server.
 *
 * Purpose: Playwright waits on the editor origin, which is not the configuration service.
 * Inputs: none.
 * Side effects: spawns the React Router dev process.
 */
function startEditor() {
  const editor = spawn(process.execPath, [ROUTER_BIN, "dev"], {
    cwd: EDITOR_CWD,
    env: editorEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(editor);
  watchChild(editor, "editor");
}

/**
 * Stops the children when the launcher is interrupted.
 *
 * Purpose: Playwright sends a signal when the test ends.
 * Inputs: none.
 * Side effects: kills child process trees and exits this process.
 */
function stopOnSignal() {
  // taskkill ends the editor and the configuration service with this launcher.
  stopChildren();
  process.exit(0);
}

/**
 * Prints a redacted startup failure and exits.
 *
 * Purpose: a migrate or bind error must not leave the children running.
 * Inputs: error, the rejection from main.
 * Side effects: writes stderr, kills children, and exits 1.
 */
function reportStartupFailure(error) {
  // The message was already redacted by runNode, or it is a generic timeout. Do not read the token here.
  const message = error instanceof Error ? error.message : "Boundary servers failed to start";
  console.error(redactSecrets(message));
  stopChildren();
  process.exit(1);
}

/**
 * Boots the boundary session and stays up until the editor stops.
 *
 * Purpose: the Playwright webServer command. Postgres selects the real service. Otherwise the stub records the calls.
 * Inputs: none.
 * Side effects: may migrate a database, then listens until this process is killed.
 */
async function main() {
  // The log starts empty so a previous session cannot satisfy this one.
  mkdirSync(path.dirname(PROCESS_LOG), { recursive: true });
  writeFileSync(PROCESS_LOG, "");
  process.on("SIGINT", stopOnSignal);
  process.on("SIGTERM", stopOnSignal);
  const maintenanceUrl = await findMaintenanceUrl();
  // A reachable server uses the real service. A closed port uses the stub.
  if (maintenanceUrl === undefined) {
    await startStub();
  } else {
    await startRealUpstream(maintenanceUrl);
  }
  // The observer is listening before the editor can call it.
  startEditor();
}

main().catch(reportStartupFailure);
