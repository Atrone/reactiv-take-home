import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** One editor source file and its text. */
type SourceFile = {
  relativePath: string;
  text: string;
};

const TOKEN_KEY = "CONFIG_SERVICE_TOKEN";
const URL_KEY = "CONFIG_SERVICE_URL";

/** Directories that are not editor source. */
const SKIP_DIRECTORIES = new Set(["node_modules", ".react-router", "build", "dist", "coverage"]);

/** Extensions that are not searched as text. */
const BINARY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".ttf"]);

/**
 * Matches an import of the private configuration client.
 *
 * A comment that only names the file does not match. A from-clause or a dynamic import does.
 */
const CLIENT_IMPORT =
  /(?:\bfrom|\bimport)\s*(?:\(\s*)?["'][^"']*configuration\.server(?:\.js)?["']/;

/**
 * Finds the editor package root from this test file.
 *
 * Purpose: search apps/editor without depending on the process working directory.
 * Inputs: none.
 * Side effects: none.
 */
function editorRoot(): string {
  // This file lives in app/services, so two directories up is the editor package.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

/**
 * Reports whether a file name is a skipped binary.
 *
 * Purpose: avoid reading images and fonts as source.
 * Inputs: name, the file name.
 * Side effects: none.
 */
function isBinaryName(name: string): boolean {
  // The extension decides. A source file keeps a text extension.
  return BINARY_EXTENSIONS.has(path.extname(name).toLowerCase());
}

/**
 * Walks the editor package and reads source files.
 *
 * Purpose: give the boundary checks the same tree a reviewer would search, minus vendor and build output.
 * Inputs: root, the editor package root. directory, the directory to read. files, the accumulator.
 * Side effects: reads files from disk.
 */
function collectSourceFiles(root: string, directory: string, files: SourceFile[]): void {
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    // Vendor, generated, and build trees are not the editor modules this check guards.
    if (SKIP_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(root, fullPath, files);
      continue;
    }
    // Skip binaries and anything that is not a regular file.
    if (!entry.isFile() || isBinaryName(entry.name)) {
      continue;
    }
    files.push({
      relativePath: path.relative(root, fullPath),
      text: readFileSync(fullPath, "utf8"),
    });
  }
}

/**
 * Lists editor source files.
 *
 * Purpose: start the walk at the package root.
 * Inputs: root, the editor package root.
 * Side effects: reads files from disk.
 */
function listSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  // The walk skips node_modules and generated output.
  collectSourceFiles(root, root, files);
  return files;
}

/**
 * Normalizes a relative path to forward slashes.
 *
 * Purpose: compare Windows paths with the allowlist.
 * Inputs: relativePath, the path from the editor root.
 * Side effects: none.
 */
function normalize(relativePath: string): string {
  // The allowlist is written with forward slashes.
  return relativePath.replaceAll("\\", "/");
}

/**
 * Reports whether a file may mention the private service credential variables.
 *
 * Purpose: allow the server client, a server-only env helper, and this guard test.
 * Inputs: relativePath, the path from the editor root.
 * Side effects: none.
 */
function mayReferenceServiceCredential(relativePath: string): boolean {
  const normalized = normalize(relativePath);
  // The client is the module that reads the token and the URL.
  if (normalized === "app/services/configuration.server.ts") {
    return true;
  }
  // These tests name the variables in order to search source and the built client assets.
  if (
    normalized.endsWith("credential-boundary.test.ts") ||
    normalized.endsWith("client-bundle-boundary.test.ts")
  ) {
    return true;
  }
  // A server-only env helper may name the variables. A client file may not.
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  return base.endsWith(".server.ts") && base.toLowerCase().includes("env");
}

/**
 * Lists files that mention the private URL or token and are not allowed to.
 *
 * Purpose: fail when any module other than the server client or a server-only env helper reads those names.
 * Inputs: files, the source files to scan.
 * Side effects: none.
 */
function credentialReferenceViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    // A file that names neither variable is not a credential reference.
    if (!file.text.includes(TOKEN_KEY) && !file.text.includes(URL_KEY)) {
      continue;
    }
    if (mayReferenceServiceCredential(file.relativePath)) {
      continue;
    }
    violations.push(normalize(file.relativePath));
  }
  return violations;
}

/**
 * Reports whether a file is a client module that must not import the private client.
 *
 * Purpose: route and component files are in the client graph. Server modules and tests are not this check.
 * Inputs: relativePath, the path from the editor root.
 * Side effects: none.
 */
