import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  BENCHMARK_CONFIGURATION_ID,
  BENCHMARK_EDITOR_PORT,
  BENCHMARK_FIXTURE_PORT,
  BENCHMARK_SERVICE_TOKEN,
  BENCHMARK_TENANT_ID,
  previewBenchmarkConfiguration,
} from "./preview-benchmark-fixture.mjs";

/** Directory of this module. The repository root is its parent. */
const SERVE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Repository root. pnpm filters run from here. */
const REPO_ROOT = path.resolve(SERVE_DIR, "..");

/** Editor package. react-router-serve reads the build relative to this directory. */
const EDITOR_CWD = path.join(REPO_ROOT, "apps/editor");

/** Production server entry the editor package's start script serves. */
const SERVER_BUILD = path.join(EDITOR_CWD, "build/server/index.js");

/** react-router-serve binary. Spawning it with node avoids a shell. */
const SERVE_BIN = path.join(EDITOR_CWD, "node_modules/@react-router/serve/bin.js");

/** Child processes started for the production editor. */
const children = [];

/** Set when this process is already stopping, so an editor exit is not reported twice. */
let shuttingDown = false;

/**
 * Runs one pnpm command and waits for it.
 *
 * Purpose: build the contracts package and the production editor before the browser starts.
 * Inputs: args, the pnpm arguments after the executable name.
 * Side effects: writes the child output to this process. Throws when the command fails.
 */
