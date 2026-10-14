import { createDemoDocument, type EditableDocument } from "@reactiv/contracts";
import type { ConfigurationRepository } from "../configurations/repository.js";

/**
 * Explicit demo seed.
 *
 * Inserts one configuration when that tenant and id are absent.
 * It does not run from GET, and it does not create tables.
 */

/**
 * Ids issued to createDemoDocument, in call order.
 *
 * The first three are the first carousel and its two slides. The next two are
 * the first text block and the first CTA. The same shape repeats for the second half.
 */
export const DEMO_DOCUMENT_ID_QUEUE = [
  "section-carousel-1",
  "image-carousel-1-1",
  "image-carousel-1-2",
  "section-text-1",
  "section-cta-1",
  "section-carousel-2",
  "image-carousel-2-1",
  "image-carousel-2-2",
  "section-text-2",
  "section-cta-2",
] as const;

/** Result of one seed attempt. An existing row is left as it was stored. */
export type SeedOutcome = "inserted" | "left-existing";

/** The tenant and configuration id the seed writes. */
export type SeedTarget = {
  tenantId: string;
  configurationId: string;
};

/**
 * Returns a generator for the fixed demo ids.
 *
 * Purpose: give createDemoDocument the same ten ids on every run.
 * Inputs: none. The queue is the constant above.
 * Side effects: none. The returned function advances its own index.
 */
export function createDemoIdQueue(): () => string {
  // The first call reads index 0. Each later call reads the next slot.
  let index = 0;

  /**
   * Returns the next fixed id.
   *
   * Purpose: section and image ids come from the queue, not from an array index inside the document.
   * Inputs: none.
   * Side effects: advances the closed-over index.
   */
  function nextDemoId(): string {
    // Read this slot, then move forward so the next call does not repeat it.
    const id = DEMO_DOCUMENT_ID_QUEUE[index];
    index += 1;
    // createDemoDocument asks for ten ids. An eleventh call is a fixture bug.
    if (id === undefined) {
      throw new Error("The demo document asked for more ids than the fixed queue provides.");
    }
    return id;
  }

  return nextDemoId;
}

/**
 * Builds the demo document with the fixed ids.
 *
 * Purpose: one schema-valid document the seed can insert. The ids do not change between runs.
 * Inputs: none. createDemoDocument calls the queue ten times.
 * Side effects: none. The shared schema parse throws when the fixture is invalid.
 */
export function createSeedDocument(): EditableDocument {
  // A new queue starts at the first carousel id. A second call does not continue the first queue.
  return createDemoDocument(createDemoIdQueue());
}

/**
 * Inserts the demo configuration when that row is absent.
 *
 * Purpose: store revision 1 once. A later run does not reset a merchant's edits.
 * Inputs: repository, the tenant-scoped store. input.tenantId and input.configurationId, the demo row.
 * Side effects: inserts one row when the lookup misses. An existing row is not updated.
 */
export async function seedDemoConfiguration(
  repository: ConfigurationRepository,
  input: SeedTarget,
): Promise<SeedOutcome> {
  // Look up this tenant and id before writing. A hit may already contain later edits.
  const existing = await repository.getConfiguration({
    tenantId: input.tenantId,
    id: input.configurationId,
  });
  // Leave revision, updatedAt, and the document as they are.
  if (existing.ok) {
    return "left-existing";
  }
  // Revision 1 is assigned by the insert. The section and image ids come from the fixed queue.
  const inserted = await repository.insertConfiguration({
    tenantId: input.tenantId,
    id: input.configurationId,
    document: createSeedDocument(),
  });
  // Another seed inserted the same row after the lookup. That insert is the one that stays.
  if (!inserted.ok) {
    return "left-existing";
  }
  return "inserted";
}
