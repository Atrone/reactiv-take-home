import { configurationSchema, type Configuration, type EditableDocument } from "@reactiv/contracts";
import type { Pool, PoolClient } from "pg";
import { isPgErrorCode } from "../db/pg-error.js";
import { rollbackQuietly } from "../db/rollback.js";

/**
 * Postgres repository for one tenant's configuration documents.
 *
 * Every statement includes tenant_id. Callers cannot pass updated_at.
 * The conditional update is one statement, and success is returned after commit.
 */

/** Inserts revision 1. updated_at stays on the column default, now(). */
export const INSERT_CONFIGURATION_SQL = `
INSERT INTO configurations (tenant_id, id, schema_version, revision, data)
VALUES ($1, $2, $3, 1, $4::jsonb)
RETURNING id, schema_version, revision, updated_at, data;
`;

/** Loads one row for this tenant. The predicate is tenant_id and id. */
export const SELECT_CONFIGURATION_SQL = `
SELECT id, schema_version, revision, updated_at, data
FROM configurations
WHERE tenant_id = $1
  AND id = $2;
`;

/**
 * Updates one row when the stored revision is still the caller's revision.
 *
 * The WHERE clause is the concurrency control. updated_at is now().
 */
export const CONDITIONAL_UPDATE_SQL = `
UPDATE configurations
SET data = $1::jsonb,
    schema_version = $2,
    revision = revision + 1,
    updated_at = now()
WHERE tenant_id = $3
  AND id = $4
  AND revision = $5
RETURNING id, schema_version, revision, updated_at, data;
`;

/**
 * Distinguishes a missing row from a stale revision.
 *
 * The predicate is tenant_id and id. It does not look up the id alone.
 */
export const TENANT_SCOPED_EXISTS_SQL = `
SELECT id
FROM configurations
WHERE tenant_id = $1
  AND id = $2;
`;

/** Columns the driver returns from an insert, update, or get. */
type ConfigurationRow = {
  id: string;
  schema_version: number;
  revision: number;
  updated_at: Date | string;
  data: unknown;
};

/** A row the contract schema accepted. */
export type ConfigurationRepositorySuccess = {
  ok: true;
  configuration: Configuration;
};

/** Insert result. A repeated tenant and id is a unique violation, not an upsert. */
export type InsertConfigurationResult =
  | ConfigurationRepositorySuccess
  | { ok: false; reason: "unique-violation" };

/** Get result. A miss is not-found for this tenant. */
export type GetConfigurationResult = ConfigurationRepositorySuccess | { ok: false; reason: "not-found" };

/** Update result. A miss is not-found. A stale revision is a conflict. */
export type UpdateConfigurationResult =
  | ConfigurationRepositorySuccess
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "revision-conflict" };

/** Values for insert. The id is chosen by a later service layer. */
export type InsertConfigurationInput = {
  tenantId: string;
  id: string;
  document: EditableDocument;
};

/** Values for get. Both tenantId and id are required. */
export type GetConfigurationInput = {
  tenantId: string;
  id: string;
};

/** Values for the conditional update. expectedRevision is the caller's revision, not a new one. */
export type UpdateConfigurationInput = {
  tenantId: string;
  id: string;
  expectedRevision: number;
  document: EditableDocument;
};

/** The three tenant-scoped operations. They commit their own transactions. */
export type ConfigurationRepository = {
  insertConfiguration(input: InsertConfigurationInput): Promise<InsertConfigurationResult>;
  getConfiguration(input: GetConfigurationInput): Promise<GetConfigurationResult>;
  updateConfiguration(input: UpdateConfigurationInput): Promise<UpdateConfigurationResult>;
};

/**
 * Signals that a stored row cannot be returned as a configuration.
 *
 * Purpose: a row that fails the contract schema is an internal error.
 * Inputs: none. The message does not include the row.
 * Side effects: none.
 */
export class ConfigurationContractError extends Error {
  /**
   * Builds the internal-error message.
   *
   * Purpose: keep stored JSON out of the error text.
   * Inputs: none.
   * Side effects: none.
   */
  constructor() {
    // A later 500 response can show this message without echoing the document.
    super("Stored configuration does not match the contract schema.");
    this.name = "ConfigurationContractError";
  }
}

/**
 * Serializes the document payload for a jsonb parameter.
 *
 * Purpose: bind JSON text so the SQL cast to jsonb stays visible.
 * Inputs: document, the validated editable document.
 * Side effects: none.
 */
function jsonPayload(document: EditableDocument): string {
  // Store data only. schema_version, revision, and updated_at are columns.
  return JSON.stringify(document.data);
}

/**
 * Formats a database timestamp as ISO-8601 UTC.
 *
 * Purpose: the contract accepts an explicit UTC timestamp, and the column is timestamptz.
 * Inputs: value, the driver value for updated_at.
 * Side effects: none. Throws ConfigurationContractError when the value is not a timestamp.
 */
function utcTimestampFromDatabase(value: Date | string): string {
  // node-pg returns timestamptz as a Date. toISOString is UTC and ends in Z.
  if (value instanceof Date) {
    return value.toISOString();
  }
  // A string still has to parse as an instant before it can be normalized to Z.
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ConfigurationContractError();
  }
  return parsed.toISOString();
}

/**
 * Maps a driver row to the configuration contract.
 *
 * Purpose: return id, schemaVersion, revision, updatedAt, and data, or fail as an internal error.
 * Inputs: row, one RETURNING or SELECT row.
 * Side effects: none. Throws ConfigurationContractError when the row fails the schema.
 */
