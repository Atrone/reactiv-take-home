import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Request, type Response, type Route } from "@playwright/test";
import {
  BOUNDARY_TOKEN,
  CONFIGURATION_ID,
  EDITED_TITLE,
  EDITOR_ORIGIN,
  OBSERVER_ORIGIN,
  PROCESS_LOG,
  REPO_ROOT,
  SERVICE_ORIGIN,
} from "./boundary-env.mjs";

/** A 1 by 1 PNG. Slide requests are fulfilled with these bytes so the test does not use the network. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

/** One browser call, with the credential reduced to a boolean so a failure does not print it. */
type BrowserCall = {
  method: string;
  url: string;
  headerHasCredential: boolean;
};

/** One loader payload, reduced the same way. */
type LoaderPayload = {
  path: string;
  hasCredential: boolean;
  hasDocument: boolean;
};

/** One private API call observed by the spy or the stub. */
type ObservedCall = {
  method: string;
  path: string;
  authorization: string;
  ifMatch: string;
};

/** The observation route the test process reads. The browser is not sent here. */
type Observations = {
  mode: string;
  calls: ObservedCall[];
};

/**
 * Fulfills one demo image request with a local PNG.
 *
 * Purpose: the boundary check does not depend on example.com.
 * Inputs: route, the browser request for a demo image.
 * Side effects: completes that request with a 1 by 1 PNG.
 */
async function fulfillDemoImage(route: Route): Promise<void> {
  // The bytes are a valid PNG. The configuration URL is unchanged.
  await route.fulfill({
    status: 200,
    contentType: "image/png",
    body: TINY_PNG,
  });
}

/**
 * Reports whether a header map contains the credential.
 *
 * Purpose: the trace can record a boolean instead of the header value.
 * Inputs: headers, the request or response headers. token, the credential for this session.
 * Side effects: none.
 */
function headersContainCredential(headers: Record<string, string>, token: string): boolean {
  for (const [name, value] of Object.entries(headers)) {
    // The name and the value are both places a client could copy the credential.
    if (name.includes(token) || value.includes(token)) {
      return true;
    }
  }
  return false;
}

/**
 * Reports whether a URL is the private configuration service.
 *
 * Purpose: browser configuration traffic must not use port 4001 or CONFIG_SERVICE_URL.
 * Inputs: url, a browser request URL.
 * Side effects: none.
 */
function isPrivateServiceUrl(url: string): boolean {
  const parsed = new URL(url);
  // Port 4001 is the documented service port even when this session uses another one.
  if (parsed.port === "4001") {
    return true;
  }
  // The observer is CONFIG_SERVICE_URL. The service port is the process behind the spy.
  if (parsed.origin === OBSERVER_ORIGIN || parsed.origin === SERVICE_ORIGIN) {
    return true;
  }
  // A private path on any host is still the configuration API.
  return parsed.pathname.includes("/v1/configurations");
}

/**
 * Reports whether a browser call is a configuration read or write.
 *
 * Purpose: asset requests are not configuration traffic. Document, data, and action calls are.
 * Inputs: url, the request URL. method, the HTTP method.
 * Side effects: none.
 */
function isConfigurationExchange(url: string, method: string): boolean {
  const parsed = new URL(url);
  const verb = method.toUpperCase();
  // The private API shape is configuration traffic even if it was aimed at the wrong host.
  if (parsed.pathname.includes("/v1/configurations")) {
    return true;
  }
  // The document, the index action, and single-fetch data use the editor route.
  if (parsed.pathname === "/" || parsed.pathname.endsWith(".data")) {
    return verb === "GET" || verb === "POST" || verb === "PUT" || verb === "PATCH";
  }
  return false;
}

/**
 * Starts recording browser calls and loader payloads.
 *
 * Purpose: the assertions run after Save, against the calls captured during the session.
 * Inputs: page, the Playwright page.
 * Side effects: registers request and response listeners.
 */
