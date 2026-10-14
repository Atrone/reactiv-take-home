import { randomUUID } from "node:crypto";
import {
  editableDocumentSchema,
  issuesFromZodError,
  type Configuration,
  type EditableDocument,
  type ErrorIssue,
} from "@reactiv/contracts";
import type { ConfigurationRepository } from "./repository.js";

/** A stored configuration, or a validation failure that did not write. */
export type CreateConfigurationResult =
  | { ok: true; configuration: Configuration }
  | { ok: false; reason: "validation-failed"; issues: ErrorIssue[] }
  | { ok: false; reason: "unique-violation" };

/** A stored configuration, or a miss for this tenant only. */
export type LoadConfigurationResult =
  | { ok: true; configuration: Configuration }
  | { ok: false; reason: "not-found" };

/** Values for create. The body is untrusted. The service assigns the id. */
export type CreateConfigurationInput = {
  tenantId: string;
  body: unknown;
  generateId?: () => string;
};

/** Values for load. Both tenantId and id are required. */
export type LoadConfigurationInput = {
  tenantId: string;
  id: string;
};

/**
 * A committed replacement, or a failure that did not write.
 * The revision compared here came from If-Match, not from the body.
 */
export type ConditionalUpdateResult =
  | { ok: true; configuration: Configuration }
  | { ok: false; reason: "validation-failed"; issues: ErrorIssue[] }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "revision-conflict" };

/** Values for a conditional replace. expectedRevision is the strong If-Match revision. */
export type ConditionalUpdateInput = {
  tenantId: string;
  id: string;
  expectedRevision: number;
  body: unknown;
};

/**
 * Parses a write body with the shared document schema.
 *
 * Purpose: re-validate every write even when the caller claims the body is already valid.
 * Inputs: body, the raw JSON value. id, revision, and updatedAt are not accepted.
 * Side effects: none. A failure does not write.
 */
function parseEditableDocument(
  body: unknown,
): { ok: true; document: EditableDocument } | { ok: false; reason: "validation-failed"; issues: ErrorIssue[] } {
  // Strict parsing rejects id, revision, updatedAt, tenantId, and unknown section types.
  const parsed = editableDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, reason: "validation-failed", issues: issuesFromZodError(parsed.error) };
  }
  // The parsed value is the normalized document. The raw body is not stored.
  return { ok: true, document: parsed.data };
}

/**
 * Builds a configuration id.
 *
 * Purpose: the service assigns the id. The body cannot supply one.
 * Inputs: generateId, an optional UUID source. The default is crypto.randomUUID.
 * Side effects: calls generateId once when it is provided, otherwise randomUUID once.
 */
function createConfigurationId(generateId?: () => string): string {
  // The suffix is a UUID. The cfg_ prefix is not taken from the request.
  const uuid = generateId === undefined ? randomUUID() : generateId();
  return `cfg_${uuid}`;
}

/**
 * Stores one new configuration.
 *
 * Purpose: validate the editable document, assign id and revision 1, and insert it.
 * Inputs: repository, the tenant-scoped store. input.tenantId, the server tenant. input.body, the raw JSON.
 * Side effects: inserts one row when the document is valid. A validation failure does not write.
 */
export async function createConfiguration(
  repository: ConfigurationRepository,
  input: CreateConfigurationInput,
): Promise<CreateConfigurationResult> {
  // Re-validate here. A caller that already parsed the body still goes through this schema.
  const parsed = parseEditableDocument(input.body);
  if (!parsed.ok) {
    return parsed;
  }
  // id, revision, and updatedAt are not read from the body. Revision 1 and updated_at belong to the insert.
  const id = createConfigurationId(input.generateId);
  const inserted = await repository.insertConfiguration({
    tenantId: input.tenantId,
    id,
    document: parsed.document,
  });
  // A repeated id is not an upsert. The HTTP layer treats that collision as an internal failure.
  if (!inserted.ok) {
    return { ok: false, reason: "unique-violation" };
  }
  return { ok: true, configuration: inserted.configuration };
}

/**
 * Loads one configuration for a tenant.
 *
 * Purpose: return the stored document, or not-found when this tenant has no such id.
 * Inputs: repository, the tenant-scoped store. input.tenantId and input.id.
 * Side effects: reads one row. Does not look up the id without the tenant, and does not insert.
 */
export async function loadConfiguration(
  repository: ConfigurationRepository,
  input: LoadConfigurationInput,
): Promise<LoadConfigurationResult> {
  // The repository predicate is tenant_id and id. A miss is not-found for this tenant.
  const found = await repository.getConfiguration({
    tenantId: input.tenantId,
    id: input.id,
  });
  // A miss does not insert the demo row. The seed command is the only writer of that default.
  if (!found.ok) {
    return { ok: false, reason: "not-found" };
  }
  return { ok: true, configuration: found.configuration };
}

/**
 * Replaces one configuration when the caller's revision still matches.
 *
 * Purpose: validate the whole document, then commit the conditional update. A bad payload does not burn a revision.
 * Inputs: repository, the tenant-scoped store. input.tenantId, the server tenant. input.id, the path id.
 * input.expectedRevision, the strong If-Match revision. input.body, the raw JSON. The body is not the source of the revision.
 * Side effects: on success, replaces data, increments revision, and sets updated_at to now(). A failure does not write.
 */
export async function updateConfiguration(
  repository: ConfigurationRepository,
  input: ConditionalUpdateInput,
): Promise<ConditionalUpdateResult> {
  // Re-validate before the write. id, revision, and updatedAt in the body fail this schema.
  const parsed = parseEditableDocument(input.body);
  if (!parsed.ok) {
    return parsed;
  }
  // expectedRevision is the If-Match value. Do not read a revision from the parsed document.
  const updated = await repository.updateConfiguration({
    tenantId: input.tenantId,
    id: input.id,
    expectedRevision: input.expectedRevision,
    document: parsed.document,
  });
  // The repository commits before it resolves. Return that result only after the commit.
  if (updated.ok) {
    return { ok: true, configuration: updated.configuration };
  }
  // A miss for this tenant is not a conflict and does not insert a row.
  if (updated.reason === "not-found") {
    return { ok: false, reason: "not-found" };
  }
  // The row exists and the stored revision was not the expected one. Nothing was replaced.
  return { ok: false, reason: "revision-conflict" };
}
