import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyDotEnv, readDotEnv } from "./env-file.js";

const probeKey = "REACTIV_DOTENV_PROBE";
const writtenDirectories: string[] = [];

/**
 * Writes one env file in a temporary directory.
 *
 * Purpose: exercise the parser without changing the repository .env file.
 * Inputs: contents, the file text, including newlines the caller cares about.
 * Side effects: creates a directory under the system temp folder.
 */
async function writeEnvFile(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "reactiv-env-"));
  writtenDirectories.push(directory);
  const filePath = join(directory, ".env");
  // The temp file is the only input. It is not the service .env.
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

/**
 * Deletes temp env directories created by this file.
 *
 * Purpose: leave the temp folder clear after the parser tests.
 * Inputs: none.
 * Side effects: removes those directories.
 */
async function removeEnvFiles(): Promise<void> {
  for (const directory of writtenDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
  writtenDirectories.length = 0;
}

/**
 * Restores the probe environment variable.
 *
 * Purpose: one test must not leave REACTIV_DOTENV_PROBE set for later tests.
 * Inputs: previous, the value from before the test. Undefined means the key was unset.
 * Side effects: writes process.env.
 */
function restoreProbe(previous: string | undefined): void {
  if (previous === undefined) {
    delete process.env[probeKey];
    return;
  }
  process.env[probeKey] = previous;
}

/**
 * Asserts comments, blank lines, and CRLF assignments parse.
 *
 * Purpose: the example file's comments are not values, and Windows newlines still split.
 * Inputs: none.
 * Side effects: writes a temp file.
 */
async function expectCommentsAndBlankLinesAreSkipped(): Promise<void> {
  const filePath = await writeEnvFile("# comment\r\n\r\n  # indented\r\nDATABASE_URL=postgres://example/db\r\n");
  const values = readDotEnv(filePath);
  expect(values.get("DATABASE_URL")).toBe("postgres://example/db");
  expect(values.size).toBe(1);
}

/**
 * Asserts the first equals sign separates the name from the rest of the value.
 *
 * Purpose: a URL or token can contain equals signs.
 * Inputs: none.
 * Side effects: writes a temp file.
 */
async function expectValueKeepsLaterEqualsSigns(): Promise<void> {
  const filePath = await writeEnvFile("NAME = abc=def \nNOEQUALS\n=missing\n");
  const values = readDotEnv(filePath);
  expect(values.get("NAME")).toBe("abc=def");
  expect(values.has("NOEQUALS")).toBe(false);
  expect(values.size).toBe(1);
}

/**
 * Asserts a repeated key keeps the last assignment.
 *
 * Purpose: later lines in the file replace earlier ones.
 * Inputs: none.
 * Side effects: writes a temp file.
 */
async function expectLastDuplicateKeyWins(): Promise<void> {
  const filePath = await writeEnvFile("A=1\nA=2\n");
  expect(readDotEnv(filePath).get("A")).toBe("2");
}

/**
 * Asserts a missing file is an empty map.
 *
 * Purpose: migrate can start when .env has not been created yet.
 * Inputs: none.
 * Side effects: none. The path is not created.
 */
function expectMissingFileIsEmpty(): void {
  const values = readDotEnv(join(tmpdir(), "reactiv-env-missing", ".env"));
  expect(values.size).toBe(0);
}

/**
 * Asserts reading a file does not copy it into the process environment.
 *
 * Purpose: tests can parse .env without changing DATABASE_URL for other files.
 * Inputs: none.
 * Side effects: writes a temp file and touches the probe key only to observe it.
 */
async function expectReadDoesNotMutateProcessEnv(): Promise<void> {
  const previous = process.env[probeKey];
  delete process.env[probeKey];
  try {
    const filePath = await writeEnvFile(`${probeKey}=from-file\n`);
    readDotEnv(filePath);
    expect(process.env[probeKey]).toBeUndefined();
  } finally {
    restoreProbe(previous);
  }
}

/**
 * Asserts a shell value wins and an unset key is filled from the file.
 *
 * Purpose: `pnpm db:migrate` keeps an explicit DATABASE_URL and still reads the file for the rest.
 * Inputs: none.
 * Side effects: writes a temp file and the probe key, then restores that key.
 */
async function expectShellValueWinsOverTheFile(): Promise<void> {
  const previous = process.env[probeKey];
  const filePath = await writeEnvFile(`${probeKey}=from-file\n`);
  try {
    process.env[probeKey] = "from-shell";
    applyDotEnv(filePath);
    expect(process.env[probeKey]).toBe("from-shell");
    delete process.env[probeKey];
    applyDotEnv(filePath);
    expect(process.env[probeKey]).toBe("from-file");
  } finally {
    restoreProbe(previous);
  }
}

/**
 * Asserts a blank shell value is kept and an empty file value can fill an unset key.
 *
 * Purpose: a blank assignment is still a value, so the file does not replace it.
 * Inputs: none.
 * Side effects: writes a temp file and the probe key, then restores that key.
 */
async function expectBlankShellValueStaysBlank(): Promise<void> {
  const previous = process.env[probeKey];
  const filePath = await writeEnvFile(`${probeKey}=\n`);
  try {
    // A blank shell value is defined. The file must not replace it.
    process.env[probeKey] = "   ";
    applyDotEnv(filePath);
    expect(process.env[probeKey]).toBe("   ");
    delete process.env[probeKey];
    applyDotEnv(filePath);
    expect(process.env[probeKey]).toBe("");
  } finally {
    restoreProbe(previous);
  }
}

/**
 * Asserts a missing env file does not throw or invent keys.
 *
 * Purpose: applyDotEnv is safe when .env is absent.
 * Inputs: none.
 * Side effects: touches the probe key, then restores it.
 */
function expectApplyIgnoresAMissingFile(): void {
  const previous = process.env[probeKey];
  delete process.env[probeKey];
  try {
    applyDotEnv(join(tmpdir(), "reactiv-env-missing", ".env"));
    expect(process.env[probeKey]).toBeUndefined();
  } finally {
    restoreProbe(previous);
  }
}

/**
 * Registers the env-file suite.
 *
 * Purpose: cover the parser and the shell-over-file rule.
 * Inputs: none.
 * Side effects: registers tests and removes temp files afterward.
 */
function registerEnvFileTests(): void {
  afterEach(removeEnvFiles);
  it("skips comments and blank lines", expectCommentsAndBlankLinesAreSkipped);
  it("keeps equals signs that belong to the value", expectValueKeepsLaterEqualsSigns);
  it("keeps the last assignment for a repeated key", expectLastDuplicateKeyWins);
  it("returns an empty map when the file is missing", expectMissingFileIsEmpty);
  it("does not copy a parsed file into the process environment", expectReadDoesNotMutateProcessEnv);
  it("lets a shell value win and fills an unset key", expectShellValueWinsOverTheFile);
  it("keeps a blank shell value and can fill an unset key with an empty file value", expectBlankShellValueStaysBlank);
  it("ignores a missing file when applying values", expectApplyIgnoresAMissingFile);
}

describe("migration env file", registerEnvFileTests);
