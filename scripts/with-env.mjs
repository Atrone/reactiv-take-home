import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reads KEY=value lines from an env file.
 *
 * Purpose: give the dev scripts the same file migrate and seed already read.
 * Inputs: filePath, the env file. A missing file yields an empty map.
 * Side effects: reads that file when it exists. Values are not logged.
 */
function readDotEnv(filePath) {
  const values = new Map();
  // A missing file is an empty environment, not an exception.
  if (!existsSync(filePath)) {
    return values;
  }
  // Split on LF and CRLF so the example file parses on Windows.
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    // Trim the Windows carriage return and surrounding spaces.
    const trimmed = line.trim();
    // Comments and blank lines carry no assignment.
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    // The first equals sign splits the name from the value.
    const separator = trimmed.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    // A missing name is not a setting.
    if (key === "") {
      continue;
    }
    values.set(key, value);
  }
  return values;
}

/**
 * Copies env-file values into this process when the shell left them unset.
 *
 * Purpose: a shell assignment wins, including a blank one.
 * Inputs: filePath, the env file.
 * Side effects: sets unset keys on process.env. Does not override a value that is already present.
 */
function applyUnsetDotEnv(filePath) {
  const values = readDotEnv(filePath);
  for (const [key, value] of values) {
    // A shell assignment wins over the file so a one-off value still works.
    if (process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = value;
  }
}

/**
 * Starts a command after filling unset variables from the repo .env.
 *
 * Purpose: `pnpm dev:service` and `pnpm dev:editor` can use the local file on any shell.
 * Inputs: the command and its arguments, from process.argv after this script's name.
 * Side effects: may start a child process and exit with its status. Does not print env values.
 */
function main() {
  // This file lives in scripts/. The env file is the repository root.
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const envFile = resolve(scriptDir, "..", ".env");
  // Fill only keys the shell did not set. replace-me stays invalid for the service.
  applyUnsetDotEnv(envFile);
  const [command, ...args] = process.argv.slice(2);
  // No command means this script was started alone.
  if (command === undefined || command === "") {
    console.error("Missing command.");
    process.exit(1);
  }
  // Windows resolves pnpm through a .cmd shim. One command string avoids passing an args array to the shell.
  const child =
    process.platform === "win32"
      ? spawn([command, ...args].join(" "), {
          stdio: "inherit",
          env: process.env,
          shell: true,
        })
      : spawn(command, args, {
          stdio: "inherit",
          env: process.env,
        });
  // A failed spawn has no exit code. Report it without the environment.
  child.on("error", reportSpawnFailure);
  // The child status is this process's status. A signal is a failure.
  child.on("exit", exitWithChildStatus);
}

/**
 * Reports that the command process could not be created.
 *
 * Purpose: fail the script without printing environment values.
 * Inputs: none. The spawn error is not logged.
 * Side effects: writes one sentence to stderr and exits with status 1.
 */
function reportSpawnFailure() {
  // The sentence names the failure and not the env file.
  console.error("Failed to start the command.");
  process.exit(1);
}

/**
 * Exits with the child process status.
 *
 * Purpose: `pnpm dev:service` keeps the service's exit code.
 * Inputs: code, the child exit code. signal, the signal name when the child was killed.
 * Side effects: exits this process.
 */
function exitWithChildStatus(code, signal) {
  // A signal has no numeric status to forward.
  if (signal !== null) {
    process.exit(1);
  }
  // A missing code is still a failure.
  process.exit(code ?? 1);
}

main();
