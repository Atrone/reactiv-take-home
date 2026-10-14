/**
 * Server-only demo scope for the local editor.
 *
 * This file name ends in `.server.ts`. React Router 7.18.4 fails the build if a client
 * module imports it. The values below are chosen by the server environment.
 */

/** The tenant and configuration the local editor may use. */
export type DemoScope = {
  tenantId: string;
  configurationId: string;
};

/**
 * Reads one demo variable and treats whitespace as missing.
 *
 * Purpose: a blank id is not a selected tenant or configuration.
 * Inputs: name, DEMO_TENANT_ID or DEMO_CONFIGURATION_ID.
 * Side effects: none. The value is not logged.
 */
function readNonBlankEnv(name: string): string | undefined {
  // Read the process environment. There is no id stored in this module.
  const value = process.env[name];
  // Unset and whitespace are both missing.
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  // Keep the original text so it matches the value the configuration service uses.
  return value;
}

/**
 * Returns the demo tenant and configuration.
 *
 * This is demo scope, not production authentication. A hosted editor would derive the
 * tenant and the actor from a verified session. The ids here come only from the server
 * environment. Query parameters and body fields named tenantId, actorId, or configurationId
 * are ignored, including when a request is passed in.
 *
 * Purpose: give a loader one server-selected scope.
 * Inputs: request, optional. It is not read. DEMO_TENANT_ID and DEMO_CONFIGURATION_ID from the environment.
 * Side effects: throws when either variable is missing or blank. Does not open a socket.
 */
export function getDemoScope(request?: Request): DemoScope {
  // A loader may pass the request. Its URL and body are not a source of tenant, actor, or configuration id.
  void request;
  // Read both server-selected ids. Do not look at search params or form fields.
  const tenantId = readNonBlankEnv("DEMO_TENANT_ID");
  const configurationId = readNonBlankEnv("DEMO_CONFIGURATION_ID");
  const problems: string[] = [];
  // Name each missing variable. Do not include the value that was rejected.
  if (tenantId === undefined) {
    problems.push("Missing required environment variable: DEMO_TENANT_ID");
  }
  if (configurationId === undefined) {
    problems.push("Missing required environment variable: DEMO_CONFIGURATION_ID");
  }
  if (tenantId === undefined || configurationId === undefined) {
    throw new Error(problems.join("\n"));
  }
  // The returned ids are the environment values, not anything the browser sent.
  return { tenantId, configurationId };
}
