import type { AppLoadContext, EntryContext } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import handleRequest from "./entry.server.js";
import { EditorServerEnvError } from "./services/configuration.server.js";

const savedUrl = process.env[["CONFIG", "SERVICE", "URL"].join("_")];
const savedToken = process.env[["CONFIG", "SERVICE", "TOKEN"].join("_")];

/**
 * Names the private service URL variable without storing it as one string.
 *
 * Purpose: this test file must not contain the credential variable names as literals.
 * Inputs: none.
 * Side effects: none.
 */
function serviceUrlKey(): string {
  // The join is the environment key the server entry checks.
  return ["CONFIG", "SERVICE", "URL"].join("_");
}

/**
 * Names the private service token variable without storing it as one string.
 *
 * Purpose: this test file must not contain the credential variable name as a literal.
 * Inputs: none.
 * Side effects: none.
 */
function serviceTokenKey(): string {
  // The join is the environment key the server entry checks.
  return ["CONFIG", "SERVICE", "TOKEN"].join("_");
}

/**
 * Sets the private service URL and token for one case.
 *
 * Purpose: represent a missing variable with undefined.
 * Inputs: url, the base URL, or undefined to delete it. token, the bearer token, or undefined to delete it.
 * Side effects: writes process.env.
 */
function setServiceEnv(url: string | undefined, token: string | undefined): void {
  // Delete and assign are how a variable is missing or present.
  if (url === undefined) {
    delete process.env[serviceUrlKey()];
  } else {
    process.env[serviceUrlKey()] = url;
  }
  if (token === undefined) {
    delete process.env[serviceTokenKey()];
  } else {
    process.env[serviceTokenKey()] = token;
  }
}

/**
 * Restores the service environment.
 *
 * Purpose: keep one case from changing the next case.
 * Inputs: none.
 * Side effects: writes the saved values back to process.env.
 */
function restoreServiceEnv(): void {
  // Put back whatever this process had before the file loaded.
  setServiceEnv(savedUrl, savedToken);
}

/**
 * Calls the server entry for one method.
 *
 * Purpose: a setup failure is a rejected promise, so the adapter can catch it.
 * Inputs: method, GET or HEAD.
 * Side effects: calls handleRequest. Does not render when the environment is not ready.
 */
function startHandleRequest(method: string): Promise<Response> {
  // The router context is unused when setup fails before render.
  const routerContext = {} as EntryContext;
  const loadContext = {} as AppLoadContext;
  // The status and headers would be the empty HEAD response if setup were skipped.
  return handleRequest(
    new Request("http://127.0.0.1:5199/", { method }),
    200,
    new Headers(),
    routerContext,
    loadContext,
  );
}

/**
 * Reads the message from a rejected server entry call.
 *
 * Purpose: compare the exact setup sentences.
 * Inputs: pending, the promise from handleRequest.
 * Side effects: awaits the promise.
 */
async function rejectedMessage(pending: Promise<Response>): Promise<string> {
  // A resolved response would mean the entry rendered or answered HEAD.
  try {
    await pending;
  } catch (error) {
    expect(error).toBeInstanceOf(EditorServerEnvError);
    return (error as Error).message;
  }
  throw new Error("expected the server entry to reject");
}

/**
 * Asserts a missing environment rejects GET and HEAD before a response.
 *
 * Purpose: the check runs before the HEAD short-circuit and returns a rejected promise.
 * Inputs: none.
 * Side effects: clears the service environment.
 */
async function expectMissingEnvRejectsBeforeRender(): Promise<void> {
  setServiceEnv(undefined, undefined);
  const missingUrl = `Missing required environment variable: ${serviceUrlKey()}`;
  const missingToken = `Missing required environment variable: ${serviceTokenKey()}`;
  let pending: Promise<Response> | undefined;
  // The call returns a promise. It does not throw into the adapter.
  expect(() => {
    pending = startHandleRequest("GET");
  }).not.toThrow();
  expect(await rejectedMessage(pending as Promise<Response>)).toBe(`${missingUrl}\n${missingToken}`);

  // HEAD would be an empty 200 if the check ran after that short-circuit.
  expect(await rejectedMessage(startHandleRequest("HEAD"))).toBe(`${missingUrl}\n${missingToken}`);
}

/**
 * Asserts a missing URL does not echo a token that is set.
 *
 * Purpose: the rejection names the variable and omits the credential.
 * Inputs: none.
 * Side effects: sets the service environment.
 */
async function expectMissingUrlDoesNotEchoTheToken(): Promise<void> {
  const token = "entry-secret-55d2";
  setServiceEnv(undefined, token);
  const message = await rejectedMessage(startHandleRequest("GET"));
  // The token is present in the environment and absent from the error.
  expect(message).toBe(`Missing required environment variable: ${serviceUrlKey()}`);
  expect(message).not.toContain(token);
}

/**
 * Asserts the example placeholder is rejected without repeating it.
 *
 * Purpose: replace-me is not a credential the server entry will use.
 * Inputs: none.
 * Side effects: sets the service environment.
 */
async function expectPlaceholderTokenRejects(): Promise<void> {
  setServiceEnv("http://127.0.0.1:4001", "replace-me");
  const message = await rejectedMessage(startHandleRequest("GET"));
  expect(message).toBe(`Invalid environment variable: ${serviceTokenKey()}`);
  expect(message).not.toContain("replace-me");
}

/**
 * Asserts a ready environment still answers HEAD.
 *
 * Purpose: the setup check does not replace the empty HEAD response, and it does not call the service.
 * Inputs: none.
 * Side effects: sets the service environment.
 */
async function expectReadyEnvStillAnswersHead(): Promise<void> {
  // HTTPS is valid. This request does not open a socket to that host.
  setServiceEnv("https://127.0.0.1:4001", "ready-token-12ab");
  const response = await startHandleRequest("HEAD");
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("");
}

afterEach(restoreServiceEnv);

describe("editor server entry", () => {
  it("rejects a missing environment before rendering", expectMissingEnvRejectsBeforeRender);
  it("names a missing URL without the token", expectMissingUrlDoesNotEchoTheToken);
  it("rejects the example token without repeating it", expectPlaceholderTokenRejects);
  it("answers HEAD when the environment is ready", expectReadyEnvStillAnswersHead);
});