function recordBrowserSession(page: Page): { calls: BrowserCall[]; payloadReads: Promise<LoaderPayload>[] } {
  const calls: BrowserCall[] = [];
  const payloadReads: Promise<LoaderPayload>[] = [];

  /**
   * Stores one browser request without keeping header values.
   *
   * Purpose: later assertions can see the URL and whether any header held the credential.
   * Inputs: request, the Playwright request.
   * Side effects: appends one call.
   */
  function noteRequest(request: Request): void {
    // Header text is reduced to a boolean before it is stored.
    calls.push({
      method: request.method(),
      url: request.url(),
      headerHasCredential: headersContainCredential(request.headers(), BOUNDARY_TOKEN),
    });
  }

  /**
   * Stores one single-fetch payload without keeping its text when the check is done.
   *
   * Purpose: the loader data response is the JSON-bearing payload the browser receives.
   * Inputs: response, the Playwright response.
   * Side effects: reads that body when the path is a data request.
   */
  function noteResponse(response: Response): void {
    const pathname = new URL(response.url()).pathname;
    // Document HTML is read from the navigation response. Data requests end in .data.
    if (!pathname.endsWith(".data")) {
      return;
    }
    /**
     * Records whether this data response contains the credential.
     *
     * Purpose: the assertion can check the loader payload without printing it.
     * Inputs: body, the response text.
     * Side effects: none.
     */
    function summarizeLoaderBody(body: string): LoaderPayload {
      // schemaVersion marks a document payload. The boolean does not keep the credential text.
      return {
        path: pathname,
        hasCredential: body.includes(BOUNDARY_TOKEN),
        hasDocument: body.includes("schemaVersion"),
      };
    }

    payloadReads.push(response.text().then(summarizeLoaderBody));
  }

  page.on("request", noteRequest);
  page.on("response", noteResponse);
  return { calls, payloadReads };
}

/**
 * Opens the editor, edits a title, saves, and exports.
 *
 * Purpose: the recorded session is a real load, edit, and save, not a health check.
 * Inputs: page, the Playwright page.
 * Side effects: drives the browser and returns the document HTML.
 */
async function editTitleAndSave(page: Page): Promise<string> {
  // Demo images stay in the browser. They are not configuration requests.
  await page.route("https://example.com/**", fulfillDemoImage);
  const documentResponse = await page.goto("/");
  if (documentResponse === null) {
    throw new Error("The editor did not return a document.");
  }
  // The navigation body is the HTML the browser received for GET /.
  const html = await documentResponse.text();
  await expect(page.getByRole("heading", { name: "Editor" })).toBeVisible();
  await page.getByRole("button", { name: "Select Text, New this week" }).click();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  // Replace the seeded title. The new title is not the service credential.
  await title.fill(EDITED_TITLE);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
  return html;
}

/**
 * Reads the JSON file Export JSON downloaded.
 *
 * Purpose: the export assertion uses the file text, not the on-screen draft alone.
 * Inputs: page, the Playwright page.
 * Side effects: clicks Export JSON and writes the download under test-results.
 */
async function exportJson(page: Page): Promise<string> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const download = await downloadPromise;
  const saved = path.join(REPO_ROOT, "test-results", "boundary-export.json");
  // saveAs keeps the file after the browser context closes.
  await download.saveAs(saved);
  return readFileSync(saved, "utf8");
}

/**
 * Asserts configuration reads and writes stayed on the editor origin.
 *
 * Purpose: the browser must not call port 4001 or CONFIG_SERVICE_URL.
 * Inputs: calls, the recorded browser requests.
 * Side effects: none.
 */
