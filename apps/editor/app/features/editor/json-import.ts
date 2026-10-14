import {
  editableDocumentSchema,
  issuesFromZodError,
  LIMITS,
  type EditableDocument,
  type ErrorIssue,
} from "@reactiv/contracts";

/** Shown when `file.size` is above the shared payload ceiling. The file is not read. */
export const IMPORT_TOO_LARGE_MESSAGE = "This file is larger than 256 KiB.";

/** Shown when `JSON.parse` throws. An empty file uses this sentence too. */
export const IMPORT_INVALID_JSON_MESSAGE = "This file is not valid JSON.";

/** Shown when the browser cannot read a file that already passed the size check. */
export const IMPORT_UNREADABLE_MESSAGE = "This file could not be read.";

/**
 * Shown for a strict-schema failure on `id`, `revision`, or `updatedAt`.
 * Those keys are not removed. A file cannot choose a different server configuration.
 */
export const IMPORT_PORTABLE_KEYS_MESSAGE = "The portable file must contain only schemaVersion and data.";

/** Shown after `importDocument`. The draft is local until the author saves. */
export const IMPORTED_NOT_SAVED_MESSAGE = "Imported, not saved.";

/** A validated portable document, or the sentence that explains a rejected file. */
export type JsonImportPlan =
  | { ok: true; document: EditableDocument }
  | { ok: false; message: string };

/** Top-level keys the portable file must not carry. They belong to the service record. */
const SERVICE_OWNED_IMPORT_KEYS = ["id", "revision", "updatedAt"] as const;

/**
 * Reports whether a parsed JSON value is a plain object.
 *
 * Purpose: field lookups for schema version and extra keys stay off arrays and null.
 * Inputs: value, the value returned by `JSON.parse`.
 * Side effects: none.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  // Arrays and null are objects in JavaScript. A portable document is a plain object.
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reports whether an issue path is a service-owned top-level key.
 *
 * Purpose: `id`, `revision`, and `updatedAt` share one explanation.
 * Inputs: path, a field path from `issuesFromZodError`.
 * Side effects: none.
 */
function isServiceOwnedImportPath(path: string): boolean {
  // The path is the key itself when the extra field sits on the document root.
  return SERVICE_OWNED_IMPORT_KEYS.some((key) => key === path);
}

/**
 * Describes a rejected `schemaVersion` for the status sentence.
 *
 * Purpose: version 2 and version 0 are visible in the message, not only the supported version.
 * Inputs: version, the value found on the parsed object.
 * Side effects: none.
 */
function describeSchemaVersion(version: unknown): string {
  // Numbers and booleans are safe to spell. Strings stay quoted so `"1"` is distinct from 1.
  if (typeof version === "number" || typeof version === "boolean") {
    return String(version);
  }
  if (typeof version === "string") {
    return JSON.stringify(version);
  }
  if (version === null) {
    return "null";
  }
  return "an unsupported value";
}

/**
 * Formats one schema issue, including the schema version the file used.
 *
 * Purpose: the status text names the field path and the schema's own message.
 * Inputs: value, the parsed JSON. issue, one field error.
 * Side effects: none.
 */
function formatSchemaIssue(value: unknown, issue: ErrorIssue): string {
  // A missing schemaVersion has no value to quote. The schema message still names version 1.
  if (issue.path !== "schemaVersion" || !isRecord(value) || !Object.hasOwn(value, "schemaVersion")) {
    return `${issue.path}: ${issue.message}`;
  }
  // The received version is part of the sentence so version 2 is visible.
  const found = describeSchemaVersion(value.schemaVersion);
  return `${issue.path}: ${issue.message} This file uses schema version ${found}.`;
}

/**
 * Collects service-owned paths in first-seen order.
 *
 * Purpose: `id`, `revision`, and `updatedAt` are listed once, without dropping the other issues.
 * Inputs: issues, the field errors from the shared schema.
 * Side effects: none.
 */
