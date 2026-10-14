import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Fails until the harness scanner has been loaded.
 *
 * Purpose: give the tests a function to call before beforeAll replaces it.
 * Inputs: none. The text and token are ignored.
 * Side effects: throws.
 */
function scannerNotLoaded(): string[] {
  // A test that runs before beforeAll is a setup bug, not a clean bundle.
  throw new Error("The scanner was not loaded.");
}

/** Scans one client asset. Assigned from the harness module before the tests run. */
let scanClientAsset: (text: string, token: string) => string[] = scannerNotLoaded;

/**
 * Fails until the redaction helper has been loaded.
 *
 * Purpose: give the build helper a function to call before beforeAll replaces it.
 * Inputs: text, ignored. token, ignored.
 * Side effects: throws.
 */
function redactionNotLoaded(text: string): string {
  // The build log cannot be redacted until the harness module is loaded.
  void text;
  throw new Error("The scanner was not loaded.");
}

/** Hides the credential in text a failure may print. Assigned with the scanner. */
let redactCredential: (text: string, token: string) => string = redactionNotLoaded;

/**
 * Loads the harness scanner without a static import.
 *
 * Purpose: the scanner is plain JavaScript outside this package, and the editor typecheck does not compile it.
 * Inputs: none.
 * Side effects: assigns the two scanner functions.
 */
async function loadScanner(): Promise<void> {
  // A variable specifier stays out of the typecheck program. The runtime module is the harness file.
  const specifier = new URL("../../../../e2e/boundary/credential-scan.mjs", import.meta.url).href;
  const scanner = (await import(specifier)) as {
    scanClientAsset: (text: string, token: string) => string[];
    redactCredential: (text: string, token: string) => string;
  };
  scanClientAsset = scanner.scanClientAsset;
  redactCredential = scanner.redactCredential;
}

/** Extensions that are not searched as text. */
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf"]);

/**
 * Finds the editor package root from this test file.
 *
 * Purpose: run the client build in the package that owns the React Router config.
 * Inputs: none.
 * Side effects: none.
 */
function editorRoot(): string {
  // This file lives in app/services, so two directories up is the editor package.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

/**
 * Finds the repository root from this test file.
 *
 * Purpose: read the boundary token from the Playwright harness, which is not an editor module.
 * Inputs: none.
 * Side effects: none.
 */
function repositoryRoot(): string {
  // Four directories up from app/services is the repository root.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
}

/**
 * Reads the distinctive credential the client build must not contain.
 *
 * Purpose: one assignment in the harness is the value this test searches for.
 * Inputs: none.
 * Side effects: reads e2e/boundary/boundary-env.mjs.
 */
function readBoundaryToken(): string {
  const source = readFileSync(path.join(repositoryRoot(), "e2e/boundary/boundary-env.mjs"), "utf8");
  // The assignment is a single quoted string. A missing match means the harness moved.
  const match = source.match(/export const BOUNDARY_TOKEN = "([^"]+)";/);
  if (match === null || match[1] === undefined || match[1] === "") {
    throw new Error("The boundary token assignment was not found.");
  }
  return match[1];
}

/**
 * Reports whether a file name is a skipped binary.
 *
 * Purpose: avoid reading images and fonts as JavaScript.
 * Inputs: name, the file name.
 * Side effects: none.
 */
function isBinaryName(name: string): boolean {
  // The extension decides. Script and style files stay in the scan.
  return BINARY_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * Lists client build files.
 *
 * Purpose: scan the browser assets React Router emitted, not the server bundle.
 * Inputs: directory, the directory to read. files, the accumulator of absolute paths.
 * Side effects: reads the directory tree.
 */
function collectClientAssets(directory: string, files: string[]): void {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    // Vendor trees are not part of this app's emitted assets.
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") {
        continue;
      }
      collectClientAssets(fullPath, files);
      continue;
    }
    // Skip binaries. Every text asset, including a source map, can carry a string.
    if (!entry.isFile() || isBinaryName(entry.name)) {
      continue;
    }
    files.push(fullPath);
  }
}

/**
 * Builds the editor and returns the client asset directory.
 *
 * Purpose: `react-router build` is the command that emits the browser bundle for this pinned version.
 * Inputs: token, the credential placed in the build environment.
 * Side effects: writes apps/editor/build. Throws when the build fails.
 */
