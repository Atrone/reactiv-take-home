/** Body returned by GET /health. It never includes credentials. */
export type HealthStatus = {
  status: "ok";
};

/**
 * Builds the health response body.
 *
 * Purpose: share one ok payload between GET /health and the sample test.
 * Inputs: none.
 * Side effects: none. This does not read configuration rows or the service token.
 */
export function healthStatus(): HealthStatus {
  // The payload is fixed. Do not add the token or a database result.
  return { status: "ok" };
}
