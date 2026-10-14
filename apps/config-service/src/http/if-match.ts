/** Largest revision the integer column can store. A larger tag is not one we emit. */
const MAX_STORED_REVISION = 2_147_483_647;

/** One strong quoted revision, such as "1". Leading zeros are a different validator. */
const STRONG_QUOTED_REVISION = /^"([1-9][0-9]*)"$/;

/** A usable If-Match revision, or a header that is not that validator. */
export type StrongRevisionEtag =
  | { ok: true; revision: number }
  | { ok: false; reason: "precondition-required" };

/**
 * Formats a strong revision validator.
 *
 * Purpose: quote the revision so the ETag is strong. A W/ prefix would be weak.
 * Inputs: revision, the stored concurrency counter.
 * Side effects: none.
 */
export function strongRevisionEtag(revision: number): string {
  // The quotes are part of the header value. Example: "1".
  return `"${revision}"`;
}

/**
 * Reads one strong revision from If-Match.
 *
 * Purpose: accept only the quoted revision this service emits. Missing, *, weak, and other forms are not that validator.
 * Inputs: header, the If-Match value. Duplicate headers arrive as an array.
 * Side effects: none. This does not read or write a configuration.
 */
export function parseStrongRevisionEtag(header: string | string[] | undefined): StrongRevisionEtag {
  // A missing header and a repeated header are not one revision.
  if (typeof header !== "string") {
    return { ok: false, reason: "precondition-required" };
  }
  // Optional whitespace may surround the value. The quotes stay inside it.
  const value = header.trim();
  // An empty value, the star, and a weak tag are not the strong quoted revision.
  if (value.length === 0 || value === "*" || value.startsWith("W/") || value.startsWith("w/")) {
    return { ok: false, reason: "precondition-required" };
  }
  // A comma-separated list is more than one validator.
  if (value.includes(",")) {
    return { ok: false, reason: "precondition-required" };
  }
  const match = STRONG_QUOTED_REVISION.exec(value);
  // Unquoted numbers, leading zeros, and quoted text are not the emitted ETag.
  if (match === null) {
    return { ok: false, reason: "precondition-required" };
  }
  const digits = match[1];
  // The pattern has one capture. A missing group is not a revision.
  if (digits === undefined) {
    return { ok: false, reason: "precondition-required" };
  }
  const revision = Number(digits);
  // The column is a 32-bit integer. A value outside it cannot match a stored revision.
  if (!Number.isSafeInteger(revision) || String(revision) !== digits || revision > MAX_STORED_REVISION) {
    return { ok: false, reason: "precondition-required" };
  }
  return { ok: true, revision };
}
