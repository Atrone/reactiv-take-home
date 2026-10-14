import type {
  ConfigurationRepository,
  GetConfigurationResult,
  InsertConfigurationResult,
  UpdateConfigurationResult,
} from "../configurations/repository.js";

/**
 * Rejects a repository call when the process did not supply a pool.
 *
 * Purpose: fail closed if create or load runs without a database.
 * Inputs: operation, the method name. It is not a document or a credential.
 * Side effects: returns a rejected promise.
 */
function unavailable(operation: string): Promise<never> {
  // The message names the operation and does not include a row or a token.
  return Promise.reject(new Error(`Configuration repository ${operation} is not available.`));
}

/**
 * Builds a repository that fails if it is called.
 *
 * Purpose: give a server a repository value when the caller did not pass a pool.
 * Inputs: none.
 * Side effects: none until a method is called.
 */
export function createUnavailableRepository(): ConfigurationRepository {
  /**
   * Insert rejects when no pool was supplied.
   *
   * Purpose: reject an insert that cannot reach Postgres.
   * Inputs: ignored. The call itself is the mistake.
   * Side effects: rejects.
   */
  function insertConfiguration(): Promise<InsertConfigurationResult> {
    // Do not open a database connection.
    return unavailable("insert");
  }

  /**
   * Get rejects when no pool was supplied.
   *
   * Purpose: reject a read that cannot reach Postgres.
   * Inputs: ignored.
   * Side effects: rejects.
   */
  function getConfiguration(): Promise<GetConfigurationResult> {
    // Do not query configurations.
    return unavailable("get");
  }

  /**
   * Update rejects when no pool was supplied.
   *
   * Purpose: reject an update that cannot reach Postgres.
   * Inputs: ignored.
   * Side effects: rejects.
   */
  function updateConfiguration(): Promise<UpdateConfigurationResult> {
    // Do not update a row.
    return unavailable("update");
  }

  return {
    insertConfiguration,
    getConfiguration,
    updateConfiguration,
  };
}