function buildClientAssets(token: string): string {
  const root = editorRoot();
  const routerBin = path.join(root, "node_modules/@react-router/dev/bin.js");
  // The child environment overrides any inherited credential so the search value is the one this build used.
  const result = spawnSync(process.execPath, [routerBin, "build"], {
    cwd: root,
    env: {
      ...process.env,
      CONFIG_SERVICE_TOKEN: token,
    },
    encoding: "utf8",
    timeout: 180_000,
  });
  if (result.status !== 0) {
    // Show the build log without copying the credential into the assertion output.
    const output = redactCredential(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, token);
    throw new Error(`react-router build failed.\n${output}`);
  }
  const clientDirectory = path.join(root, "build", "client");
  // A successful build still has to emit the browser directory. The server directory is not this check.
  if (!statSync(clientDirectory, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error("react-router build did not emit build/client.");
  }
  return clientDirectory;
}

/**
 * Lists client assets that contain the credential or read it from import.meta.env.
 *
 * Purpose: a passing scan must fail when either leak is introduced into an emitted file.
 * Inputs: clientDirectory, build/client. token, the credential used for that build.
 * Side effects: reads the emitted files.
 */
function clientAssetViolations(clientDirectory: string, token: string): string[] {
  const files: string[] = [];
  collectClientAssets(clientDirectory, files);
  const violations: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const reasons = scanClientAsset(text, token);
    // A clean file adds nothing. The reason codes do not include the credential.
    if (reasons.length === 0) {
      continue;
    }
    const relative = path.relative(clientDirectory, file).replaceAll("\\", "/");
    violations.push(`${relative}: ${reasons.join(",")}`);
  }
  return violations;
}

/**
 * Asserts a client asset that contains the credential fails the scan.
 *
 * Purpose: the scanner is not a check that ignores every file.
 * Inputs: none.
 * Side effects: reads the harness token.
 */
function expectTokenValueFails(): void {
  const token = readBoundaryToken();
  // The value is the leak. The variable name is not in this fixture.
  const reasons = scanClientAsset(`const leaked = "${token}";`, token);
  expect(reasons).toContain("token-value");
  expect(reasons).not.toContain("import-meta-env");
}

/**
 * Asserts a client read of the service token from import.meta.env fails the scan.
 *
 * Purpose: the bundle check catches the property access even when the value was not inlined.
 * Inputs: none.
 * Side effects: none.
 */
function expectImportMetaEnvReadFails(): void {
  const token = readBoundaryToken();
  const dotted = scanClientAsset("const leaked = import.meta.env.CONFIG_SERVICE_TOKEN;", token);
  const quoted = scanClientAsset('const leaked = import.meta.env["CONFIG_SERVICE_TOKEN"];', token);
  // Both shapes are the client read. A normal Vite mode flag is not.
  expect(dotted).toContain("import-meta-env");
  expect(quoted).toContain("import-meta-env");
  expect(scanClientAsset("const mode = import.meta.env.MODE;", token)).toEqual([]);
}

/**
 * Asserts the variable name in a client asset fails even without import.meta.env.
 *
 * Purpose: a leaked server lookup still names the credential variable.
 * Inputs: none.
 * Side effects: none.
 */
function expectEnvKeyFails(): void {
  const token = readBoundaryToken();
  const reasons = scanClientAsset('const name = "CONFIG_SERVICE_TOKEN";', token);
  // The key is present. This fixture does not read it from import.meta.env.
  expect(reasons).toContain("env-key");
  expect(reasons).not.toContain("import-meta-env");
  expect(reasons).not.toContain("token-value");
}

/**
 * Asserts the production client build does not contain the credential.
 *
 * Purpose: `react-router build` is the framework check that server modules stayed out of the browser bundle.
 * Inputs: none.
 * Side effects: runs the client build and reads build/client.
 */
function expectBuiltClientOmitsTheCredential(): void {
  const token = readBoundaryToken();
  const clientDirectory = buildClientAssets(token);
  const files: string[] = [];
  collectClientAssets(clientDirectory, files);
  // An empty client directory would hide a leak. The build must have emitted assets.
  expect(files.length).toBeGreaterThan(0);
  expect(clientAssetViolations(clientDirectory, token)).toEqual([]);
}

describe("client bundle credential boundary", () => {
  beforeAll(loadScanner);
  it("fails when a client asset contains the credential", expectTokenValueFails);
  it("fails when the client reads the service token from import.meta.env", expectImportMetaEnvReadFails);
  it("fails when a client asset names the service token variable", expectEnvKeyFails);
  it("omits the credential from the built client assets", expectBuiltClientOmitsTheCredential, 180_000);
});
