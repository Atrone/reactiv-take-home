import type { PoolClient } from "pg";

/**
 * Ends an open transaction and keeps the original error.
 *
 * Purpose: return a connection to the pool without leaving it inside a failed transaction.
 * Inputs: client, the connection that may have an open transaction.
 * Side effects: sends ROLLBACK. Swallows a second failure so the caller can throw the first one.
 */
export async function rollbackQuietly(client: PoolClient): Promise<void> {
  try {
    // ROLLBACK is a no-op warning when this connection already committed.
    await client.query("ROLLBACK");
  } catch {
    // The caller reports the original failure. A second rollback error stays here.
  }
}
