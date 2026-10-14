import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Finds the repository root from this file's URL.
 *
 * Purpose: SQL files and the local env file live at the root, not inside the package.
 * Inputs: none.
 * Side effects: none.
 */
export function repositoryRoot(): string {
  // This file is apps/config-service/src/db/paths.ts. Four parents reach the root.
  return fileURLToPath(new URL("../../../../", import.meta.url));
}

/**
 * Finds the SQL migration directory.
 *
 * Purpose: the runner and the tests read the same files.
 * Inputs: none.
 * Side effects: none.
 */
export function migrationsDirectory(): string {
  // Filename order in this directory is the apply order.
  return join(repositoryRoot(), "db", "migrations");
}

/**
 * Finds the uncommitted environment file.
 *
 * Purpose: local commands can read DATABASE_URL without printing it.
 * Inputs: none.
 * Side effects: none.
 */
export function envFilePath(): string {
  // .env is gitignored. .env.example is the committed template.
  return join(repositoryRoot(), ".env");
}
