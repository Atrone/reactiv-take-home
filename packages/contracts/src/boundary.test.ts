import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

/**
 * Reads a repository file as text.
 *
 * Purpose: inspect package manifests and source without starting either app.
 * Inputs: path, the file relative to the repository root.
 * Side effects: reads that file.
 */
function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

/**
 * Lists TypeScript sources under a directory.
 *
 * Purpose: find app files that might declare a second document schema.
 * Inputs: directory, an absolute path. Build and dependency folders are skipped.
 * Side effects: reads the directory tree.
 */
function listTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    // Installed packages and build output are not application source.
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "build" ||
      entry.name === ".react-router" ||
      entry.name === "coverage"
    ) {
      continue;
    }
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = listTypeScriptFiles(fullPath);
      for (const file of nested) {
        files.push(file);
      }
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Reads one package.json dependency map.
 *
 * Purpose: confirm where Zod and the contracts package are declared.
 * Inputs: path, the package.json relative to the repository root.
 * Side effects: reads that file.
 */
function dependencyNames(path: string): string[] {
  const parsed = JSON.parse(readRepoFile(path)) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return [...Object.keys(parsed.dependencies ?? {}), ...Object.keys(parsed.devDependencies ?? {})];
}

/**
 * Confirms both apps depend on the contracts package and do not declare Zod.
 *
 * Purpose: keep one document schema in packages/contracts.
 * Inputs: none.
 * Side effects: reads package manifests, the lockfile, and app sources.
 */
function appsUseSharedContracts(): void {
  const contracts = JSON.parse(readRepoFile("packages/contracts/package.json")) as {
    dependencies?: Record<string, string>;
  };
  expect(contracts.dependencies?.zod).toBe("4.6.7");
  const lockfile = readRepoFile("pnpm-lock.yaml");
  expect(lockfile).toContain("zod@4.6.7");
  expect(lockfile).not.toMatch(/zod@3\b/);
  for (const app of ["apps/editor/package.json", "apps/config-service/package.json"]) {
    const names = dependencyNames(app);
    expect(names).toContain("@reactiv/contracts");
    expect(names).not.toContain("zod");
  }
  const zodImport = /from\s+["']zod(?:\/[^"']*)?["']/;
  for (const appDir of ["apps/editor", "apps/config-service"]) {
    const files = listTypeScriptFiles(join(repoRoot, appDir));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source).not.toMatch(zodImport);
    }
  }
}

/**
 * Registers the workspace-boundary tests.
 *
 * Purpose: prove the apps do not carry a second Zod document schema.
 * Inputs: none.
 * Side effects: registers Vitest cases.
 */
function registerBoundaryTests(): void {
  it("keeps Zod document schemas in @reactiv/contracts", appsUseSharedContracts);
}

describe("contracts package boundary", registerBoundaryTests);