function isClientComponentFile(relativePath: string): boolean {
  const normalized = normalize(relativePath);
  // Files outside app/ are package config, not client components.
  if (!normalized.startsWith("app/")) {
    return false;
  }
  // .server.ts and .server.tsx are allowed to import the client.
  if (normalized.includes(".server.")) {
    return false;
  }
  // Tests run in Vitest. They are not client components.
  if (normalized.endsWith(".test.ts") || normalized.endsWith(".test.tsx")) {
    return false;
  }
  // Source modules under app/ that are not server modules can be pulled into the browser.
  return normalized.endsWith(".ts") || normalized.endsWith(".tsx") || normalized.endsWith(".js") || normalized.endsWith(".jsx");
}

/**
 * Reports whether a route module may import the private client.
 *
 * Purpose: the editor route's loader and action call the server client. The framework removes those exports from the browser bundle.
 * Inputs: relativePath, the path from the editor root.
 * Side effects: none.
 */
function routeMayImportServerClient(relativePath: string): boolean {
  // Only the mounted editor route. A component file or another route is still a violation.
  return normalize(relativePath) === "app/routes/editor.tsx";
}

/**
 * Lists client files that import the private configuration client.
 *
 * Purpose: fail when a client component reaches the module that holds the credential.
 * Inputs: files, the source files to scan.
 * Side effects: none.
 */
function clientImportViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    // Server modules and tests are outside this check.
    if (!isClientComponentFile(file.relativePath)) {
      continue;
    }
    // The editor route is the server mediation layer. Its component does not call the client.
    if (routeMayImportServerClient(file.relativePath)) {
      continue;
    }
    if (CLIENT_IMPORT.test(file.text)) {
      violations.push(normalize(file.relativePath));
    }
  }
  return violations;
}

/**
 * Asserts the editor tree keeps the credential in the server client.
 *
 * Purpose: search the package the same way the prompt's verification search does.
 * Inputs: none.
 * Side effects: reads the editor source tree.
 */
function expectEditorTreeKeepsTheCredentialOnTheServer(): void {
  const files = listSourceFiles(editorRoot());
  // No extra file names the token or the URL, and no client file imports the server client.
  expect(credentialReferenceViolations(files)).toEqual([]);
  expect(clientImportViolations(files)).toEqual([]);
}

/**
 * Asserts a client file that names the token fails the check.
 *
 * Purpose: the allowlist is not a scan that ignores every file.
 * Inputs: none.
 * Side effects: none.
 */
function expectTokenInAClientFileFails(): void {
  const files: SourceFile[] = [
    {
      relativePath: "app/root.tsx",
      text: `const leaked = "${TOKEN_KEY}";\n`,
    },
  ];
  // The client file is the violation. The server client would not be.
  expect(credentialReferenceViolations(files)).toEqual(["app/root.tsx"]);
}

/**
 * Asserts the server client and a server-only env helper may name the token.
 *
 * Purpose: the check matches the modules that are allowed to read the credential.
 * Inputs: none.
 * Side effects: none.
 */
function expectServerModulesMayNameTheToken(): void {
  const files: SourceFile[] = [
    {
      relativePath: "app/services/configuration.server.ts",
      text: `process.env.${TOKEN_KEY}\nprocess.env.${URL_KEY}\n`,
    },
    {
      relativePath: "app/services/editor-env.server.ts",
      text: `process.env.${TOKEN_KEY}\n`,
    },
  ];
  // Both paths are on the allowlist.
  expect(credentialReferenceViolations(files)).toEqual([]);
}

/**
 * Asserts a client import of the server client fails the check.
 *
 * Purpose: a component file must not reach the module that opens the private socket.
 * Inputs: none.
 * Side effects: none.
 */
function expectClientImportFails(): void {
  const client: SourceFile = {
    relativePath: "app/routes/home.tsx",
    text: 'import { getConfiguration } from "../services/configuration.server.js";\n',
  };
  const server: SourceFile = {
    relativePath: "app/entry.server.tsx",
    text: 'import { assertEditorServerEnv } from "./services/configuration.server.js";\n',
  };
  // The route file fails. The server entry is allowed to import the client.
  expect(clientImportViolations([client, server])).toEqual(["app/routes/home.tsx"]);
}

/**
 * Asserts the mounted editor route may import the private client.
 *
 * Purpose: the loader and the action are the modules that call the server client.
 * Inputs: none.
 * Side effects: none.
 */
function expectEditorRouteMayImportTheServerClient(): void {
  const route: SourceFile = {
    relativePath: "app/routes/editor.tsx",
    text: 'import { getConfiguration } from "../services/configuration.server.js";\n',
  };
  // The editor route is the exception. A placeholder route is not.
  expect(clientImportViolations([route])).toEqual([]);
}