function serviceOwnedPaths(issues: readonly ErrorIssue[]): string[] {
  const paths: string[] = [];
  for (const issue of issues) {
    // Nested keys such as a section id are not in this list.
    if (!isServiceOwnedImportPath(issue.path) || paths.includes(issue.path)) {
      continue;
    }
    paths.push(issue.path);
  }
  return paths;
}

/**
 * Turns schema issues into one status sentence.
 *
 * Purpose: the author sees the field paths before the draft can change.
 * Inputs: value, the parsed JSON. issues, the field errors from the shared schema.
 * Side effects: none.
 */
function formatImportIssues(value: unknown, issues: readonly ErrorIssue[]): string {
  const ownedPaths = serviceOwnedPaths(issues);
  const lines: string[] = [];
  if (ownedPaths.length > 0) {
    // The keys stay in the file. This sentence is the reason they are rejected.
    lines.push(`${ownedPaths.join(", ")}: ${IMPORT_PORTABLE_KEYS_MESSAGE}`);
  }
  for (const issue of issues) {
    // Service-owned keys are already named on the line above.
    if (isServiceOwnedImportPath(issue.path)) {
      continue;
    }
    lines.push(formatSchemaIssue(value, issue));
  }
  if (lines.length > 0) {
    return lines.join(" ");
  }
  // A failed parse with no issues still needs a sentence. The draft is not replaced.
  return "This file is not a valid portable document.";
}

/**
 * Validates parsed JSON with the shared editable-document schema.
 *
 * Purpose: import uses the same color, URL, version, and id rules as an API write.
 * Inputs: value, the value returned by `JSON.parse`. Extra keys are not removed.
 * Side effects: none. It does not dispatch and it does not call the configuration service.
 */
export function validatePortableImport(value: unknown): JsonImportPlan {
  // id, revision, and updatedAt fail this strict object. They are not stripped first.
  const parsed = editableDocumentSchema.safeParse(value);
  if (!parsed.success) {
    // The issue list is the status text. The caller keeps the current draft.
    return { ok: false, message: formatImportIssues(value, issuesFromZodError(parsed.error)) };
  }
  // The normalized document is the only value allowed into `importDocument`.
  return { ok: true, document: parsed.data };
}

/**
 * Parses import text that has already passed the size check.
 *
 * Purpose: syntax errors become one sentence, and a parsed value still has to match the schema.
 * Inputs: text, the file text. An empty string is not valid JSON.
 * Side effects: none.
 */
export function parsePortableImportText(text: string): JsonImportPlan {
  let value: unknown;
  try {
    // `{`, an empty string, and other non-JSON text throw. The catch does not read the draft.
    value = JSON.parse(text);
  } catch {
    // The parser's own message stays off the page. The sentence is the same for every syntax error.
    return { ok: false, message: IMPORT_INVALID_JSON_MESSAGE };
  }
  // Schema checks run only after the text has parsed.
  return validatePortableImport(value);
}

/**
 * Reads one chosen file after checking `file.size`.
 *
 * Purpose: a file larger than 256 KiB is rejected before its contents are read.
 * Inputs: file, the file from the import control. `size` is the byte length.
 * Side effects: reads the file when it is within the limit. Does not dispatch or fetch.
 */
export async function readPortableImport(file: File): Promise<JsonImportPlan> {
  // The shared ceiling is 256 KiB inclusive. One byte over that skips the read.
  if (file.size > LIMITS.maxPayloadBytes) {
    return { ok: false, message: IMPORT_TOO_LARGE_MESSAGE };
  }
  let text: string;
  try {
    // The size check has passed. This is the only read.
    text = await file.text();
  } catch {
    // A read failure is not a JSON error and does not replace the draft.
    return { ok: false, message: IMPORT_UNREADABLE_MESSAGE };
  }
  // Parse and schema checks use the text. They still cannot change the draft.
  return parsePortableImportText(text);
}
