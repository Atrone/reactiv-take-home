import { z } from "zod";

/**
 * Error codes later HTTP routes map to statuses.
 *
 * This module builds the body only. It does not choose an HTTP status.
 */
export const ERROR_CODES = [
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VALIDATION_FAILED",
  "MALFORMED_JSON",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "PRECONDITION_REQUIRED",
  "PRECONDITION_FAILED",
  "RATE_LIMITED",
  "SERVICE_UNAVAILABLE",
  "INTERNAL",
] as const;

/** One code from the shared error contract. */
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Message used when a document fails validation. */
export const VALIDATION_FAILED_MESSAGE = "Some fields need attention.";

export const errorCodeSchema = z.enum(ERROR_CODES);

/** One field error. `path` uses `data.sections[2].url`. */
export const errorIssueSchema = z.strictObject({
  path: z.string().min(1),
  message: z.string().min(1),
});

/** One field error after a successful parse. */
export type ErrorIssue = z.output<typeof errorIssueSchema>;

/**
 * Returns a message when issues do not match the error code.
 *
 * Purpose: validation failures carry field issues, and other codes do not.
 * Inputs: code, the error code. issues, the optional field list.
 * Side effects: none.
 */
function errorIssueMismatch(code: ErrorCode, issues: readonly ErrorIssue[] | undefined): string | null {
  // Validation failures always include the issues array, even when it is empty.
  if (code === "VALIDATION_FAILED" && issues === undefined) {
    return "Validation failures include an issues array.";
  }
  // Other codes omit issues or send an empty list.
  if (code !== "VALIDATION_FAILED" && issues !== undefined && issues.length > 0) {
    return "Only validation failures include field issues.";
  }
  return null;
}

/**
 * Checks that field issues appear only on validation failures.
 *
 * Purpose: keep one error shape for every failure code.
 * Inputs: value, the error object. ctx, the Zod issue collector.
 * Side effects: records an issue on ctx when the combination is wrong.
 */
function refineErrorObject(
  value: { code: ErrorCode; issues?: readonly ErrorIssue[] },
  ctx: { addIssue: (issue: { code: "custom"; message: string; path: PropertyKey[] }) => void },
): void {
  const mismatch = errorIssueMismatch(value.code, value.issues);
  // A mismatched issues list fails on the issues field.
  if (mismatch !== null) {
    ctx.addIssue({
      code: "custom",
      message: mismatch,
      path: ["issues"],
    });
  }
}

/**
 * Inner error object. Unknown keys, including stack traces and tokens, fail.
 * `issues` is present for validation failures and omitted or empty otherwise.
 */
export const errorObjectSchema = z
  .strictObject({
    code: errorCodeSchema,
    message: z.string().min(1, "Error message must be a non-empty string."),
    requestId: z.string().min(1, "requestId must be a non-empty string."),
    issues: z.array(errorIssueSchema).optional(),
  })
  .superRefine(refineErrorObject);

/** The only error body. The wrapper rejects a sibling stack or token field. */
export const errorBodySchema = z.strictObject({
  error: errorObjectSchema,
});

/** Parsed error body returned to callers. */
export type ErrorBody = z.output<typeof errorBodySchema>;

/**
 * Fields the builder refuses, so a stack trace or token cannot type-check.
 * Runtime parsing rejects these keys even when a caller casts them in.
 */
type HiddenErrorFields = {
  stack?: never;
  token?: never;
  sql?: never;
  authorization?: never;
};

/** Input accepted by `formatError`. */
export type FormatErrorInput = z.input<typeof errorObjectSchema> & HiddenErrorFields;

/**
 * Formats a Zod path for the error contract.
 *
 * Purpose: turn `["data", "sections", 2, "url"]` into `data.sections[2].url`.
 * Inputs: path, the segments from one Zod issue.
 * Side effects: none.
 */
export function formatIssuePath(path: readonly PropertyKey[]): string {
  const parts: string[] = [];
  for (const segment of path) {
    // Array indexes use brackets. Object keys use a dot separator.
    if (typeof segment === "number") {
      parts.push(`[${segment}]`);
      continue;
    }
    const key = String(segment);
    if (parts.length > 0) {
      parts.push(".");
    }
    parts.push(key);
  }
  return parts.join("");
}

/**
 * Uses `$` when a Zod issue has no path segments.
 *
 * Purpose: the error contract requires a non-empty path string.
 * Inputs: path, the segments to format.
 * Side effects: none.
 */
function nonEmptyIssuePath(path: readonly PropertyKey[]): string {
  const formatted = formatIssuePath(path);
  // A root issue still needs a path the schema will accept.
  if (formatted.length > 0) {
    return formatted;
  }
  return "$";
}

/**
 * Maps Zod issues onto the error contract's field list.
 *
 * Purpose: give later HTTP code one path format, without a second validator.
 * Inputs: error, a failed Zod parse.
 * Side effects: none.
 */
export function issuesFromZodError(error: z.ZodError): ErrorIssue[] {
  const issues: ErrorIssue[] = [];
  for (const issue of error.issues) {
    // One unrecognized key becomes its own field path, such as `id` or `data.sections[0].position`.
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) {
        issues.push({
          path: nonEmptyIssuePath([...issue.path, key]),
          message: issue.message,
        });
      }
      continue;
    }
    issues.push({
      path: nonEmptyIssuePath(issue.path),
      message: issue.message,
    });
  }
  return issues;
}

/**
 * Copies field issues onto the error object.
 *
 * Purpose: keep path and message, and leave stack or token fields behind.
 * Inputs: issues, the parsed field list.
 * Side effects: none.
 */
function copyErrorIssues(issues: readonly ErrorIssue[]): ErrorIssue[] {
  const copied: ErrorIssue[] = [];
  for (const issue of issues) {
    // Copy the two contract fields. Extra keys on an issue are not carried forward.
    copied.push({
      path: issue.path,
      message: issue.message,
    });
  }
  return copied;
}

/**
 * Builds the only error body either process returns.
 *
 * Purpose: copy code, message, request id, and field issues, and reject everything else.
 * Inputs: input, the typed error fields. A stack, token, or SQL field is invalid.
 * Side effects: throws when the input is outside the error contract. Does not log or read I/O.
 */
export function formatError(input: FormatErrorInput): ErrorBody {
  // Strict parsing rejects unknown keys. The thrown message does not copy those values.
  const parsed = errorObjectSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("The error builder received a value outside the error contract.");
  }
  const error: z.output<typeof errorObjectSchema> = {
    code: parsed.data.code,
    message: parsed.data.message,
    requestId: parsed.data.requestId,
  };
  // Validation failures keep issues. Other codes omit an empty list.
  if (parsed.data.code === "VALIDATION_FAILED") {
    error.issues = copyErrorIssues(parsed.data.issues ?? []);
  }
  const body = errorBodySchema.safeParse({ error });
  // The wrapper is strict, so a stack field cannot survive on the way out.
  if (!body.success) {
    throw new Error("The error builder received a value outside the error contract.");
  }
  return body.data;
}
