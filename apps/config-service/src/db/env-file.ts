import { existsSync, readFileSync } from "node:fs";

/**
 * Parses one KEY=value line.
 *
 * Purpose: read the example file's shape without a dotenv package.
 * Inputs: line, one physical line from the env file.
 * Side effects: none.
 */
function parseEnvLine(line: string): { key: string; value: string } | undefined {
  // Trim the Windows carriage return and surrounding spaces.
  const trimmed = line.trim();
  // Comments and blank lines carry no assignment.
  if (trimmed === "" || trimmed.startsWith("#")) {
    return undefined;
  }
  // The first equals sign splits the name from the value.
  const separator = trimmed.indexOf("=");
  if (separator <= 0) {
    return undefined;
  }
  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim();
  // A missing name is not a setting.
  if (key === "") {
    return undefined;
  }
  return { key, value };
}

/**
 * Reads assignments from an env file.
 *
 * Purpose: let migrate and the tests see DATABASE_URL without printing the file.
 * Inputs: filePath, the env file. A missing file yields an empty map.
 * Side effects: reads that file when it exists.
 */
export function readDotEnv(filePath: string): Map<string, string> {
  const values = new Map<string, string>();
  // A missing file is an empty environment, not an exception.
  if (!existsSync(filePath)) {
    return values;
  }
  // Split on LF and CRLF so the example file parses on Windows.
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseEnvLine(line);
    // Skip comments, blanks, and lines that are not assignments.
    if (parsed === undefined) {
      continue;
    }
    values.set(parsed.key, parsed.value);
  }
  return values;
}

/**
 * Copies env-file values into the process when the shell left them unset.
 *
 * Purpose: `pnpm db:migrate` can use the uncommitted .env file.
 * Inputs: filePath, the env file.
 * Side effects: sets unset keys on process.env. Does not override a value that is already present.
 */
export function applyDotEnv(filePath: string): void {
  const values = readDotEnv(filePath);
  for (const [key, value] of values) {
    // A shell assignment wins over the file so a one-off URL still works.
    if (process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
  }
}