function expectConfigurationTrafficStaysOnTheEditor(calls: readonly BrowserCall[]): void {
  const exchanges = calls.filter((call) => isConfigurationExchange(call.url, call.method));
  // The session has to include the document read and the Save post.
  expect(exchanges.some((call) => call.method.toUpperCase() === "GET")).toBe(true);
  expect(exchanges.some((call) => call.method.toUpperCase() === "POST")).toBe(true);
  for (const call of exchanges) {
    // Every configuration URL is the editor. A private-service URL fails this and the check below.
    expect(new URL(call.url).origin).toBe(EDITOR_ORIGIN);
  }
  // No browser call, including images and assets, may target the private service.
  expect(calls.some((call) => isPrivateServiceUrl(call.url))).toBe(false);
  expect(calls.some((call) => call.url.includes(BOUNDARY_TOKEN))).toBe(false);
  expect(calls.some((call) => call.headerHasCredential)).toBe(false);
}

/**
 * Asserts the HTML and the loader payloads omit the credential.
 *
 * Purpose: a token in the document or the single-fetch body would be a loader leak.
 * Inputs: html, the GET / body. liveHtml, the DOM after the session. payloads, the .data bodies.
 * Side effects: none.
 */
function expectLoaderPayloadOmitsTheCredential(
  html: string,
  liveHtml: string,
  payloads: readonly LoaderPayload[],
): void {
  // The document has to be the editor page, and the data response has to carry the document.
  expect(html.includes("Editor")).toBe(true);
  expect(payloads.length).toBeGreaterThan(0);
  expect(payloads.some((payload) => payload.hasDocument)).toBe(true);
  expect(html.includes(BOUNDARY_TOKEN)).toBe(false);
  expect(liveHtml.includes(BOUNDARY_TOKEN)).toBe(false);
  expect(payloads.some((payload) => payload.hasCredential)).toBe(false);
}

/**
 * Asserts the export and browser storage omit the credential.
 *
 * Purpose: Export JSON and localStorage are browser-held copies of editor data.
 * Inputs: exportText, the downloaded file. storage, the JSON form of localStorage.
 * Side effects: none.
 */
function expectExportAndStorageOmitTheCredential(exportText: string, storage: string): void {
  // The file is the edited draft. The credential must not be in it or in localStorage.
  expect(exportText.includes(EDITED_TITLE)).toBe(true);
  expect(exportText.includes(BOUNDARY_TOKEN)).toBe(false);
  expect(storage.includes(BOUNDARY_TOKEN)).toBe(false);
}

/**
 * Asserts the spy or stub saw an authenticated GET and PUT.
 *
 * Purpose: the editor server called the private API with the server-held credential.
 * Inputs: observations, the trace from the observer.
 * Side effects: writes the mode and the counts. Does not write the credential.
 */
function expectAuthenticatedPrivateCalls(observations: Observations): void {
  const configurationPath = `/v1/configurations/${CONFIGURATION_ID}`;
  const gets = observations.calls.filter(
    (call) =>
      call.method === "GET" &&
      call.path === configurationPath &&
      call.authorization === `Bearer ${BOUNDARY_TOKEN}`,
  );
  const puts = observations.calls.filter(
    (call) =>
      call.method === "PUT" &&
      call.path === configurationPath &&
      call.authorization === `Bearer ${BOUNDARY_TOKEN}` &&
      call.ifMatch !== "",
  );
  // Counts only. The Authorization value is not printed.
  console.log(`boundary upstream: ${observations.mode}`);
  console.log(`boundary authenticated get=${gets.length} put=${puts.length}`);
  expect(gets.length).toBeGreaterThan(0);
  expect(puts.length).toBeGreaterThan(0);
}

/**
 * Asserts the process log does not contain the credential.
 *
 * Purpose: the access lines for this session are part of the browser proof.
 * Inputs: none.
 * Side effects: reads the gitignored process log.
 */
function expectProcessLogOmitsTheCredential(): void {
  const log = readFileSync(PROCESS_LOG, "utf8");
  // The mode line is written by the launcher. The credential must not be in the raw log.
  expect(log.includes("boundary-mode=")).toBe(true);
  expect(log.includes(BOUNDARY_TOKEN)).toBe(false);
}

