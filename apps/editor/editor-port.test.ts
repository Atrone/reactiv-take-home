import { afterEach, describe, expect, it } from "vitest";
import { editorDevServerSettings, readEditorPort } from "./editor-port.js";

let savedPort: string | undefined;

/**
 * Remembers EDITOR_PORT.
 *
 * Purpose: restore the parent environment after a port case.
 * Inputs: none.
 * Side effects: records EDITOR_PORT.
 */
function rememberPort(): void {
  savedPort = process.env.EDITOR_PORT;
}

/**
 * Restores EDITOR_PORT.
 *
 * Purpose: keep one port case from changing the next one.
 * Inputs: none.
 * Side effects: writes the saved value back to process.env.
 */
function restorePort(): void {
  if (savedPort === undefined) {
    delete process.env.EDITOR_PORT;
  } else {
    process.env.EDITOR_PORT = savedPort;
  }
}

/**
 * Sets EDITOR_PORT for one assertion.
 *
 * Purpose: represent an unset value with undefined.
 * Inputs: value, the variable text, or undefined to delete it.
 * Side effects: mutates process.env.EDITOR_PORT.
 */
function setEditorPort(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.EDITOR_PORT;
  } else {
    process.env.EDITOR_PORT = value;
  }
}

/**
 * Asserts one port input and the loopback host that goes with it.
 *
 * Purpose: invalid ports fall back to 5173 and the host stays on loopback.
 * Inputs: value, the EDITOR_PORT text; expected, the port the dev server should use.
 * Side effects: sets EDITOR_PORT for the assertion.
 */
function expectPort(value: string | undefined, expected: number): void {
  setEditorPort(value);
  expect(readEditorPort()).toBe(expected);
  expect(editorDevServerSettings()).toEqual({ host: "127.0.0.1", port: expected });
}

rememberPort();
afterEach(restorePort);

describe("editor dev server bind", () => {
  it("uses 5173 when EDITOR_PORT is unset", () => {
    expectPort(undefined, 5173);
  });

  it("uses 5173 when EDITOR_PORT is blank", () => {
    expectPort("   ", 5173);
  });

  it("uses a numeric EDITOR_PORT", () => {
    expectPort("4173", 4173);
  });

  it("uses 5173 for port 0", () => {
    expectPort("0", 5173);
  });

  it("uses 5173 for a port above 65535", () => {
    expectPort("65536", 5173);
  });

  it("uses 5173 for a fractional port", () => {
    expectPort("5173.5", 5173);
  });

  it("uses 5173 for a non-numeric port", () => {
    expectPort("nope", 5173);
  });

  it("keeps the host on loopback for a valid port", () => {
    expectPort("65535", 65535);
  });
});
