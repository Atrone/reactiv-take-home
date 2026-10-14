/**
 * Reports whether an unknown failure is a Postgres error with this SQLSTATE.
 *
 * Purpose: map driver failures such as unique_violation without string-matching the message.
 * Inputs: error, the thrown value. code, the five-character SQLSTATE.
 * Side effects: none.
 */
export function isPgErrorCode(error: unknown, code: string): boolean {
  // Driver errors are objects. A string or a bare Error has no SQLSTATE.
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  // SQLSTATE is text, for example 23505 for a unique violation.
  return error.code === code;
}
