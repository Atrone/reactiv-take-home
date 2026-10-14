import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

/**
 * Reads a repository file as text.
 *
 * Purpose: assert committed setup files without starting Docker.
 * Inputs: path, the file relative to the repository root.
 * Side effects: reads that file.
 */
function readRepoFile(path: string): string {
  // Join against the repository root so a relative URL cannot drop the last directory.
  return readFileSync(join(repoRoot, path), "utf8");
}

/**
 * Asserts Compose keeps the private service on loopback and out of the token file.
 *
 * Purpose: the committed topology must not publish a public port or a real token.
 * Inputs: none.
 * Side effects: reads compose.yaml.
 */
function expectComposeBoundary(): void {
  const compose = readRepoFile("compose.yaml");
  // Postgres and the private service are published on loopback only.
  expect(compose).toContain("127.0.0.1:5432:5432");
  expect(compose).toContain("127.0.0.1:4001:4001");
  expect(compose).toContain("postgres:16");
  expect(compose).toContain("reactiv_pg");
  // The token is interpolated. The example placeholder is not a Compose default.
  expect(compose).toContain("${CONFIG_SERVICE_TOKEN}");
  expect(compose).not.toContain("replace-me");
  expect(compose).not.toContain("CONFIG_SERVICE_TOKEN:-");
  expect(compose).not.toContain("CONFIG_SERVICE_TOKEN:?");
}

/**
 * Asserts the example environment names the placeholder and no client prefix.
 *
 * Purpose: secrets stay in server variable names.
 * Inputs: none.
 * Side effects: reads .env.example.
 */
function expectExampleEnvBoundary(): void {
  const example = readRepoFile(".env.example");
  expect(example).toContain("CONFIG_SERVICE_TOKEN=replace-me");
  expect(example).toContain("Later auth must treat the literal replace-me as invalid");
  const clientPrefixes = example.split(/\r?\n/).filter((line) => line.startsWith("VITE_") || line.startsWith("NEXT_PUBLIC_"));
  expect(clientPrefixes).toEqual([]);
}

/**
 * Asserts git ignores the real environment file.
 *
 * Purpose: a local .env cannot be committed by the default ignore rules.
 * Inputs: none.
 * Side effects: reads .gitignore.
 */
function expectEnvIsIgnored(): void {
  const gitignore = readRepoFile(".gitignore");
  const lines = gitignore.split(/\r?\n/);
  expect(lines).toContain(".env");
  expect(lines).not.toContain("!.env");
}

/**
 * Asserts the editor package does not depend on the private service stack.
 *
 * Purpose: the editor must not import the database driver or Fastify.
 * Inputs: none.
 * Side effects: reads apps/editor/package.json.
 */
function expectEditorDependencies(): void {
  const editor = JSON.parse(readRepoFile("apps/editor/package.json")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const names = [...Object.keys(editor.dependencies ?? {}), ...Object.keys(editor.devDependencies ?? {})];
  expect(names).not.toContain("pg");
  expect(names).not.toContain("fastify");
  expect(names).not.toContain("@reactiv/config-service");
  expect(names).toContain("@reactiv/contracts");
  expect(names).toContain("react-router");
}

/**
 * Asserts the documented setup commands compile contracts before importing them.
 *
 * Purpose: a fresh `pnpm install` does not create `packages/contracts/dist`, and seed plus both dev commands import that build.
 * Inputs: none.
 * Side effects: reads the root package.json.
 */
function expectSetupScriptsBuildContracts(): void {
  const root = JSON.parse(readRepoFile("package.json")) as { scripts?: Record<string, string> };
  const scripts = root.scripts ?? {};
  // Seed imports the demo document from the built package.
  expect(scripts["db:seed"]?.startsWith("pnpm --filter @reactiv/contracts build && ")).toBe(true);
  // Each documented process imports the same build. The parallel `dev` script compiles once, then starts the serve scripts.
  expect(scripts["dev:service"]?.startsWith("pnpm --filter @reactiv/contracts build && ")).toBe(true);
  expect(scripts["dev:editor"]?.startsWith("pnpm --filter @reactiv/contracts build && ")).toBe(true);
  expect(scripts.dev).toContain("pnpm --filter @reactiv/contracts build && ");
}

describe("trust boundary files", () => {
  it("publishes Compose ports on loopback and does not commit a token", expectComposeBoundary);
  it("uses a server-only example token", expectExampleEnvBoundary);
  it("ignores .env", expectEnvIsIgnored);
  it("keeps pg and Fastify out of the editor package", expectEditorDependencies);
  it("builds contracts before seed and the dev servers", expectSetupScriptsBuildContracts);
});
