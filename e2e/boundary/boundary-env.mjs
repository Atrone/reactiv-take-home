import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directory of this module. Paths below are resolved from it so the shell cwd does not matter. */
const BOUNDARY_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Repository root. This file lives in e2e/boundary. */
export const REPO_ROOT = path.resolve(BOUNDARY_DIR, "../..");

/**
 * Distinctive credential for the boundary build and the browser session.
 *
 * It is a test double. It is not a production secret. Notes must not repeat the value.
 */
export const BOUNDARY_TOKEN = "boundary-token-do-not-leak";

/** Loopback port for the editor started by the boundary Playwright project. */
export const EDITOR_PORT = 4271;

/** Loopback port the editor calls. A spy or a stub listens here and records Authorization. */
export const OBSERVER_PORT = 4272;

/** Loopback port for the real configuration service when Postgres is available. */
export const SERVICE_PORT = 4273;

/** Editor origin. Browser configuration reads and writes must stay here. */
export const EDITOR_ORIGIN = `http://127.0.0.1:${EDITOR_PORT}`;

/** Origin passed to the editor as CONFIG_SERVICE_URL. The browser must not call it. */
export const OBSERVER_ORIGIN = `http://127.0.0.1:${OBSERVER_PORT}`;

/** Origin of the real configuration service behind the spy. */
export const SERVICE_ORIGIN = `http://127.0.0.1:${SERVICE_PORT}`;

/** Demo tenant. The browser does not choose it. */
export const TENANT_ID = "tenant_demo";

/** Demo configuration id. The browser does not choose it. */
export const CONFIGURATION_ID = "cfg_demo";

/** Database used only by this proof, so the dev database row is left alone. */
export const BOUNDARY_DATABASE = "reactiv_boundary";

/**
 * Compose's local Postgres URL.
 *
 * Used only when the shell and .env do not provide a reachable DATABASE_URL.
 * The password is the one published in compose.yaml, not the service token.
 */
export const COMPOSE_DATABASE_URL = "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv";

/** Raw child-process log. It is gitignored under test-results. The test reads it and must not print it. */
export const PROCESS_LOG = path.join(REPO_ROOT, "test-results", "boundary-process.log");

/** Title the browser types. It is not the service credential. */
export const EDITED_TITLE = "Boundary screen title";
