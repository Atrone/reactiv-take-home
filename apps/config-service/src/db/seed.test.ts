import { spawn } from "node:child_process";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  configurationSchema,
  errorBodySchema,
  type Configuration,
  type EditableDocument,
  type Section,
} from "@reactiv/contracts";
import type { FastifyInstance } from "fastify";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createConfigurationRepository,
  type ConfigurationRepository,
  type GetConfigurationResult,
  type InsertConfigurationResult,
  type UpdateConfigurationResult,
} from "../configurations/repository.js";
import { buildServer } from "../server.js";
import { readDotEnv } from "./env-file.js";
import { repositoryRoot } from "./paths.js";
import { createDemoIdQueue, createSeedDocument, DEMO_DOCUMENT_ID_QUEUE, seedDemoConfiguration } from "./seed.js";
import { collectSeedProblems, readSeedSettings } from "./seed-env.js";
import { createTestPool, readTestDatabaseUrl } from "./test-database.js";

const serviceDir = fileURLToPath(new URL("../..", import.meta.url));
const demoTenantId = "tenant_demo";
const demoConfigurationId = "cfg_demo";
const seedEnvKeys = ["CONFIG_SERVICE_TOKEN", "DATABASE_URL", "DEMO_TENANT_ID", "DEMO_CONFIGURATION_ID"] as const;

/** Environment values from before this file mutates them. */
const originalSeedEnv = new Map<string, string | undefined>();

let pool: Pool | undefined;
let repository: ConfigurationRepository | undefined;

/**
 * Remembers the seed environment.
 *
 * Purpose: restore variables after a setup test mutates them.
 * Inputs: none.
 * Side effects: records the current values of the seed keys.
 */
function rememberSeedEnv(): void {
  // Snapshot only the keys this file writes.
  for (const key of seedEnvKeys) {
    originalSeedEnv.set(key, process.env[key]);
  }
}

/**
 * Puts the seed environment back.
 *
 * Purpose: keep one setup case from changing the next case.
 * Inputs: none.
 * Side effects: writes the original values back to process.env.
 */