/**
 * Asserts the editor package does not depend on pg and does not import it.
 *
 * Purpose: a direct database call from the editor is not the private API trace.
 * Inputs: none.
 * Side effects: reads package.json and the editor app tree.
 */
function expectEditorHasNoPgDependency(): void {
  const packageJson = JSON.parse(readFileSync(path.join(REPO_ROOT, "apps/editor/package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const names = [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(packageJson.peerDependencies ?? {}),
  ];
  // The package metadata is the dependency. A source import would be a second path to Postgres.
  expect(names).not.toContain("pg");
  expect(editorSourceImportsPg()).toBe(false);
}

/**
 * Reports whether editor application source imports pg.
 *
 * Purpose: package.json is not the only place a database client could be named.
 * Inputs: none.
 * Side effects: reads apps/editor, skipping vendor and build output.
 */
function editorSourceImportsPg(): boolean {
  const root = path.join(REPO_ROOT, "apps/editor");
  const skip = new Set(["node_modules", "build", "dist", ".react-router", "coverage"]);
  const files: string[] = [];

  /**
   * Walks the editor package.
   *
   * Purpose: collect source files that could import pg.
   * Inputs: directory, the directory to read.
   * Side effects: reads directory entries.
   */
  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      // Vendor and build output are not the editor modules this check guards.
      if (skip.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  walk(root);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    // Both quote styles and require() are an import of the database driver.
    if (
      text.includes('from "pg"') ||
      text.includes("from 'pg'") ||
      text.includes('require("pg")') ||
      text.includes("require('pg')")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Asserts .env is ignored and, when this directory is a git checkout, is not staged.
 *
 * Purpose: the repository must not contain the local credential file.
 * Inputs: none.
 * Side effects: reads .gitignore and, inside a work tree, runs git check-ignore and git status.
 */
function expectEnvIsNotTracked(): void {
  const gitignore = readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf8");
  const lines = gitignore.split(/\r?\n/);
  // The ignore rule is the committed search. A negation would put the file back.
  expect(lines).toContain(".env");
  expect(lines).not.toContain("!.env");
  const insideRepo = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // A directory without .git cannot list the file as something to add.
  if (insideRepo.status !== 0) {
    return;
  }
  const ignored = spawnSync("git", ["check-ignore", "-v", "--", ".env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // Exit 0 means a rule matched. The rule names .env.
  expect(ignored.status).toBe(0);
  expect(ignored.stdout).toContain(".env");
  const status = spawnSync("git", ["status", "--short", "--", ".env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  // An ignored file is absent from the short status.
  expect(status.status).toBe(0);
  expect(status.stdout.trim()).toBe("");
}

/**
 * Runs the browser session and the private-service trace.
 *
 * Purpose: one load, edit, and save proves the credential stays on the server.
 * Inputs: page, the Playwright page.
 * Side effects: drives the browser and reads the observer.
 */
async function expectTheCredentialToStayOnTheServer({ page }: { page: Page }): Promise<void> {
  const session = recordBrowserSession(page);
  const html = await editTitleAndSave(page);
  // Revalidation after Save is the loader payload. Wait until that body has been queued.
  await expect.poll(() => session.payloadReads.length).toBeGreaterThan(0);
  const payloads = await Promise.all(session.payloadReads);
  const liveHtml = await page.content();
  const exportText = await exportJson(page);
  const storage = await page.evaluate(() => JSON.stringify(window.localStorage));
  const observations = (await (await fetch(`${OBSERVER_ORIGIN}/__boundary/observations`)).json()) as Observations;
  expectConfigurationTrafficStaysOnTheEditor(session.calls);
  expectLoaderPayloadOmitsTheCredential(html, liveHtml, payloads);
  expectExportAndStorageOmitTheCredential(exportText, storage);
  expectAuthenticatedPrivateCalls(observations);
  expectProcessLogOmitsTheCredential();
  expectEditorHasNoPgDependency();
  expectEnvIsNotTracked();
}

test("keeps the service credential off the browser during load, save, and export", expectTheCredentialToStayOnTheServer);
