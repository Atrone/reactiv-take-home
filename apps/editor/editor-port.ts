/** Bind settings for the editor dev server. The host stays on loopback. */
export type EditorDevServerSettings = {
  host: "127.0.0.1";
  port: number;
};

/**
 * Reads the editor dev-server port.
 *
 * Purpose: honor EDITOR_PORT when it is a TCP port, otherwise use 5173.
 * Inputs: EDITOR_PORT from the environment.
 * Side effects: none.
 */
export function readEditorPort(): number {
  // An unset or blank port keeps Vite's usual local port.
  const raw = process.env.EDITOR_PORT;
  if (raw === undefined || raw.trim() === "") {
    return 5173;
  }
  // Ignore a value that is not a TCP port and keep the default.
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return 5173;
  }
  return port;
}

/**
 * Builds the editor dev-server bind settings.
 *
 * Purpose: keep the dev server on loopback and apply EDITOR_PORT.
 * Inputs: EDITOR_PORT from the environment.
 * Side effects: none.
 */
export function editorDevServerSettings(): EditorDevServerSettings {
  // The host is fixed. Only the port follows the environment.
  return {
    host: "127.0.0.1",
    port: readEditorPort(),
  };
}