function configurationFromRow(row: ConfigurationRow): Configuration {
  // schemaVersion comes from the column. data is the jsonb object.
  const parsed = configurationSchema.safeParse({
    id: row.id,
    schemaVersion: row.schema_version,
    revision: row.revision,
    updatedAt: utcTimestampFromDatabase(row.updated_at),
    data: row.data,
  });
  // A row that fails the contract is not a successful read.
  if (!parsed.success) {
    throw new ConfigurationContractError();
  }
  return parsed.data;
}

/**
 * Runs the conditional update on a connection the caller already owns.
 *
 * Purpose: one UPDATE, then a tenant-scoped existence check when that UPDATE matches nothing.
 * The caller begins and commits the transaction. This function does not lock the row with a read.
 * Inputs: client, an open connection. input, the tenant, id, expected revision, and document.
 * Side effects: may update one row on that connection. Does not commit.
 */
export async function updateConfigurationOnClient(
  client: PoolClient,
  input: UpdateConfigurationInput,
): Promise<UpdateConfigurationResult> {
  // Bind every value. The revision in the WHERE clause is the caller's expected revision.
  const updated = await client.query<ConfigurationRow>(CONDITIONAL_UPDATE_SQL, [
    jsonPayload(input.document),
    input.document.schemaVersion,
    input.tenantId,
    input.id,
    input.expectedRevision,
  ]);
  // The primary key makes a match zero rows or one row.
  if (updated.rows.length > 1) {
    throw new Error("Conditional update returned more than one row.");
  }
  const row = updated.rows.at(0);
  // Parse before the caller commits, so a bad row rolls back with the transaction.
  if (row !== undefined) {
    return { ok: true, configuration: configurationFromRow(row) };
  }
  // The same tenant and id decide not-found versus a stale revision.
  const existing = await client.query<{ id: string }>(TENANT_SCOPED_EXISTS_SQL, [input.tenantId, input.id]);
  if (existing.rows.length === 0) {
    return { ok: false, reason: "not-found" };
  }
  return { ok: false, reason: "revision-conflict" };
}

/**
 * Builds the repository around one pool.
 *
 * Purpose: insert, get, and conditional update without HTTP or React types.
 * Inputs: pool, the Postgres pool. Every operation takes its tenant from the call.
 * Side effects: none until an operation runs.
 */
export function createConfigurationRepository(pool: Pool): ConfigurationRepository {
  /**
   * Inserts one configuration at revision 1.
   *
   * Purpose: persist schema_version, the document data, and a database timestamp.
   * Inputs: input.tenantId, input.id, and input.document. There is no timestamp argument.
   * Side effects: inserts one row, or returns unique-violation when that tenant and id exist.
   */
  async function insertConfiguration(input: InsertConfigurationInput): Promise<InsertConfigurationResult> {
    const client = await pool.connect();
    try {
      // Commit only after the returned row matches the contract.
      await client.query("BEGIN");
      const inserted = await client.query<ConfigurationRow>(INSERT_CONFIGURATION_SQL, [
        input.tenantId,
        input.id,
        input.document.schemaVersion,
        jsonPayload(input.document),
      ]);
      const row = inserted.rows.at(0);
      // RETURNING should yield the new row. A missing row is a driver failure.
      if (row === undefined) {
        throw new Error("Insert did not return a configuration row.");
      }
      const configuration = configurationFromRow(row);
      await client.query("COMMIT");
      return { ok: true, configuration };
    } catch (error) {
      // The unique violation aborts the transaction. Roll it back, then return the typed result.
      await rollbackQuietly(client);
      if (isPgErrorCode(error, "23505")) {
        return { ok: false, reason: "unique-violation" };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Loads one configuration for a tenant.
   *
   * Purpose: return the contract object, or not-found when this tenant has no such id.
   * Inputs: input.tenantId and input.id.
   * Side effects: reads one row. Throws ConfigurationContractError when the stored row fails the schema.
   */
  async function getConfiguration(input: GetConfigurationInput): Promise<GetConfigurationResult> {
    // The WHERE clause includes tenant_id and id.
    const found = await pool.query<ConfigurationRow>(SELECT_CONFIGURATION_SQL, [input.tenantId, input.id]);
    const row = found.rows.at(0);
    if (row === undefined) {
      return { ok: false, reason: "not-found" };
    }
    return { ok: true, configuration: configurationFromRow(row) };
  }

  /**
   * Updates one configuration when the revision still matches.
   *
   * Purpose: commit the conditional update, or report not-found or revision-conflict.
   * Inputs: input.tenantId, input.id, input.expectedRevision, and input.document.
   * Side effects: on success, replaces data, increments revision, and sets updated_at to now().
   */
  async function updateConfiguration(input: UpdateConfigurationInput): Promise<UpdateConfigurationResult> {
    const client = await pool.connect();
    try {
      // The transaction lasts for this UPDATE only. The WHERE clause holds the row.
      await client.query("BEGIN");
      const result = await updateConfigurationOnClient(client, input);
      // Success is visible only after commit. A miss rolls back the empty transaction.
      if (result.ok) {
        await client.query("COMMIT");
      } else {
        await client.query("ROLLBACK");
      }
      return result;
    } catch (error) {
      await rollbackQuietly(client);
      throw error;
    } finally {
      client.release();
    }
  }

  // The three operations close over this pool.
  return {
    insertConfiguration,
    getConfiguration,
    updateConfiguration,
  };
}