function runPnpm(args) {
  // Production mode keeps the editor build on the production Vite mode even if the parent environment says otherwise.
  const result = spawnSync("pnpm", args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} exited ${result.status ?? "unknown"}.`);
  }
}

/**
 * Sends one JSON response.
 *
 * Purpose: the editor's configuration client accepts a configuration body and an ETag header.
 * Inputs: response, the server response. status, the HTTP status. body, the JSON value. extraHeaders, optional headers.
 * Side effects: writes the response.
 */
function sendJson(response, status, body, extraHeaders = {}) {
  // The client parses JSON. The fixture token is not added to the body.
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "content-length": Buffer.byteLength(payload),
    ...extraHeaders,
  });
  response.end(payload);
}

/**
 * Checks the fixture against the shared configuration schema and the byte cap.
 *
 * Purpose: the document the editor loads has to be legal before any timing starts.
 * Inputs: contracts, the built contracts module. configuration, the fixture body.
 * Side effects: none. Throws when the schema or the 256 KiB cap rejects the fixture.
 */
function assertFixtureIsLegal(contracts, configuration) {
  const payload = JSON.stringify(configuration);
  const bytes = Buffer.byteLength(payload);
  // The shared cap is inclusive. This check uses the contracts helper, not a second number.
  if (!contracts.isPayloadWithinLimit(payload)) {
    throw new Error(`Benchmark fixture is ${bytes} bytes, over the payload cap.`);
  }
  const parsed = contracts.configurationSchema.safeParse(configuration);
  if (!parsed.success) {
    throw new Error(parsed.error.message);
  }
  // The listening log names the size so the benchmark note can cite the payload that was served.
  console.log(`Benchmark fixture ${bytes} bytes, within ${contracts.LIMITS.maxPayloadBytes}.`);
}

/**
 * Loads the contracts build and checks the fixture.
 *
 * Purpose: schema validation runs after tsc, using the same package the editor imports.
 * Inputs: configuration, the fixture body.
 * Side effects: imports packages/contracts/dist. Throws when the fixture is illegal.
 */
async function assertBuiltFixture(configuration) {
  const contractsPath = path.join(REPO_ROOT, "packages/contracts/dist/index.js");
  // A missing dist means the contracts build did not emit. Do not serve an unchecked document.
  if (!existsSync(contractsPath)) {
    throw new Error("Contracts build did not write packages/contracts/dist/index.js.");
  }
  const contracts = await import(pathToFileURL(contractsPath).href);
  assertFixtureIsLegal(contracts, configuration);
}

/**
 * Stops every child process tree.
 *
 * Purpose: Playwright killing this launcher must not leave the production editor running.
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
 * Stops the children when the launcher is interrupted.
 *
 * Purpose: Playwright sends a signal when the test ends.
 * Inputs: none.
 * Side effects: kills the editor process tree and exits this process.
 */
function stopOnSignal() {
  // taskkill ends the production editor with this launcher.
  stopChildren();
  process.exit(0);
}

/**
 * Watches the production editor.
 *
 * Purpose: keep its output in the Playwright log and stop this launcher if the editor exits early.
 * Inputs: child, the spawned editor.
 * Side effects: registers stream and exit handlers.
 */
function watchEditor(child) {
  /**
   * Copies one child chunk to this process.
   *
   * Purpose: build and listen messages stay visible in the Playwright server log.
   * Inputs: chunk, one stdout or stderr buffer.
   * Side effects: writes to stdout.
   */
  function forwardOutput(chunk) {
    process.stdout.write(chunk);
  }

  /**
   * Stops the launcher when the editor exits on its own.
   *
   * Purpose: a crashed production server must fail the Playwright web server.
   * Inputs: code, the exit code, or null when the process was killed.
   * Side effects: may exit this process.
   */
  function stopIfEditorExited(code) {
    // A shutdown we started is not a second failure.
    if (shuttingDown) {
      return;
    }
    console.error(`production editor exited (${code ?? "unknown"}).`);
    process.exit(code === null ? 1 : code);
  }

  child.stdout?.on("data", forwardOutput);
  child.stderr?.on("data", forwardOutput);
  child.on("exit", stopIfEditorExited);
}

/**
 * Serves GET /v1/configurations/:id for the benchmark editor.
 *
 * Purpose: the loader can hydrate the 30-section document without Postgres.
 * Inputs: configuration, the checked fixture body.
 * Side effects: listens on loopback until the process exits. Resolves when the port is open.
 */
function startFixtureServer(configuration) {
  const expectedPath = `/v1/configurations/${encodeURIComponent(BENCHMARK_CONFIGURATION_ID)}`;

  /**
   * Answers one configuration request.
   *
   * Purpose: return the fixture document for the one id this stub owns.
   * Inputs: request, the incoming call. response, the server response.
   * Side effects: writes a status and a body.
   */
  function handleRequest(request, response) {
    const authorization = request.headers.authorization;
    if (authorization !== `Bearer ${BENCHMARK_SERVICE_TOKEN}`) {
      // The editor treats 401 as a setup failure. This stub does not describe the token.
      sendJson(response, 401, {
        error: { code: "UNAUTHORIZED", message: "Unauthorized.", requestId: "req_preview_benchmark" },
      });
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === expectedPath) {
      // The strong tag is what a later save would send. This benchmark does not save.
      sendJson(response, 200, configuration, { etag: '"1"' });
      return;
    }
    sendJson(response, 404, {
      error: { code: "NOT_FOUND", message: "Configuration not found.", requestId: "req_preview_benchmark" },
    });
  }

  const server = createServer(handleRequest);
  return new Promise((resolve, reject) => {
    /**
     * Fails startup when the fixture port cannot be opened.
     *
     * Purpose: a taken port must not leave the editor calling a closed stub.
     * Inputs: error, the listen failure.
     * Side effects: rejects the startup promise.
     */
    function rejectListen(error) {
      reject(error);
    }

    server.once("error", rejectListen);
    // Loopback only. Playwright reaches the editor, and the editor reaches this port.
    server.listen(BENCHMARK_FIXTURE_PORT, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolve();
    });
  });
}

/**
 * Starts the production editor.
 *
 * Purpose: react-router-serve runs the built server, not the Vite dev server.
 * Inputs: none. The port, host, and fixture address are fixed for this benchmark.
 * Side effects: spawns the editor and registers it for shutdown.
 */
function startProductionEditor() {
  // The serve binary resolves this path from the editor package directory.
  if (!existsSync(SERVER_BUILD)) {
    throw new Error("react-router build did not write apps/editor/build/server/index.js.");
  }
  if (!existsSync(SERVE_BIN)) {
    throw new Error("react-router-serve is not installed at apps/editor/node_modules/@react-router/serve/bin.js.");
  }
  const editor = spawn(process.execPath, [SERVE_BIN, "./build/server/index.js"], {
    cwd: EDITOR_CWD,
    env: {
      ...process.env,
      PORT: String(BENCHMARK_EDITOR_PORT),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      CONFIG_SERVICE_URL: `http://127.0.0.1:${BENCHMARK_FIXTURE_PORT}`,
      CONFIG_SERVICE_TOKEN: BENCHMARK_SERVICE_TOKEN,
      DEMO_TENANT_ID: BENCHMARK_TENANT_ID,
      DEMO_CONFIGURATION_ID: BENCHMARK_CONFIGURATION_ID,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(editor);
  watchEditor(editor);
}

/**
 * Prints a startup failure and exits.
 *
 * Purpose: a build or bind error must not leave the editor running.
 * Inputs: error, the rejection from main.
 * Side effects: writes stderr, kills the editor, and exits 1.
 */
function reportStartupFailure(error) {
  const message = error instanceof Error ? error.message : "Preview benchmark server failed to start";
  console.error(message);
  stopChildren();
  process.exit(1);
}

/**
 * Builds the production editor, checks the fixture, and stays up.
 *
 * Purpose: the Playwright webServer command for the preview benchmark.
 * Inputs: none.
 * Side effects: runs two builds, listens on the fixture port, and spawns the production editor.
 */
async function main() {
  process.on("SIGINT", stopOnSignal);
  process.on("SIGTERM", stopOnSignal);
  // The editor imports the built contracts package. Build that before the schema check and the editor build.
  runPnpm(["--filter", "@reactiv/contracts", "build"]);
  const configuration = previewBenchmarkConfiguration();
  await assertBuiltFixture(configuration);
  // react-router build writes apps/editor/build. The serve step below uses that output.
  console.log("Building the editor with react-router build for production.");
  runPnpm(["--filter", "@reactiv/editor", "build"]);
  // The fixture listens before the editor can call it.
  await startFixtureServer(configuration);
  startProductionEditor();
}

main().catch(reportStartupFailure);
