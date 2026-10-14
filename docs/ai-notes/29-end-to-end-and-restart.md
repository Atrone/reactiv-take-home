# 29 — End-to-end journeys and restart

13 October 2026. Prompt 30 was not started.

## Journeys

`e2e/journeys/journeys.spec.ts` is the browser evidence. Each test gets a new browser context, and `beforeEach` resets the fixture row, so unsaved drafts and saved titles do not carry from one test to the next. Slide requests to `https://example.com/` are fulfilled in the browser. The suite does not contact that host.

The fixture is an in-memory configuration service on port 4194, with a control port on 4195. It serves the six-section demo document. It is not Postgres. The Postgres restart is the script below.

- **T01.** From the seeded screen, the test edits the image URL, alt text, title, description, both text colors, the CTA label, the CTA link, and both CTA colors. It scrolls both carousels with Next image, selects Portrait, Landscape, and Square on the first carousel, and moves the first text section down until it sits after the second text section. The phone preview shows the edited copy, colors, link, square frame, and the new order. The second text title stays `From the floor`.
- **T02.** The test changes the title to `Exported journey title`, reorders that text section, and exports. The file contains that title and does not contain the fixture token, `Bearer`, or `cfg_journey`. The draft title is then changed, the exported file is imported, and Save shows `Saved.`. `localStorage` is cleared. After reload, the preview title and section order match the export.
- **T03.** Malformed JSON, an empty file, a `javascript:` CTA URL, and a schema version 2 file each leave the preview title `New this week` and show an error. The version 2 file's title `Version two title` does not appear.
- **T04.** This stays the prompt 06 and 07 API tests. They already cover the cases, so they were not copied into Playwright.
  - Valid writes: `stores a six-section document and loads the same payload` in `create-and-load.test.ts`, and `updates a document when If-Match is the current strong ETag` in `conditional-update.test.ts`.
  - Unknown ids: `returns 404 for an unknown id` and `returns 404 for an unknown id and does not insert`.
  - Missing and wrong credentials: `rejects a missing or wrong token before the repository` in both files. Each test sends a request with no token and a request with a different token.
  - Invalid payloads: `rejects invalid documents and leaves the stored configuration unchanged` and `returns 422 for an invalid document and leaves the stored JSON unchanged`.
- **T05.** `keeps the service credential off the browser during load, save, and export` in `e2e/boundary/credential-boundary.spec.ts` passed.
- **T06.** With the fixture port closed, the page shows `The saved home screen could not be loaded.` and does not show `New this week`. Opening the port and clicking Retry shows the seeded screen. In the next test, one Save returns 500, the title `Kept during the outage` stays, `Saved.` is absent, and Retry save shows `Saved.`. A reload still shows that title. The R05 race is already the component test `keeps B when A's save completes, and a reload shows A` in `save-reconciliation.test.tsx`. It was not copied into Playwright.
- **T07.** The prompt 26 viewport tests still pass: `fits the editor at 375 CSS pixels`, `fits the editor at 768 CSS pixels`, `fits the editor at 1440 CSS pixels`, and `keeps focus on the moved section after Move down`. Prompt 17 covered the broken image in jsdom, so the browser test `T07 shows Image unavailable for a 404 image and the title input still accepts text` was added. A 404 slide shows `Image unavailable`, and the title field accepts `Title beside a broken image`.

No product bug was fixed. The journeys matched the editor that prompts 01–28 already built.

## Restart

`scripts/restart-check.ps1` was run. It starts Postgres if needed, migrates, and seeds. The seed left the existing `cfg_demo` row alone. The script then starts the config-service process on port 4019 against `DATABASE_URL` and the named volume `reactiv_pg`. It does not stop a process it did not start, and it does not run `docker compose down` or `docker compose down -v`.

The script saved a distinctive title, stopped that config-service process, confirmed the port was closed and the Postgres container was still running, started the process again, and `GET` the demo id.

```
Saved title=P05 restart 2026-10-13T22:53:03.207Z revision=18
After restart title=P05 restart 2026-10-13T22:53:03.207Z revision=18 volume=reactiv_pg
Restored previous title=Outage kept
P05 behavior passed. The named volume survived the config-service restart. docker compose down -v was not run.
```

The GET after the restart matched the title and revision from the PUT. The script then restored the previous title, `Outage kept`, so the demo row is not left on the check title. That restore is a later write. The survival evidence is the GET before it. The script exited 0.

## Commands and results

- `pnpm exec playwright test --config playwright.journeys.config.ts` exited 0. Six tests passed: T01, T02, T03, both T06 tests, and the T07 broken-image test.
- `pnpm exec playwright test` exited 0. Five tests passed: the carousel scroll test and the four prompt 26 viewport and keyboard tests.
- `pnpm exec playwright test --config playwright.boundary.config.ts` exited 0. One test passed. The run reported `boundary upstream: postgres`.
- `powershell -NoProfile -File .\scripts\restart-check.ps1` exited 0. Output is quoted above.
- `pnpm typecheck` exited 0.
- `pnpm test` exited 0 when run on its own. Vitest 5.0.4 passed 66 tests in `@reactiv/contracts`, 222 in `@reactiv/config-service`, and 344 in `@reactiv/editor`. An earlier run of the same command, started beside typecheck and three Playwright projects, timed out four editor tests at 5 seconds. Those four passed in the isolated run. The files were not edited.

## Acceptance progress

P05 behavior passed; P05 documentation is prompt 30.

The store exercised by the restart is Postgres. Stopping the config-service process and starting it again against the same named volume `reactiv_pg` kept revision 18 and the title `P05 restart 2026-10-13T22:53:03.207Z`. The README limitations, concurrency summary, and deployment limits are prompt 30. This note does not claim that `docker compose down -v` keeps the data. That command deletes the volume.

No other acceptance ID newly passes here. T01–T07 are the regression net for behavior earlier prompts already covered, plus the browser broken-image check that prompt 17 had only automated in jsdom.
