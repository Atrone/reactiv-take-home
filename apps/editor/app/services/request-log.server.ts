import {
  logCompletedRequest,
  writeRequestLogStdout,
  type RequestLogInput,
  type RequestLogWriter,
} from "@reactiv/contracts";

/**
 * Server-only access log for the editor process.
 *
 * The loader and the action call this once per finished request. The production writer
 * is stdout. A test replaces it so the assertion does not capture stderr.
 */

/** The writer used by the next editor access line. Production starts on stdout. */
let writer: RequestLogWriter = writeRequestLogStdout;

/**
 * Replaces the editor access-log writer.
 *
 * Purpose: a test injects a buffer. The production path leaves this unset and writes stdout.
 * Inputs: next, the writer to use until reset.
 * Side effects: changes the module writer.
 */
export function setRequestLogWriter(next: RequestLogWriter): void {
  // The next finished request uses this writer instead of stdout.
  writer = next;
}

/**
 * Restores stdout as the editor access-log writer.
 *
 * Purpose: a test does not leave its buffer in place for a later file.
 * Inputs: none.
 * Side effects: points the module writer at stdout.
 */
export function resetRequestLogWriter(): void {
  // The process entry and the next request write the line to stdout.
  writer = writeRequestLogStdout;
}

/**
 * Writes the editor access line for one finished loader or action.
 *
 * Purpose: one JSON line with the correlation id, method, path, and status.
 * Inputs: input, the finished request. Headers and the body are accepted and not printed.
 * Side effects: calls the current writer with one line.
 */
export function logEditorRequest(input: RequestLogInput): void {
  // The shared formatter drops the credential headers and the document body.
  logCompletedRequest(input, writer);
}
