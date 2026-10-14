/** Loopback port for the editor started by the journey Playwright project. */
export const EDITOR_PORT = 4193;

/** Loopback port for the in-memory configuration fixture. */
export const FIXTURE_PORT = 4194;

/** Loopback port the tests use to reset, close, and fail the next save. */
export const CONTROL_PORT = 4195;

/** Configuration id the editor loader requests. */
export const CONFIGURATION_ID = "cfg_journey";

/** Tenant id the editor process expects. The fixture does not read it. */
export const TENANT_ID = "ten_journey";

/**
 * Bearer token the editor sends to this fixture only.
 *
 * It is a test double. It is not the configuration service credential.
 */
export const SERVICE_TOKEN = "playwright-journey-token";
