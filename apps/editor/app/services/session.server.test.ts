import { afterEach, describe, expect, it } from "vitest";
import { getDemoScope } from "./session.server.js";

const savedTenant = process.env.DEMO_TENANT_ID;
const savedConfiguration = process.env.DEMO_CONFIGURATION_ID;

/**
 * Sets the demo scope variables for one case.
 *
 * Purpose: represent a missing variable with undefined.
 * Inputs: tenantId, the tenant text or undefined to delete it. configurationId, the configuration text or undefined to delete it.
 * Side effects: writes process.env.
 */
function setDemoEnv(tenantId: string | undefined, configurationId: string | undefined): void {
  // Delete and assign are how a variable is missing or present.
  if (tenantId === undefined) {
    delete process.env.DEMO_TENANT_ID;
  } else {
    process.env.DEMO_TENANT_ID = tenantId;
  }
  if (configurationId === undefined) {
    delete process.env.DEMO_CONFIGURATION_ID;
  } else {
    process.env.DEMO_CONFIGURATION_ID = configurationId;
  }
}

/**
 * Restores the demo scope variables.
 *
 * Purpose: keep one case from changing the next case.
 * Inputs: none.
 * Side effects: writes the saved values back to process.env.
 */
function restoreDemoEnv(): void {
  // Put back whatever this process had before the file loaded.
  setDemoEnv(savedTenant, savedConfiguration);
}

/**
 * Asserts the scope comes from the environment and not the request.
 *
 * Purpose: query and body fields named tenantId, actorId, or configurationId do not select the demo.
 * Inputs: none.
 * Side effects: sets the demo environment and builds a request.
 */
async function expectScopeIgnoresRequest(): Promise<void> {
  setDemoEnv("tenant_demo", "cfg_demo");
  // Headers, query, and body can name a tenant, an actor, or a configuration. None of them are read.
  const request = new Request(
    "http://127.0.0.1:5173/?tenantId=evil-tenant&actorId=evil-actor&configurationId=evil-config",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-tenant-id": "header-tenant",
        "x-actor-id": "header-actor",
        "x-configuration-id": "header-config",
      },
      body: JSON.stringify({
        tenantId: "body-tenant",
        actorId: "body-actor",
        configurationId: "body-config",
      }),
    },
  );
  // The returned ids are the environment values.
  expect(getDemoScope(request)).toEqual({
    tenantId: "tenant_demo",
    configurationId: "cfg_demo",
  });
  // The body is still readable, so the function did not consume it.
  await expect(request.json()).resolves.toEqual({
    tenantId: "body-tenant",
    actorId: "body-actor",
    configurationId: "body-config",
  });
  // The query string is still the caller's. Scope did not rewrite the request.
  expect(new URL(request.url).searchParams.get("tenantId")).toBe("evil-tenant");
}

/**
 * Asserts a missing demo variable names that variable.
 *
 * Purpose: a blank or unset id fails closed and does not echo a previous value.
 * Inputs: none.
 * Side effects: changes the demo environment.
 */
function expectMissingDemoVariableIsNamed(): void {
  setDemoEnv("secret-tenant-19", undefined);
  // The configuration id is the gap. The tenant value is not part of the sentence.
  expect(() => getDemoScope()).toThrow("Missing required environment variable: DEMO_CONFIGURATION_ID");
  try {
    getDemoScope();
  } catch (error) {
    expect((error as Error).message).not.toContain("secret-tenant-19");
  }

  setDemoEnv("   ", "   ");
  // Whitespace is missing for both ids, and both names are in the one error.
  expect(() => getDemoScope()).toThrow("Missing required environment variable: DEMO_TENANT_ID");
  expect(() => getDemoScope()).toThrow("Missing required environment variable: DEMO_CONFIGURATION_ID");
}

/**
 * Asserts a call with no request returns the environment ids.
 *
 * Purpose: the loader path does not need a request, and later values replace earlier ones.
 * Inputs: none.
 * Side effects: changes the demo environment.
 */
function expectScopeWithoutARequest(): void {
  setDemoEnv("tenant_demo", "cfg_demo");
  // The primary call passes nothing. The ids are still the environment values.
  expect(getDemoScope()).toEqual({
    tenantId: "tenant_demo",
    configurationId: "cfg_demo",
  });

  setDemoEnv("tenant-a", "cfg-a");
  expect(getDemoScope().configurationId).toBe("cfg-a");
  setDemoEnv("tenant-b", "cfg-b");
  // The second call reads the environment again.
  expect(getDemoScope()).toEqual({
    tenantId: "tenant-b",
    configurationId: "cfg-b",
  });
}

/**
 * Reads the message from a thrown demo-scope error.
 *
 * Purpose: compare the exact sentence without catching the assertion itself.
 * Inputs: none. The environment is already set.
 * Side effects: calls getDemoScope.
 */
function demoScopeErrorMessage(): string {
  // A successful call is a test failure. The message is the thrown text.
  try {
    getDemoScope();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a demo scope error");
}

/**
 * Asserts surrounding spaces are kept and a missing tenant is named alone.
 *
 * Purpose: the service compares the stored text, and a configuration secret is not part of a tenant error.
 * Inputs: none.
 * Side effects: changes the demo environment.
 */
function expectUntrimmedScopeAndMissingTenant(): void {
  setDemoEnv("  tenant_demo  ", "  cfg_demo  ");
  const request = new Request("http://127.0.0.1:5173/?tenantId=other&configurationId=other");
  // The spaces are the stored values. The query does not trim or replace them.
  expect(getDemoScope(request)).toEqual({
    tenantId: "  tenant_demo  ",
    configurationId: "  cfg_demo  ",
  });

  setDemoEnv(undefined, "secret-config-42");
  // Only the tenant variable is missing. The configuration value is not echoed.
  const missingTenant = demoScopeErrorMessage();
  expect(missingTenant).toBe("Missing required environment variable: DEMO_TENANT_ID");
  expect(missingTenant).not.toContain("secret-config-42");

  setDemoEnv("   ", "   ");
  // Both blank ids produce both sentences, tenant first.
  expect(demoScopeErrorMessage()).toBe(
    "Missing required environment variable: DEMO_TENANT_ID\nMissing required environment variable: DEMO_CONFIGURATION_ID",
  );
}

afterEach(restoreDemoEnv);

describe("demo scope", () => {
  it("reads the server environment and ignores request fields", expectScopeIgnoresRequest);
  it("names a missing demo variable", expectMissingDemoVariableIsNamed);
  it("reads demo scope without a request", expectScopeWithoutARequest);
  it("keeps untrimmed ids and names a missing tenant", expectUntrimmedScopeAndMissingTenant);
});
