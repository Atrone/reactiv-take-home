/** Environment variable the client must not read. The value is a separate check. */
const SERVICE_TOKEN_KEY = "CONFIG_SERVICE_TOKEN";

/**
 * Lists credential leaks in one client asset or payload.
 *
 * Purpose: fail when the service token value is present, or when client code reads that variable from import.meta.env.
 * Inputs: text, the file or payload. token, the credential used for the build or the browser session.
 * Side effects: none. The returned reasons do not include the credential.
 */
export function scanClientAsset(text, token) {
  const reasons = [];
  // A non-empty credential that appears as text was copied into something the browser can receive.
  if (token !== "" && text.includes(token)) {
    reasons.push("token-value");
  }
  // Collapse whitespace so a wrapped property access still matches.
  const compact = text.replace(/\s+/g, "");
  // Dot, optional chaining, and both quote styles are the ways a client reads the key.
  const envRead =
    compact.includes(`import.meta.env.${SERVICE_TOKEN_KEY}`) ||
    compact.includes(`import.meta.env?.${SERVICE_TOKEN_KEY}`) ||
    compact.includes(`import.meta.env["${SERVICE_TOKEN_KEY}"]`) ||
    compact.includes(`import.meta.env['${SERVICE_TOKEN_KEY}']`) ||
    compact.includes(`import.meta.env?.["${SERVICE_TOKEN_KEY}"]`) ||
    compact.includes(`import.meta.env?.['${SERVICE_TOKEN_KEY}']`);
  if (envRead) {
    reasons.push("import-meta-env");
  }
  // The key alone means the client bundle names the server variable, even when the value was not inlined.
  if (text.includes(SERVICE_TOKEN_KEY)) {
    reasons.push("env-key");
  }
  return reasons;
}

/**
 * Removes the credential from text that a failure may print.
 *
 * Purpose: a build log can be shown without copying the token into the assertion output.
 * Inputs: text, the output. token, the credential to hide.
 * Side effects: none.
 */
export function redactCredential(text, token) {
  // An empty token must not erase the whole string.
  if (token === "") {
    return text;
  }
  // Every copy is replaced. The surrounding words stay so the failure is still readable.
  return text.split(token).join("[redacted]");
}
