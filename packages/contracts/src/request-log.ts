/**
 * One JSON access line for a finished HTTP request.
 *
 * Both processes write this shape. The line may include the correlation id, method, path,
 * status, and duration. It does not include a bearer token, a cookie, or a configuration body.
 */

/** Header names that must not be written, compared in lower case. */
const SECRET_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie"]);

/** A header value short enough to collide with a JSON field name is not scrubbed as text. */
const MINIMUM_SCRUBBED_SECRET_LENGTH = 8;

/** One header value as Node or the Fetch API might present it. */
export type RequestLogHeaderValue = string | string[] | undefined;

/**
 * Headers a caller might otherwise print.
 *
 * A Fetch `Headers` list exposes `forEach`. A Node header bag is a plain record.
 */
export type RequestLogHeaders =
  | { forEach(callback: (value: string, name: string) => void): void }
  | { [name: string]: RequestLogHeaderValue };

/** The fields a finished request may contribute. `headers` and `body` are not copied onto the line. */
export type RequestLogInput = {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs?: number;
  headers?: RequestLogHeaders;
  body?: unknown;
};

/** The object that is serialized. It has no header bag and no body. */
export type RequestLogRecord = {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs?: number;
};

/** Receives one finished log line, including its trailing newline. */
export type RequestLogWriter = (line: string) => void;

/**
 * Writes one log line to stdout.
 *
 * Purpose: the production path for both processes. Tests pass their own writer instead.
 * Inputs: line, the JSON text, including the trailing newline.
 * Side effects: writes to stdout. Does not write to stderr.
 */
export function writeRequestLogStdout(line: string): void {
  // One line, already terminated. console.log would add a second newline.
  process.stdout.write(line);
}

/**
 * Reports whether the header bag is a Fetch list.
 *
 * Purpose: read `Headers` and a Node record with one loop.
 * Inputs: headers, the bag from the request.
 * Side effects: none.
 */
function isHeaderList(
  headers: RequestLogHeaders,
): headers is { forEach(callback: (value: string, name: string) => void): void } {
  // A Node record has no forEach. A Fetch Headers list does.
  return typeof (headers as { forEach?: unknown }).forEach === "function";
}

/**
 * Lists header names and values.
 *
 * Purpose: give redaction one flat list. Repeated values are joined so a set-cookie array is one string.
 * Inputs: headers, the request headers, or undefined when the caller did not pass any.
 * Side effects: none.
 */
function headerEntries(headers: RequestLogHeaders | undefined): Array<[string, string]> {
  // No bag means there is nothing to redact.
  if (headers === undefined) {
    return [];
  }
  const entries: Array<[string, string]> = [];
  // Fetch Headers yields one pair per name. The value is already combined.
  if (isHeaderList(headers)) {
    headers.forEach((value, name) => {
      entries.push([name, value]);
    });
    return entries;
  }
  // A Node bag may repeat set-cookie as an array.
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      entries.push([name, value.join(", ")]);
      continue;
    }
    entries.push([name, value]);
  }
  return entries;
}

/**
 * Drops authorization, cookie, and set-cookie.
 *
 * Purpose: a logger that prints headers must not print those three.
 * Inputs: headers, the request headers, or undefined.
 * Side effects: none. The returned record is a copy.
 */
export function redactSecretHeaders(headers: RequestLogHeaders | undefined): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [name, value] of headerEntries(headers)) {
    // The three secret names are omitted. Other names are kept only for callers that inspect this copy.
    if (SECRET_HEADER_NAMES.has(name.toLowerCase())) {
      continue;
    }
    safe[name] = value;
  }
  return safe;
}

/**
 * Collects secret header text that must not survive in a line.
 *
 * Purpose: remove a bearer token or a cookie if one was copied into a field such as the request id.
 * Inputs: headers, the request headers, or undefined.
 * Side effects: none.
 */
function secretHeaderValues(headers: RequestLogHeaders | undefined): string[] {
  const secrets: string[] = [];
  for (const [name, value] of headerEntries(headers)) {
    // Only the three secret names. A short value can equal a JSON key, so it is left for omission instead.
    if (!SECRET_HEADER_NAMES.has(name.toLowerCase()) || value.length < MINIMUM_SCRUBBED_SECRET_LENGTH) {
      continue;
    }
    secrets.push(value);
    // The token without the Bearer scheme is a separate string.
    if (name.toLowerCase() === "authorization") {
      const match = /^Bearer\s+(\S+)/i.exec(value);
      const token = match?.[1];
      if (token !== undefined && token.length >= MINIMUM_SCRUBBED_SECRET_LENGTH && token !== value) {
        secrets.push(token);
      }
    }
  }
  return secrets;
}

/**
 * Removes secret header text from a serialized line.
 *
 * Purpose: a request id or path that contains the credential does not keep it.
 * Inputs: line, the JSON text without the trailing newline. headers, the request headers.
 * Side effects: none.
 */
function scrubSecretHeaderValues(line: string, headers: RequestLogHeaders | undefined): string {
  let scrubbed = line;
  // Longer values first, so the full Authorization header is removed before the token inside it.
  const ordered = [...secretHeaderValues(headers)].sort((left, right) => right.length - left.length);
  for (const secret of ordered) {
    scrubbed = scrubbed.split(secret).join("[redacted]");
  }
  return scrubbed;
}

/**
 * Returns the path without a query or a hash.
 *
 * Purpose: a token in the search string is not part of the logged path.
 * Inputs: path, the request path, which may include a query.
 * Side effects: none.
 */
function pathWithoutQuery(path: string): string {
  const query = path.indexOf("?");
  const hash = path.indexOf("#");
  let end = path.length;
  // The first marker ends the path. A missing marker leaves the index at -1.
  if (query !== -1) {
    end = Math.min(end, query);
  }
  if (hash !== -1) {
    end = Math.min(end, hash);
  }
  return path.slice(0, end);
}

/**
 * Builds the object that is safe to serialize.
 *
 * Purpose: keep the correlation fields and leave headers and the body off the object.
 * Inputs: input, the finished request. `body` is accepted and not copied.
 * Side effects: none.
 */
export function safeRequestLogRecord(input: RequestLogInput): RequestLogRecord {
  // Secret headers are dropped here. The record below does not receive the remaining headers either.
  redactSecretHeaders(input.headers);
  // The document body is not a log field. Reading it would be how a title leaks.
  void input.body;
  const record: RequestLogRecord = {
    requestId: input.requestId,
    method: input.method,
    path: pathWithoutQuery(input.path),
    status: input.status,
  };
  // Duration is optional. A missing or non-finite number is left off the line.
  if (input.durationMs !== undefined && Number.isFinite(input.durationMs)) {
    record.durationMs = input.durationMs;
  }
  return record;
}

/**
 * Writes one JSON access line.
 *
 * Purpose: both processes call this once per finished request. Tests pass `write` and do not read stderr.
 * Inputs: input, the finished request, including headers and body that must not be printed. write, the destination. The default is stdout.
 * Side effects: calls write with one line.
 */
export function logCompletedRequest(input: RequestLogInput, write: RequestLogWriter = writeRequestLogStdout): void {
  // The record is the allowlist. Scrubbing covers a credential that was copied into one of those fields.
  const line = scrubSecretHeaderValues(JSON.stringify(safeRequestLogRecord(input)), input.headers);
  write(`${line}\n`);
}
