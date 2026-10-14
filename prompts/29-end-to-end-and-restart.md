# Prompt 29 — End-to-end journeys and restart

Implement only this prompt. Preconditions: prompts 01–28 are done. Unit and component tests pass. The benchmark file exists.

## Read first

- Acceptance criteria verification plan T01–T07, and P05's restart sentence
- Architecture section 13, the end-to-end and persistence rows
- Take-home PDF pages 1–3, the full user journey

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Prefer a few browser journeys that match the verification plan over a large number of shallow tests.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/29-end-to-end-and-restart.md`.
- Stub image hosts. Do not depend on example.com being reachable.

## Goal

Playwright covers the reviewer journeys, and a restart test shows the saved configuration is still in Postgres after the config service process is stopped and started again.

## Journeys

Add or extend Playwright tests so these exist as named tests. They may share a seeded database. They must not share unsaved drafts across tests.

1. **T01.** From the seeded screen, edit every required field type, scroll both carousels with the next control, select each aspect ratio on one carousel, and reorder two sections of the same type. Assert the preview. This overlaps F02–F10; keep it as the browser-level evidence.
2. **T02.** Export, change the draft, import the exported file, Save, clear `localStorage`, reload, and assert the saved title and order. Assert the export did not contain the service token.
3. **T03.** Import malformed JSON, an empty file, a semantically invalid file, and a schema version 2 file. After each, the previous preview title is unchanged and an error is visible.
4. **T04.** This remains an API test, not a browser test. Confirm the prompt 06 and 07 tests still cover valid writes, unknown ids, missing credentials, wrong credentials, and invalid payloads. Do not duplicate them in Playwright unless they are only implemented as manual scripts. If any of those cases exist only as a manual note, promote them to an automated API test now.
5. **T05.** The prompt 25 boundary Playwright test still passes.
6. **T06.** Stop the service or point the editor at a closed port, load the page, see the load error, start the service, retry, and see the seeded or saved screen. In the same file or the next test: with the service up, fail one Save, keep the typed title, restore the service, retry, and see `Saved.` Include the R05 race if it is not already a component test: delay the action, edit from A to B, complete A's response, assert B remains, reload, assert A is stored.
7. **T07.** The prompt 26 viewport tests still pass. Add a broken-image assertion in the browser if prompt 17 only covered it in jsdom: a 404 image shows `Image unavailable` and the title input still accepts text.

## Restart

P05's behavioral half:

1. Save a distinctive title through the API or the UI.
2. Stop the config-service process. Leave the Postgres container and its named volume running.
3. Start the config-service process again.
4. `GET` the demo id and assert the distinctive title and revision are still there.

Automate this if the test harness can spawn the service. If it cannot, write a PowerShell script `scripts/restart-check.ps1` that performs the steps and fails on a mismatch, and run it. A script that was not run does not count. Record the output in the note.

Do not claim survival of `docker compose down -v`. That deletes the volume. The README in prompt 30 must say the named volume survives service and container restarts and does not survive volume deletion.

## Out of scope

- New features, visual redesign, and the Decision Log.

## Acceptance criteria that fully pass

- **P05, behavioral half.** The documented store is Postgres. A service restart against the same database volume keeps the last committed configuration. Evidence: the restart script or test you actually ran. The README limitations, concurrency summary, and deployment limits are prompt 30. P05 fully passes only when that prose exists. In the note, say "P05 behavior passed; P05 documentation is prompt 30."

No other new ID fully passes here if the earlier prompts already passed them. This prompt is the regression net. If a journey fails, fix the product, not the assertion, unless the assertion contradicts an earlier prompt.

## Take-home PDF requirements

The browser journeys are the evidence that pages 1–3 work together: edit, preview, import, export, save, and reload. Page 2's storage tradeoff is still the README's job.

## Verification

- `pnpm test`
- Playwright project
- Restart script or test
- `pnpm typecheck`

## Done when

- T01–T07 have automated evidence and the restart check has been run.
- The note records commands and results, including any product bug you fixed.
- You have not started prompt 30.