function restoreSeedEnv(): void {
  // Replace each key, including an unset value.
  for (const [key, value] of originalSeedEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

/**
 * Applies one seed-environment case.
 *
 * Purpose: set only the variables that case names.
 * Inputs: values, the keys to set. An undefined entry leaves that key unset.
 * Side effects: mutates process.env until restoreSeedEnv runs.
 */
function applySeedEnv(values: Partial<Record<(typeof seedEnvKeys)[number], string | undefined>>): void {
  // Start from a clean set so a parent shell cannot satisfy a missing key.
  for (const key of seedEnvKeys) {
    delete process.env[key];
  }
  // Apply the case. Undefined leaves the key unset.
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Returns a complete seed environment for one case to override.
 *
 * Purpose: a refusal test changes one variable and leaves the others usable.
 * Inputs: none.
 * Side effects: none.
 */
function readySeedEnv(): Record<(typeof seedEnvKeys)[number], string> {
  // The token is not the example placeholder. The URL is not contacted by the parser tests.
  return {
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:5432/reactiv_test",
    DEMO_TENANT_ID: demoTenantId,
    DEMO_CONFIGURATION_ID: demoConfigurationId,
  };
}

/**
 * Reads image ids from a carousel section.
 *
 * Purpose: the seed test can name the fixed slide ids.
 * Inputs: section, the section that should be a carousel.
 * Side effects: throws when the section is missing or is not a carousel.
 */
function carouselImageIds(section: Section | undefined): string[] {
  // The demo order puts a carousel at the start and again after the first CTA.
  if (section === undefined || section.type !== "carousel") {
    throw new Error("Expected a carousel section.");
  }
  return section.images.map((image) => image.id);
}

/**
 * Asserts the stored demo document.
 *
 * Purpose: the row is the six-section fixture at the configured id, with revision 1.
 * Inputs: configuration, the row returned by the repository.
 * Side effects: none.
 */
function expectSixSectionDemo(configuration: Configuration): void {
  // The shared schema accepts the stored object, including its timestamp.
  expect(configurationSchema.parse(configuration)).toEqual(configuration);
  expect(configuration.id).toBe(demoConfigurationId);
  expect(configuration.schemaVersion).toBe(1);
  expect(configuration.revision).toBe(1);
  // The payload is the fixture built with the fixed id queue.
  expect(configuration.data).toEqual(createSeedDocument().data);
  expect(configuration.data.sections.map((section) => section.type)).toEqual([
    "carousel",
    "text",
    "cta",
    "carousel",
    "text",
    "cta",
  ]);
  expect(configuration.data.sections.map((section) => section.id)).toEqual([
    "section-carousel-1",
    "section-text-1",
    "section-cta-1",
    "section-carousel-2",
    "section-text-2",
    "section-cta-2",
  ]);
  // Slide ids are fixed too. They are not array indexes.
  expect(carouselImageIds(configuration.data.sections[0])).toEqual(["image-carousel-1-1", "image-carousel-1-2"]);
  expect(carouselImageIds(configuration.data.sections[3])).toEqual(["image-carousel-2-1", "image-carousel-2-2"]);
  // Titles, links, and aspect ratios are the shared fixture, checked without calling the seed helper.
  expectDemoFixtureFields(configuration.data);
}

/**
 * Asserts the demo copy, links, and aspect ratios.
 *
 * Purpose: the stored document is the shared fixture, not only a document that uses the fixed ids.
 * Inputs: data, the section list from a seed document or a stored row.
 * Side effects: throws when a section is missing or has the wrong type.
 */
function expectDemoFixtureFields(data: EditableDocument["data"]): void {
  const firstCarousel = data.sections[0];
  const firstText = data.sections[1];
  const firstCta = data.sections[2];
  const secondCarousel = data.sections[3];
  const secondText = data.sections[4];
  const secondCta = data.sections[5];
  // The two carousels are landscape, then portrait, with the fixture image URLs.
  if (firstCarousel?.type !== "carousel" || secondCarousel?.type !== "carousel") {
    throw new Error("Expected carousel sections.");
  }
  expect(firstCarousel.aspectRatio).toBe("landscape");
  expect(firstCarousel.images.map((image) => image.url)).toEqual([
    "https://example.com/demo/arrival-window.jpg",
    "https://example.com/demo/reading-table.jpg",
  ]);
  expect(secondCarousel.aspectRatio).toBe("portrait");
  expect(secondCarousel.images.map((image) => image.url)).toEqual([
    "https://example.com/demo/staff-stack.jpg",
    "https://example.com/demo/quiet-corner.jpg",
  ]);
  // The text blocks differ in title and description.
  if (firstText?.type !== "text" || secondText?.type !== "text") {
    throw new Error("Expected text sections.");
  }
  expect(firstText.title).toBe("New this week");
  expect(firstText.description).toBe("A short list from the front table.");
  expect(secondText.title).toBe("From the floor");
  expect(secondText.description).toBe("Notes from the people who unpack the boxes.");
  // The buttons differ in label and destination.
  if (firstCta?.type !== "cta" || secondCta?.type !== "cta") {
    throw new Error("Expected CTA sections.");
  }
  expect(firstCta.label).toBe("Continue");
  expect(firstCta.url).toBe("https://example.com/continue");
  expect(secondCta.label).toBe("See the list");
  expect(secondCta.url).toBe("https://example.com/list");
}

/**
 * Replaces the first text title.
 *
 * Purpose: a later edit that the second seed must leave in place.
 * Inputs: document, the stored demo document. The input is not changed.
 * Side effects: none.
 */
function withMerchantTitle(document: EditableDocument): EditableDocument {
  // Copy first so the stored object passed in stays on the previous title.
  const copy = structuredClone(document);
  const section = copy.data.sections[1];
  // The demo order is carousel, text, CTA. Index 1 is the first text block.
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected the first text section.");
  }
  section.title = "Merchant edit";
  return copy;
}

/**
 * Asserts the fixed queue is ten ids and then stops.
 *
 * Purpose: createDemoDocument's ten calls match the queue, and an extra call fails.
 * Inputs: none.
 * Side effects: none.
 */
function expectQueueStopsAfterTenIds(): void {
  const nextId = createDemoIdQueue();
  // Each call returns the next fixed id, in the documented order.
  for (const id of DEMO_DOCUMENT_ID_QUEUE) {
    expect(nextId()).toBe(id);
  }
  // An eleventh call is a fixture bug, not a generated UUID.
  expect(() => {
    nextId();
  }).toThrow(/fixed queue/);
}

/**
 * Asserts the placeholder token refuses the seed.
 *
 * Purpose: replace-me is not a credential, and the message does not print it.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectPlaceholderRefusesSeed(): void {
  // The database URL and the demo ids are present. The token is the only problem.
  applySeedEnv({
    ...readySeedEnv(),
    CONFIG_SERVICE_TOKEN: "replace-me",
  });
  const problems = collectSeedProblems();
  expect(problems).toEqual(["Invalid environment variable: CONFIG_SERVICE_TOKEN"]);
  expect(problems.join("\n")).not.toContain("replace-me");
}

/**
 * Asserts a blank demo tenant refuses the seed.
 *
 * Purpose: DEMO_TENANT_ID is required, and whitespace is blank.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectBlankTenantRefusesSeed(): void {
  // Spaces are not a tenant id.
  applySeedEnv({
    ...readySeedEnv(),
    DEMO_TENANT_ID: "   ",
  });
  expect(collectSeedProblems()).toEqual(["Missing required environment variable: DEMO_TENANT_ID"]);
}

/**
 * Asserts a blank demo configuration id refuses the seed.
 *
 * Purpose: DEMO_CONFIGURATION_ID is required.
 * Inputs: raw, the blank or unset configuration id.
 * Side effects: mutates process.env for the assertion.
 */
function expectBlankConfigurationIdRefusesSeed(raw: string | undefined): void {
  // The other required values are present so this id is the only problem.
  applySeedEnv({
    ...readySeedEnv(),
    DEMO_CONFIGURATION_ID: raw,
  });
  expect(collectSeedProblems()).toEqual(["Missing required environment variable: DEMO_CONFIGURATION_ID"]);
}

/**
 * Asserts a blank database URL refuses the seed.
 *
 * Purpose: the seed does not invent a connection string.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectBlankDatabaseUrlRefusesSeed(): void {
  // Whitespace is missing. The message does not include a sample URL.
  applySeedEnv({
    ...readySeedEnv(),
    DATABASE_URL: "   ",
  });
  const problems = collectSeedProblems();
  expect(problems).toEqual(["Missing required environment variable: DATABASE_URL"]);
  expect(problems.join("\n")).not.toContain("postgres://");
}

/**
 * Asserts a complete environment has no seed problems.
 *
 * Purpose: a real token and the demo ids are enough to pass the setup check.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectReadySeedEnv(): void {
  // A real token, a database URL, and both demo ids are present.
  applySeedEnv(readySeedEnv());
  expect(collectSeedProblems()).toEqual([]);
}

/**
 * Asserts the example file refuses the seed.
 *
 * Purpose: copying .env.example unchanged does not yield a working token.
 * Inputs: none. The values come from .env.example.
 * Side effects: mutates process.env for the assertion.
 */
function expectExampleFileRefusesSeed(): void {
  // Read the committed template. This does not copy it over the local .env file.
  const example = readDotEnv(join(repositoryRoot(), ".env.example"));
  const token = example.get("CONFIG_SERVICE_TOKEN");
  // The template token is the placeholder.
  expect(token).toBe("replace-me");
  applySeedEnv({
    CONFIG_SERVICE_TOKEN: token,
    DATABASE_URL: example.get("DATABASE_URL"),
    DEMO_TENANT_ID: example.get("DEMO_TENANT_ID"),
    DEMO_CONFIGURATION_ID: example.get("DEMO_CONFIGURATION_ID"),
  });
  const problems = collectSeedProblems();
  expect(problems).toEqual(["Invalid environment variable: CONFIG_SERVICE_TOKEN"]);
  expect(problems.join("\n")).not.toContain("replace-me");
  expect(problems.join("\n")).not.toContain("postgres://");
}

/**
 * Copies the process variables Node needs on Windows.
 *
 * Purpose: start the seed command without inheriting a parent database URL.
 * Inputs: overrides, variables to set. An undefined value leaves the key unset.
 * Side effects: none.
 */
function childEnv(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Keep the operating-system paths required to spawn Node. Do not copy service URLs.
  for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "ComSpec", "TEMP", "TMP", "USERPROFILE"]) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * Runs the seed command and collects its output.
 *
 * Purpose: observe the exit code and text of `pnpm db:seed` without a shell wrapper.
 * Inputs: overrides, the child environment on top of the Windows path variables.
 * Side effects: spawns a process and kills it if it is still running after 15 seconds.
 */
function runSeed(overrides: Record<string, string | undefined>): Promise<{ code: number | null; output: string }> {
  // The executor starts the child and resolves when that process exits.
  return new Promise(finishRun);

  /**
   * Starts the child and resolves when it exits.
   *
   * Purpose: collect stdout and stderr for one assertion.
   * Inputs: resolve, the promise resolver.
   * Side effects: spawns the seed command.
   */
  function finishRun(resolve: (result: { code: number | null; output: string }) => void): void {
    let collected = "";
    const child = spawn(process.execPath, ["--import", "tsx", "src/db/seed-cli.ts"], {
      cwd: serviceDir,
      env: childEnv(overrides),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // The report goes to stdout. Setup and SQL errors go to stderr.
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", appendChunk);
    child.stderr?.on("data", appendChunk);
    const timer = setTimeout(() => {
      child.kill();
    }, 15000);
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolve({ code: exitCode, output: collected });
    });

    /**
     * Appends one chunk of command output.
     *
     * Purpose: keep both streams in one string.
     * Inputs: chunk, the encoded text from the child.
     * Side effects: appends to the closed-over output.
     */
    function appendChunk(chunk: string): void {
      collected += chunk;
    }
  }
}

/**
 * Asserts the seed command exits before connecting when setup is incomplete.
 *
 * Purpose: replace-me and blank demo ids are reported together, and the database is not contacted.
 * Inputs: none.
 * Side effects: spawns the seed command against a closed port that it must not dial.
 */
async function expectCliReportsEverySetupProblem(): Promise<void> {
  const result = await runSeed({
    CONFIG_SERVICE_TOKEN: "replace-me",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:1/reactiv_test",
    DEMO_TENANT_ID: "   ",
    DEMO_CONFIGURATION_ID: "   ",
  });
  // Every gap is named. A connection error would mean the checks ran too late.
  expect(result.code).toBe(1);
  expect(result.output).toContain("Invalid environment variable: CONFIG_SERVICE_TOKEN");
  expect(result.output).toContain("Missing required environment variable: DEMO_TENANT_ID");
  expect(result.output).toContain("Missing required environment variable: DEMO_CONFIGURATION_ID");
  expect(result.output).not.toContain("replace-me");
  expect(result.output).not.toContain("postgres://");
  expect(result.output).not.toContain("ECONNREFUSED");
}

/**
 * Asserts two seed documents match and do not share section arrays.
 *
 * Purpose: each call starts a new id queue, and editing one document leaves the next one on the fixture.
 * Inputs: none.
 * Side effects: none.
 */
function expectSeedDocumentsAreIndependent(): void {
  const first = createSeedDocument();
  const second = createSeedDocument();
  // The same queue produces the same document, including the fixture copy.
  expect(second).toEqual(first);
  expectDemoFixtureFields(first.data);
  const section = first.data.sections[1];
  // Change the first document after the second one was built.
  if (section === undefined || section.type !== "text") {
    throw new Error("Expected the first text section.");
  }
  section.title = "Changed";
  const third = createSeedDocument();
  // The earlier copy and a later build stay on the fixture title.
  expect(second.data.sections[1]).toMatchObject({ type: "text", title: "New this week" });
  expect(third.data.sections[1]).toMatchObject({ type: "text", title: "New this week" });
}

/**
 * Asserts a missing token refuses the seed.
 *
 * Purpose: an unset token is not replaced with a built-in credential.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectMissingTokenRefusesSeed(): void {
  // The database URL and the demo ids are present. The token is the only gap.
  const ready = readySeedEnv();
  applySeedEnv({
    DATABASE_URL: ready.DATABASE_URL,
    DEMO_TENANT_ID: ready.DEMO_TENANT_ID,
    DEMO_CONFIGURATION_ID: ready.DEMO_CONFIGURATION_ID,
  });
  expect(collectSeedProblems()).toEqual(["Missing required environment variable: CONFIG_SERVICE_TOKEN"]);
}

/**
 * Asserts padding around the placeholder refuses the seed.
 *
 * Purpose: spaces do not turn replace-me into a credential, and the message does not print it.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectPaddedPlaceholderRefusesSeed(): void {
  // Trimmed, the token is still the example placeholder.
  applySeedEnv({
    ...readySeedEnv(),
    CONFIG_SERVICE_TOKEN: "  replace-me  ",
  });
  const problems = collectSeedProblems();
  expect(problems).toEqual(["Invalid environment variable: CONFIG_SERVICE_TOKEN"]);
  expect(problems.join("\n")).not.toContain("replace-me");
}

/**
 * Asserts a longer token that contains the placeholder text is accepted.
 *
 * Purpose: the refusal is the exact example value, not a substring.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectLongerTokenAllowsSeed(): void {
  // This credential only contains the placeholder text. It is a different value.
  applySeedEnv({
    ...readySeedEnv(),
    CONFIG_SERVICE_TOKEN: "replace-me-extra",
  });
  expect(collectSeedProblems()).toEqual([]);
}

/**
 * Asserts every missing seed setting is named, in check order.
 *
 * Purpose: one gap does not hide the others, and the text does not invent a credential.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectEverySeedGapIsNamed(): void {
  applySeedEnv({});
  const problems = collectSeedProblems();
  expect(problems).toEqual([
    "Missing required environment variable: CONFIG_SERVICE_TOKEN",
    "Missing required environment variable: DATABASE_URL",
    "Missing required environment variable: DEMO_TENANT_ID",
    "Missing required environment variable: DEMO_CONFIGURATION_ID",
  ]);
  expect(problems.join("\n")).not.toContain("replace-me");
  expect(problems.join("\n")).not.toContain("postgres://");
}

/**
 * Asserts seed settings keep the original text.
 *
 * Purpose: surrounding spaces stay, including in a database URL.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectSeedSettingsKeepTheOriginalText(): void {
  const databaseUrl = " postgres://reactiv:reactiv@127.0.0.1:5432/reactiv_test ";
  const tenantId = " tenant_demo ";
  const configurationId = " cfg_demo ";
  applySeedEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: databaseUrl,
    DEMO_TENANT_ID: tenantId,
    DEMO_CONFIGURATION_ID: configurationId,
  });
  // The values are present, so the problem list is empty.
  expect(collectSeedProblems()).toEqual([]);
  expect(readSeedSettings()).toEqual({
    databaseUrl,
    tenantId,
    configurationId,
  });
}

/**
 * Asserts reading seed settings before the checks fails closed.
 *
 * Purpose: a blank tenant throws a stable message that does not include the database URL.
 * Inputs: none.
 * Side effects: mutates process.env for the assertion.
 */
function expectSeedSettingsRefuseAnUncheckedEnvironment(): void {
  applySeedEnv({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:secret-db-password@127.0.0.1:5432/reactiv_test",
    DEMO_TENANT_ID: "   ",
    DEMO_CONFIGURATION_ID: "cfg_private",
  });
  // The message names the programming mistake. It does not repeat the URL or the id.
  expect(() => {
    readSeedSettings();
  }).toThrow(/^Seed settings were read before the environment was checked\.$/);
}

/**
 * Builds a repository whose insert loses a race.
 *
 * Purpose: the seed can see a miss and then a unique violation without a second writer.
 * Inputs: none.
 * Side effects: none until a method runs. Update changes the closed-over revision.
 */
function createConflictRepository(): {
  repository: ConfigurationRepository;
  revision: () => number;
} {
  let revision = 7;

  /**
   * Reports a miss.
   *
   * Purpose: the seed proceeds to insert, as it would if the row appeared between the two calls.
   * Inputs: none. The lookup values are ignored.
   * Side effects: none.
   */
  async function getConfiguration(): Promise<GetConfigurationResult> {
    // The row is not visible yet. The insert is where the race is decided.
    return { ok: false, reason: "not-found" };
  }

  /**
   * Reports that another writer stored the id.
   *
   * Purpose: the losing insert must not be treated as a new demo row.
   * Inputs: none. The document is ignored.
   * Side effects: none. The stored revision stays where it was.
   */
  async function insertConfiguration(): Promise<InsertConfigurationResult> {
    // Unique violation rolls the insert back. This stub does that without a database.
    return { ok: false, reason: "unique-violation" };
  }

  /**
   * Records an unexpected update.
   *
   * Purpose: a seed that updates after losing the race changes this revision.
   * Inputs: none. The update values are ignored.
   * Side effects: increments the closed-over revision.
   */
  async function updateConfiguration(): Promise<UpdateConfigurationResult> {
    // A real update would replace the winner. Count that as a changed revision.
    revision += 1;
    return {
      ok: false,
      reason: "revision-conflict",
    };
  }

  return {
    repository: {
      getConfiguration,
      insertConfiguration,
      updateConfiguration,
    },
    /**
     * Returns the revision the winner still has.
     *
     * Purpose: the assertion reads it after the seed returns.
     * Inputs: none.
     * Side effects: none.
     */
    revision(): number {
      return revision;
    },
  };
}

/**
 * Asserts a lost insert leaves the winning row alone.
 *
 * Purpose: unique violation is not a second write and is not reported as a new insert.
 * Inputs: none.
 * Side effects: none.
 */
async function expectUniqueViolationLeavesTheWinner(): Promise<void> {
  const conflict = createConflictRepository();
  const outcome = await seedDemoConfiguration(conflict.repository, {
    tenantId: demoTenantId,
    configurationId: demoConfigurationId,
  });
  // The other writer keeps revision 7. This seed does not claim it inserted the demo.
  expect(outcome).toBe("left-existing");
  expect(conflict.revision()).toBe(7);
}

/**
 * Builds a repository whose insert fails.
 *
 * Purpose: a database error must reject the seed instead of looking like a successful no-op.
 * Inputs: none.
 * Side effects: none until insert runs.
 */
function createFailingInsertRepository(): ConfigurationRepository {
  /**
   * Reports a miss so the seed tries to insert.
   *
   * Purpose: the failure happens on the write, not on the lookup.
   * Inputs: none.
   * Side effects: none.
   */
  async function getConfiguration(): Promise<GetConfigurationResult> {
    return { ok: false, reason: "not-found" };
  }

  /**
   * Fails the write.
   *
   * Purpose: the seed should surface this error.
   * Inputs: none.
   * Side effects: throws.
   */
  async function insertConfiguration(): Promise<InsertConfigurationResult> {
    throw new Error("database unavailable");
  }

  /**
   * Rejects an update during a failed insert.
   *
   * Purpose: the seed has no row to update when the insert did not commit.
   * Inputs: none.
   * Side effects: throws.
   */
  async function updateConfiguration(): Promise<UpdateConfigurationResult> {
    throw new Error("update should not be called");
  }

  return {
    getConfiguration,
    insertConfiguration,
    updateConfiguration,
  };
}

/**
 * Asserts an insert failure is not reported as leaving a row alone.
 *
 * Purpose: the command must not exit 0 when the database rejects the write.
 * Inputs: none.
 * Side effects: none.
 */
async function expectInsertFailureIsNotSuccess(): Promise<void> {
  // The message is the database failure, not the no-op report.
  await expect(
    seedDemoConfiguration(createFailingInsertRepository(), {
      tenantId: demoTenantId,
      configurationId: demoConfigurationId,
    }),
  ).rejects.toThrow("database unavailable");
}

rememberSeedEnv();

describe("seed setup", () => {
  afterEach(restoreSeedEnv);

  it("issues the fixed ids and then stops", expectQueueStopsAfterTenIds);
  it("builds two independent copies of the fixture", expectSeedDocumentsAreIndependent);
  it("refuses the example placeholder", expectPlaceholderRefusesSeed);
  it("refuses a missing token", expectMissingTokenRefusesSeed);
  it("refuses a padded example placeholder", expectPaddedPlaceholderRefusesSeed);
  it("accepts a token that only contains the placeholder text", expectLongerTokenAllowsSeed);
  it("refuses a blank demo tenant", expectBlankTenantRefusesSeed);
  it("refuses a blank demo configuration id", () => {
    expectBlankConfigurationIdRefusesSeed("   ");
  });
  it("refuses a missing demo configuration id", () => {
    expectBlankConfigurationIdRefusesSeed(undefined);
  });
  it("refuses a blank database URL", expectBlankDatabaseUrlRefusesSeed);
  it("names every missing seed setting", expectEverySeedGapIsNamed);
  it("accepts a real token and the demo ids", expectReadySeedEnv);
  it("keeps spaces in the seed settings", expectSeedSettingsKeepTheOriginalText);
  it("refuses to read seed settings before the checks pass", expectSeedSettingsRefuseAnUncheckedEnvironment);
  it("refuses the example file when it is copied unchanged", expectExampleFileRefusesSeed);
  it("leaves the winning row alone when the insert loses a race", expectUniqueViolationLeavesTheWinner);
  it("rejects an insert failure instead of reporting success", expectInsertFailureIsNotSuccess);
  it("exits before connecting when setup is incomplete", expectCliReportsEverySetupProblem, 15_000);
});

/**
 * Returns the open test pool.
 *
 * Purpose: fail a helper that runs before the database is open.
 * Inputs: none.
 * Side effects: none.
 */
function requirePool(): Pool {
  // beforeAll assigns the pool. A missing pool means the hook did not finish.
  if (pool === undefined) {
    throw new Error("The test database pool is not open.");
  }
  return pool;
}

/**
 * Returns the repository for reactiv_test.
 *
 * Purpose: seed tests write through the same repository the service uses.
 * Inputs: none.
 * Side effects: none.
 */
function requireRepository(): ConfigurationRepository {
  // The repository closes over the test pool.
  if (repository === undefined) {
    throw new Error("The configuration repository is not open.");
  }
  return repository;
}

/**
 * Reads DATABASE_URL_TEST and requires the test database name.
 *
 * Purpose: the seed command test must not write the dev database.
 * Inputs: DATABASE_URL_TEST from the environment or .env.
 * Side effects: reads .env when the variable is unset.
 */
function requireTestDatabaseUrl(): string {
  const url = readTestDatabaseUrl();
  // The pathname is "/reactiv_test". Any other name would seed the wrong database.
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (name !== "reactiv_test") {
    throw new Error("DATABASE_URL_TEST must point at the reactiv_test database.");
  }
  return url;
}

/**
 * Opens reactiv_test for the seed tests.
 *
 * Purpose: run the seed against the test database with migrations already applied.
 * Inputs: DATABASE_URL_TEST from the environment or .env.
 * Side effects: creates the test database when it is missing and migrates it.
 */
async function openDatabase(): Promise<void> {
  // The same pool the HTTP tests use. This file deletes only the demo row.
  pool = await createTestPool();
  repository = createConfigurationRepository(pool);
}

/**
 * Deletes the demo row and closes the pool.
 *
 * Purpose: leave reactiv_test without this file's demo configuration.
 * Inputs: none.
 * Side effects: deletes one row and ends the pool when it was opened.
 */
async function closeDatabase(): Promise<void> {
  // A failed beforeAll leaves the pool unset. There is nothing to close.
  if (pool === undefined) {
    return;
  }
  await pool.query("DELETE FROM configurations WHERE tenant_id = $1 AND id = $2", [demoTenantId, demoConfigurationId]);
  await pool.end();
  pool = undefined;
  repository = undefined;
}

/**
 * Deletes the demo row.
 *
 * Purpose: each test starts with that id absent.
 * Inputs: none.
 * Side effects: deletes one tenant-scoped row.
 */
async function deleteDemoRow(): Promise<void> {
  // Bound both keys. Do not delete another file's rows.
  await requirePool().query("DELETE FROM configurations WHERE tenant_id = $1 AND id = $2", [
    demoTenantId,
    demoConfigurationId,
  ]);
}

/**
 * Loads the demo row.
 *
 * Purpose: read the configuration the seed just stored.
 * Inputs: none. The tenant and id are the configured demo values.
 * Side effects: reads one row. Throws when the row is absent.
 */
async function loadStored(): Promise<Configuration> {
  const found = await requireRepository().getConfiguration({
    tenantId: demoTenantId,
    id: demoConfigurationId,
  });
  // A miss means the seed did not insert. The assertion stops here.
  if (!found.ok) {
    throw new Error("The demo configuration was not stored.");
  }
  return found.configuration;
}

/**
 * Counts rows for one configuration id.
 *
 * Purpose: show that a GET miss did not insert any row with that id.
 * Inputs: id, the configuration id to count across tenants.
 * Side effects: reads one aggregate.
 */
async function countById(id: string): Promise<number> {
  const result = await requirePool().query<{ count: number | string }>(
    "SELECT count(*)::int AS count FROM configurations WHERE id = $1",
    [id],
  );
  const count = result.rows.at(0)?.count ?? 0;
  // int4 may arrive as a number. A string still parses as the same count.
  return Number(count);
}

/**
 * Drops log chunks.
 *
 * Purpose: keep Fastify logs out of the test output.
 * Inputs: none. The chunk is ignored.
 * Side effects: none.
 */
function ignoreLogChunk(): void {
  // The listener exists so the stream does not buffer every line.
}

/**
 * Opens a server for one assertion and closes it afterward.
 *
 * Purpose: call GET without binding a port.
 * Inputs: storage, the repository under test. run, the assertions.
 * Side effects: creates and closes a Fastify instance.
 */
async function withApp(
  storage: ConfigurationRepository,
  run: (app: FastifyInstance) => Promise<void>,
): Promise<void> {
  // Discard logs so a request id is not mixed into the assertion output.
  const stream = new PassThrough();
  stream.on("data", ignoreLogChunk);
  const app = buildServer("@reactiv/contracts", stream, {
    repository: storage,
    writeRateLimitPerMinute: 600,
  });
  try {
    await run(app);
  } finally {
    // Close the server even when an assertion fails.
    await app.close();
  }
}

/**
 * Wraps a repository and counts writes.
 *
 * Purpose: prove GET does not call insert or update.
 * Inputs: inner, the real repository.
 * Side effects: none until a method runs.
 */
function watchWrites(inner: ConfigurationRepository): {
  repository: ConfigurationRepository;
  inserts: () => number;
  updates: () => number;
} {
  // Both counters start at zero. GET should leave them there.
  let insertCalls = 0;
  let updateCalls = 0;

  /**
   * Counts an insert and forwards it.
   *
   * Purpose: a GET that inserts increments this counter.
   * Inputs: input, the insert values.
   * Side effects: inserts only when the caller asked to insert.
   */
  async function insertConfiguration(
    input: Parameters<ConfigurationRepository["insertConfiguration"]>[0],
  ): ReturnType<ConfigurationRepository["insertConfiguration"]> {
    // Count before the write so a thrown insert is still visible.
    insertCalls += 1;
    return inner.insertConfiguration(input);
  }

  /**
   * Forwards a read.
   *
   * Purpose: GET still loads through the real repository.
   * Inputs: input, the tenant and id.
   * Side effects: reads one row.
   */
  function getConfiguration(
    input: Parameters<ConfigurationRepository["getConfiguration"]>[0],
  ): ReturnType<ConfigurationRepository["getConfiguration"]> {
    // A miss stays a miss. This wrapper does not insert.
    return inner.getConfiguration(input);
  }

  /**
   * Counts an update and forwards it.
   *
   * Purpose: a GET that updates increments this counter.
   * Inputs: input, the conditional update values.
   * Side effects: updates only when the caller asked to update.
   */
  async function updateConfiguration(
    input: Parameters<ConfigurationRepository["updateConfiguration"]>[0],
  ): ReturnType<ConfigurationRepository["updateConfiguration"]> {
    // Count before the write so a thrown update is still visible.
    updateCalls += 1;
    return inner.updateConfiguration(input);
  }

  return {
    repository: {
      insertConfiguration,
      getConfiguration,
      updateConfiguration,
    },
    /**
     * Returns how many inserts this wrapper saw.
     *
     * Purpose: the GET assertion reads the counter after the request.
     * Inputs: none.
     * Side effects: none.
     */
    inserts(): number {
      // This is the number of insert calls, not the number of stored rows.
      return insertCalls;
    },
    /**
     * Returns how many updates this wrapper saw.
     *
     * Purpose: the GET assertion reads the counter after the request.
     * Inputs: none.
     * Side effects: none.
     */
    updates(): number {
      // This is the number of update calls, not the number of stored rows.
      return updateCalls;
    },
  };
}

/**
 * Asserts an empty database receives the six-section demo row.
 *
 * Purpose: the seed inserts DEMO_CONFIGURATION_ID for DEMO_TENANT_ID at revision 1.
 * Inputs: none.
 * Side effects: inserts one row. Cleanup deletes it.
 */
async function expectEmptyDatabaseReceivesTheDemo(): Promise<void> {
  const outcome = await seedDemoConfiguration(requireRepository(), {
    tenantId: demoTenantId,
    configurationId: demoConfigurationId,
  });
  // The first run writes the row. It does not update a row that was already there.
  expect(outcome).toBe("inserted");
  const stored = await loadStored();
  expectSixSectionDemo(stored);
  const tenant = await requirePool().query<{ tenant_id: string }>(
    "SELECT tenant_id FROM configurations WHERE tenant_id = $1 AND id = $2",
    [demoTenantId, demoConfigurationId],
  );
  // The row belongs to the demo tenant. The document itself has no tenant field.
  expect(tenant.rows).toEqual([{ tenant_id: demoTenantId }]);
  expect(stored).not.toHaveProperty("tenantId");
}

/**
 * Asserts a second seed leaves revision and updatedAt unchanged.
 *
 * Purpose: running the seed twice does not reset the row.
 * Inputs: none.
 * Side effects: inserts one row, then reads it again. Cleanup deletes it.
 */
async function expectSecondSeedLeavesTheRow(): Promise<void> {
  const firstOutcome = await seedDemoConfiguration(requireRepository(), {
    tenantId: demoTenantId,
    configurationId: demoConfigurationId,
  });
  expect(firstOutcome).toBe("inserted");
  const first = await loadStored();
  const secondOutcome = await seedDemoConfiguration(requireRepository(), {
    tenantId: demoTenantId,
    configurationId: demoConfigurationId,
  });
  // The second run finds the row and does not write.
  expect(secondOutcome).toBe("left-existing");
  const second = await loadStored();
  expect(second.revision).toBe(first.revision);
  expect(second.updatedAt).toBe(first.updatedAt);
  expect(second).toEqual(first);
}

/**
 * Asserts a later edit survives a second seed.
 *
 * Purpose: the seed must not reset a merchant's document back to revision 1.
 * Inputs: none.
 * Side effects: inserts one row, updates it, then runs the seed again. Cleanup deletes it.
 */
async function expectSeedLeavesAMerchantEdit(): Promise<void> {
  const inserted = await seedDemoConfiguration(requireRepository(), {
    tenantId: demoTenantId,
    configurationId: demoConfigurationId,
  });
  expect(inserted).toBe("inserted");
  const stored = await loadStored();
  const edited = withMerchantTitle({
    schemaVersion: stored.schemaVersion,
    data: stored.data,
  });
  const updated = await requireRepository().updateConfiguration({
    tenantId: demoTenantId,
    id: demoConfigurationId,
    expectedRevision: stored.revision,
    document: edited,
  });
  // The edit committed. The next seed has to see this revision, not revision 1.
  if (!updated.ok) {
    throw new Error("The merchant edit was not stored.");
  }
  const outcome = await seedDemoConfiguration(requireRepository(), {
    tenantId: demoTenantId,
    configurationId: demoConfigurationId,
  });
  expect(outcome).toBe("left-existing");
  const after = await loadStored();
  expect(after).toEqual(updated.configuration);
  expect(after.revision).toBe(2);
  const text = after.data.sections[1];
  // The title is the merchant's text, not the fixture title.
  if (text === undefined || text.type !== "text") {
    throw new Error("Expected the first text section.");
  }
  expect(text.title).toBe("Merchant edit");
}

/**
 * Asserts GET of a missing id does not insert the demo row.
 *
 * Purpose: a failed load is not a reason to seed.
 * Inputs: none.
 * Side effects: sends one GET. Cleanup deletes the demo row if a bug inserted it.
 */
async function expectGetMissDoesNotInsert(): Promise<void> {
  const token = "secret-token-value";
  const previousToken = process.env.CONFIG_SERVICE_TOKEN;
  const previousTenant = process.env.DEMO_TENANT_ID;
  // The route reads the tenant from the environment after the bearer token matches.
  process.env.CONFIG_SERVICE_TOKEN = token;
  process.env.DEMO_TENANT_ID = demoTenantId;
  const watched = watchWrites(requireRepository());
  const before = await countById(demoConfigurationId);
  const tablesBefore = await countPublicTables();
  const migrationsBefore = await countMigrationRows();
  try {
    await withApp(watched.repository, async (app) => {
      const response = await app.inject({
        method: "GET",
        url: `/v1/configurations/${demoConfigurationId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      const body = errorBodySchema.parse(response.json());
      // The miss is 404. The body is not a demo document.
      expect(response.statusCode).toBe(404);
      expect(body.error.code).toBe("NOT_FOUND");
      expect(response.body).not.toContain("section-carousel-1");
      expect(response.body).not.toContain("sections");
    });
    // No insert and no update ran, and the id count did not grow.
    expect(watched.inserts()).toBe(0);
    expect(watched.updates()).toBe(0);
    expect(await countById(demoConfigurationId)).toBe(before);
    // A miss does not create a table or record a migration.
    expect(await countPublicTables()).toBe(tablesBefore);
    expect(await countMigrationRows()).toBe(migrationsBefore);
  } finally {
    // Put the parent environment back. The child seed command does not use it.
    if (previousToken === undefined) {
      delete process.env.CONFIG_SERVICE_TOKEN;
    } else {
      process.env.CONFIG_SERVICE_TOKEN = previousToken;
    }
    if (previousTenant === undefined) {
      delete process.env.DEMO_TENANT_ID;
    } else {
      process.env.DEMO_TENANT_ID = previousTenant;
    }
  }
}

/**
 * Asserts the seed command inserts once and then leaves the row alone.
 *
 * Purpose: `pnpm db:seed` prints which of those happened and exits 0 both times.
 * Inputs: none. The child uses DATABASE_URL_TEST as its DATABASE_URL.
 * Side effects: spawns the command twice and inserts one row. Cleanup deletes it.
 */
async function expectCliSeedTwiceLeavesTheRow(): Promise<void> {
  const databaseUrl = requireTestDatabaseUrl();
  const base = {
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: databaseUrl,
    DEMO_TENANT_ID: demoTenantId,
    DEMO_CONFIGURATION_ID: demoConfigurationId,
  };
  const first = await runSeed(base);
  // The first command inserts and does not print the connection string.
  expect(first.code).toBe(0);
  expect(first.output).toContain("Inserted the demo configuration.");
  expect(first.output).not.toContain("postgres://");
  expect(first.output).not.toContain("local-service-token");
  const stored = await loadStored();
  expectSixSectionDemo(stored);
  const second = await runSeed(base);
  // The second command exits 0 and does not write a new revision.
  expect(second.code).toBe(0);
  expect(second.output).toContain("Left the existing row alone.");
  expect(second.output).not.toContain("Inserted the demo configuration.");
  const again = await loadStored();
  expect(again.revision).toBe(stored.revision);
  expect(again.updatedAt).toBe(stored.updatedAt);
  expect(again).toEqual(stored);
}

/**
 * Counts public tables.
 *
 * Purpose: show that a request did not create a table.
 * Inputs: none.
 * Side effects: reads one catalog aggregate.
 */
async function countPublicTables(): Promise<number> {
  const result = await requirePool().query<{ count: number | string }>(
    "SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'",
  );
  // int4 may arrive as a number. A string still parses as the same count.
  return Number(result.rows.at(0)?.count ?? 0);
}

/**
 * Counts applied migration filenames.
 *
 * Purpose: show that a request did not record a migration.
 * Inputs: none.
 * Side effects: reads one aggregate.
 */
async function countMigrationRows(): Promise<number> {
  const result = await requirePool().query<{ count: number | string }>(
    "SELECT count(*)::int AS count FROM schema_migrations",
  );
  // int4 may arrive as a number. A string still parses as the same count.
  return Number(result.rows.at(0)?.count ?? 0);
}

/**
 * Rewrites a Postgres URL onto another database on the same server.
 *
 * Purpose: open the maintenance database or an empty probe database.
 * Inputs: connectionString, the test URL. database, the database name to open.
 * Side effects: none.
 */
function urlForDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  // Keep the user, password, host, and port. Change only the database name.
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Asserts two overlapping seeds leave one revision-1 fixture.
 *
 * Purpose: a unique violation during the race does not update the row or fail the seed.
 * Inputs: none.
 * Side effects: inserts one row. Cleanup deletes it.
 */
async function expectParallelSeedsLeaveOneRow(): Promise<void> {
  const target = {
    tenantId: demoTenantId,
    configurationId: demoConfigurationId,
  };
  const [first, second] = await Promise.all([
    seedDemoConfiguration(requireRepository(), target),
    seedDemoConfiguration(requireRepository(), target),
  ]);
  // One call inserts. The other finds the row, or loses the insert, and leaves it.
  expect([first, second].sort()).toEqual(["inserted", "left-existing"]);
  const stored = await loadStored();
  expectSixSectionDemo(stored);
  expect(await countById(demoConfigurationId)).toBe(1);
}

/**
 * Asserts the demo seed does not change another tenant's copy of the same id.
 *
 * Purpose: the lookup is tenant plus id. Another tenant's row is not the demo row.
 * Inputs: none.
 * Side effects: inserts two rows. Cleanup deletes both.
 */
async function expectSeedLeavesAnotherTenantsRow(): Promise<void> {
  const otherTenantId = "tenant_seed_other";
  const otherDocument = withMerchantTitle(createSeedDocument());
  try {
    const otherInserted = await requireRepository().insertConfiguration({
      tenantId: otherTenantId,
      id: demoConfigurationId,
      document: otherDocument,
    });
    if (!otherInserted.ok) {
      throw new Error("The other tenant's row was not stored.");
    }
    const outcome = await seedDemoConfiguration(requireRepository(), {
      tenantId: demoTenantId,
      configurationId: demoConfigurationId,
    });
    // The demo tenant gets its own row. The other tenant keeps the edited title and revision 1.
    expect(outcome).toBe("inserted");
    expectSixSectionDemo(await loadStored());
    const other = await requireRepository().getConfiguration({
      tenantId: otherTenantId,
      id: demoConfigurationId,
    });
    expect(other).toEqual({ ok: true, configuration: otherInserted.configuration });
  } finally {
    await requirePool().query("DELETE FROM configurations WHERE tenant_id = $1 AND id = $2", [
      otherTenantId,
      demoConfigurationId,
    ]);
  }
}

/**
 * Asserts a different id for the same tenant is not treated as the demo row.
 *
 * Purpose: seeding the demo id still inserts when this tenant already has another configuration.
 * Inputs: none.
 * Side effects: inserts two rows. Cleanup deletes the neighbor.
 */
async function expectSeedLeavesAnotherConfiguration(): Promise<void> {
  const neighborId = "cfg_seed_neighbor";
  const neighborDocument = withMerchantTitle(createSeedDocument());
  try {
    const neighbor = await requireRepository().insertConfiguration({
      tenantId: demoTenantId,
      id: neighborId,
      document: neighborDocument,
    });
    if (!neighbor.ok) {
      throw new Error("The neighbor configuration was not stored.");
    }
    const outcome = await seedDemoConfiguration(requireRepository(), {
      tenantId: demoTenantId,
      configurationId: demoConfigurationId,
    });
    expect(outcome).toBe("inserted");
    expectSixSectionDemo(await loadStored());
    const stillThere = await requireRepository().getConfiguration({
      tenantId: demoTenantId,
      id: neighborId,
    });
    // The neighbor keeps its title, revision, and timestamp.
    expect(stillThere).toEqual({ ok: true, configuration: neighbor.configuration });
  } finally {
    await requirePool().query("DELETE FROM configurations WHERE tenant_id = $1 AND id = $2", [
      demoTenantId,
      neighborId,
    ]);
  }
}

/**
 * Asserts a blank shell database URL is not replaced by .env.
 *
 * Purpose: the seed must not fall through to the file and write the dev database.
 * Inputs: none.
 * Side effects: spawns the seed command, which exits before connecting.
 */
async function expectCliBlankDatabaseUrlDoesNotUseTheFile(): Promise<void> {
  const result = await runSeed({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "   ",
    DEMO_TENANT_ID: demoTenantId,
    DEMO_CONFIGURATION_ID: demoConfigurationId,
  });
  // The blank shell value is the one that counts. The file's URL is not used.
  expect(result.code).toBe(1);
  expect(result.output).toContain("Missing required environment variable: DATABASE_URL");
  expect(result.output).not.toContain("postgres://");
  expect(result.output).not.toContain("ECONNREFUSED");
  expect(result.output).not.toContain("Inserted the demo configuration.");
}

/**
 * Asserts a blank shell token is missing and does not connect.
 *
 * Purpose: padding is not a credential, and .env must not replace a blank shell token.
 * Inputs: none.
 * Side effects: spawns the seed command against a closed port that it must not dial.
 */
async function expectCliBlankTokenDoesNotConnect(): Promise<void> {
  // The closed port would refuse a connection if the blank token were ignored.
  const result = await runSeed({
    CONFIG_SERVICE_TOKEN: "   ",
    DATABASE_URL: "postgres://reactiv:reactiv@127.0.0.1:1/reactiv_test",
    DEMO_TENANT_ID: demoTenantId,
    DEMO_CONFIGURATION_ID: demoConfigurationId,
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain("Missing required environment variable: CONFIG_SERVICE_TOKEN");
  expect(result.output).not.toContain("ECONNREFUSED");
  expect(result.output).not.toContain("postgres://");
}

/**
 * Asserts a connection failure does not print the password.
 *
 * Purpose: the seed reports the driver error without echoing DATABASE_URL.
 * Inputs: none.
 * Side effects: attempts a connection to a closed port.
 */
async function expectCliConnectionFailureHidesThePassword(): Promise<void> {
  // The password is only in the connection string. The report must leave it out.
  const result = await runSeed({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DATABASE_URL: "postgres://reactiv:super-secret-password@127.0.0.1:1/reactiv_test",
    DEMO_TENANT_ID: demoTenantId,
    DEMO_CONFIGURATION_ID: demoConfigurationId,
  });
  expect(result.code).toBe(1);
  expect(result.output.includes("super-secret-password")).toBe(false);
  expect(result.output.includes("postgres://")).toBe(false);
  expect(result.output).not.toContain("Inserted the demo configuration.");
  expect(result.output).not.toContain("Left the existing row alone.");
}

/**
 * Asserts an unset database URL is taken from .env.
 *
 * Purpose: `pnpm db:seed` can use the uncommitted file, and the report hides the URL.
 * Inputs: none. The child leaves DATABASE_URL unset so the file supplies it.
 * Side effects: runs the seed against the database named in .env. An existing demo row is left alone.
 */
async function expectCliUnsetUrlUsesTheEnvFile(): Promise<void> {
  const result = await runSeed({
    CONFIG_SERVICE_TOKEN: "local-service-token",
    DEMO_TENANT_ID: demoTenantId,
    DEMO_CONFIGURATION_ID: demoConfigurationId,
  });
  // The file's database is reachable. The report is one of the two seed lines, without the URL.
  expect(result.code).toBe(0);
  expect(result.output.includes("postgres://")).toBe(false);
  expect(result.output).not.toContain("local-service-token");
  const inserted = result.output.includes("Inserted the demo configuration.");
  const leftAlone = result.output.includes("Left the existing row alone.");
  expect(inserted || leftAlone).toBe(true);
}

/**
 * Drops the empty probe database.
 *
 * Purpose: leave the server without reactiv_seed_probe after the assertion.
 * Inputs: adminUrl, a connection string for the maintenance database.
 * Side effects: drops that database when it exists.
 */
async function dropProbeDatabase(adminUrl: string): Promise<void> {
  const admin = new Pool({
    connectionString: adminUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    // FORCE closes a leftover session so the drop can finish.
    await admin.query("DROP DATABASE IF EXISTS reactiv_seed_probe WITH (FORCE)");
  } finally {
    await admin.end();
  }
}

/**
 * Asserts the seed does not create tables when the database is empty.
 *
 * Purpose: a missing configurations table is an error, not a reason to migrate.
 * Inputs: none.
 * Side effects: creates and drops reactiv_seed_probe. Spawns the seed command.
 */
async function expectSeedDoesNotCreateTables(): Promise<void> {
  const testUrl = requireTestDatabaseUrl();
  const adminUrl = urlForDatabase(testUrl, "reactiv");
  const probeUrl = urlForDatabase(testUrl, "reactiv_seed_probe");
  await dropProbeDatabase(adminUrl);
  const admin = new Pool({
    connectionString: adminUrl,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  try {
    // The probe has no migrations and no configurations table.
    await admin.query("CREATE DATABASE reactiv_seed_probe");
  } finally {
    await admin.end();
  }
  try {
    const result = await runSeed({
      CONFIG_SERVICE_TOKEN: "local-service-token",
      DATABASE_URL: probeUrl,
      DEMO_TENANT_ID: demoTenantId,
      DEMO_CONFIGURATION_ID: demoConfigurationId,
    });
    // The missing table stops the command. It does not insert and it does not print the URL.
    expect(result.code).toBe(1);
    expect(result.output).toContain('relation "configurations" does not exist');
    expect(result.output).not.toContain("Inserted the demo configuration.");
    expect(result.output).not.toContain("local-service-token");
    expect(result.output.includes("postgres://")).toBe(false);
    const probe = new Pool({
      connectionString: probeUrl,
      max: 1,
      connectionTimeoutMillis: 5000,
    });
    try {
      const tables = await probe.query<{ configurations: string | null; migrations: string | null }>(
        `SELECT to_regclass('public.configurations')::text AS configurations,
                to_regclass('public.schema_migrations')::text AS migrations`,
      );
      // Neither the configuration table nor the migration bookkeeping table was created.
      expect(tables.rows.at(0)?.configurations ?? null).toBeNull();
      expect(tables.rows.at(0)?.migrations ?? null).toBeNull();
    } finally {
      await probe.end();
    }
  } finally {
    await dropProbeDatabase(adminUrl);
  }
}

describe("demo seed against reactiv_test", () => {
  beforeAll(openDatabase);
  beforeEach(deleteDemoRow);
  afterAll(closeDatabase);

  it("inserts the six-section document at the configured id", expectEmptyDatabaseReceivesTheDemo, 20_000);
  it("leaves revision and updatedAt unchanged when the seed runs twice", expectSecondSeedLeavesTheRow, 20_000);
  it("does not reset a later edit", expectSeedLeavesAMerchantEdit, 20_000);
  it("does not create a row when GET misses", expectGetMissDoesNotInsert, 20_000);
  it("leaves one revision-1 row when two seeds overlap", expectParallelSeedsLeaveOneRow, 20_000);
  it("does not change another tenant's row with the same id", expectSeedLeavesAnotherTenantsRow, 20_000);
  it("does not treat another configuration id as the demo row", expectSeedLeavesAnotherConfiguration, 20_000);
  it("prints insert, then leaves the existing row alone", expectCliSeedTwiceLeavesTheRow, 30_000);
  it("does not replace a blank database URL from .env", expectCliBlankDatabaseUrlDoesNotUseTheFile, 15_000);
  it("does not connect when the token is blank", expectCliBlankTokenDoesNotConnect, 15_000);
  it("does not print the database password when the connection fails", expectCliConnectionFailureHidesThePassword, 20_000);
  it("uses .env when DATABASE_URL is unset and does not print the URL", expectCliUnsetUrlUsesTheEnvFile, 20_000);
  it("does not create tables when the database is empty", expectSeedDoesNotCreateTables, 20_000);
});