/**
 * Asserts the server entry calls the setup check.
 *
 * Purpose: a missing token fails in the server entry, not only inside a later loader.
 * Inputs: none.
 * Side effects: reads app/entry.server.tsx.
 */
function expectServerEntryChecksEnv(): void {
  const source = readFileSync(path.join(editorRoot(), "app/entry.server.tsx"), "utf8");
  // The entry calls the check. It does not read the token variable itself.
  expect(source).toContain("assertEditorServerEnv");
  expect(source).not.toContain(TOKEN_KEY);
}

/**
 * Asserts a client file that names the service URL fails the check.
 *
 * Purpose: the URL variable is guarded the same way as the token.
 * Inputs: none.
 * Side effects: none.
 */
function expectUrlInAClientFileFails(): void {
  const files: SourceFile[] = [
    {
      relativePath: "app/root.tsx",
      text: `const leaked = "${URL_KEY}";\n`,
    },
  ];
  // The client file is the violation.
  expect(credentialReferenceViolations(files)).toEqual(["app/root.tsx"]);
}

/**
 * Asserts a server module that is not an env helper cannot name the token.
 *
 * Purpose: the allowlist is the configuration client and env helpers, not every server file.
 * Inputs: none.
 * Side effects: none.
 */
function expectOtherServerModulesMayNotNameTheToken(): void {
  const files: SourceFile[] = [
    {
      relativePath: "app/services/session.server.ts",
      text: `process.env.${TOKEN_KEY}\n`,
    },
  ];
  // Demo scope is a server module, and it still may not read the service token.
  expect(credentialReferenceViolations(files)).toEqual(["app/services/session.server.ts"]);
}

/**
 * Asserts a route module import fails and a comment does not.
 *
 * Purpose: app/routes.ts is a client module, and naming the file in a comment is not an import.
 * Inputs: none.
 * Side effects: none.
 */
function expectRouteModuleImportFails(): void {
  const routeModule: SourceFile = {
    relativePath: "app/routes.ts",
    text: 'const client = await import("./services/configuration.server.js");\n',
  };
  const commentOnly: SourceFile = {
    relativePath: "app/root.tsx",
    text: "// configuration.server stays on the server\n",
  };
  // The dynamic import fails. The comment does not.
  expect(clientImportViolations([routeModule, commentOnly])).toEqual(["app/routes.ts"]);
}

/** Matches an exported client loader or client action. */
const CLIENT_DATA_EXPORT = /\bexport\s+(?:async\s+)?(?:function|const|let)\s+client(?:Loader|Action)\b/;

/**
 * Lists app source files that export a client data handler.
 *
 * Purpose: the editor must not add clientLoader or clientAction.
 * Inputs: files, the source files to scan.
 * Side effects: none.
 */
function clientDataExportViolations(files: readonly SourceFile[]): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const normalized = normalize(file.relativePath);
    // Package config and tests are outside this check. Tests may name the handlers.
    if (!normalized.startsWith("app/")) {
      continue;
    }
    if (normalized.endsWith(".test.ts") || normalized.endsWith(".test.tsx")) {
      continue;
    }
    if (CLIENT_DATA_EXPORT.test(file.text)) {
      violations.push(normalized);
    }
  }
  return violations;
}

/**
 * Asserts the editor source does not export a client data handler.
 *
 * Purpose: a later route must not fetch configuration in the browser.
 * Inputs: none.
 * Side effects: reads the editor source tree.
 */
function expectEditorTreeHasNoClientDataHandlers(): void {
  // The real tree has none. A synthetic route export is a violation.
  expect(clientDataExportViolations(listSourceFiles(editorRoot()))).toEqual([]);
  const synthetic: SourceFile[] = [
    {
      relativePath: "app/routes/home.tsx",
      text: "export async function clientAction() {}\n",
    },
  ];
  expect(clientDataExportViolations(synthetic)).toEqual(["app/routes/home.tsx"]);
}

describe("credential boundary", () => {
  it("keeps the service credential in the server client", expectEditorTreeKeepsTheCredentialOnTheServer);
  it("fails when a client file names the service token", expectTokenInAClientFileFails);
  it("allows the server client and a server-only env helper", expectServerModulesMayNameTheToken);
  it("fails when a client component imports the server client", expectClientImportFails);
  it("allows the editor route to import the server client", expectEditorRouteMayImportTheServerClient);
  it("checks the service environment from the server entry", expectServerEntryChecksEnv);
  it("fails when a client file names the service URL", expectUrlInAClientFileFails);
  it("rejects the service token outside the configuration client", expectOtherServerModulesMayNotNameTheToken);
  it("fails when a route module imports the server client", expectRouteModuleImportFails);
  it("has no client loader or client action", expectEditorTreeHasNoClientDataHandlers);
});
