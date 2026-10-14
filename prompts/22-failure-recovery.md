# Prompt 22 — Failure recovery

Implement only this prompt. Preconditions: prompt 21 is done. The happy-path Save and the in-flight race pass.

## Read first

- Architecture section 6, network and service errors, and the ban on reseeding after a failed load
- Take-home PDF page 4, sensible defaults and graceful error handling
- Acceptance criteria P03 and P04, and verification scenario T06 except the R05 race already covered

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- A failed Save never shows `Saved.` and never replaces the draft with defaults.
- A failed initial load never writes a new default document to the database.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/22-failure-recovery.md`.

## Goal

When the configuration service fails, the user can see what happened and retry without losing local edits or overwriting the last committed configuration.

## Implement

1. Save failure. If the action returns unavailable, internal, misconfigured, or a network failure:
   - dispatch `saveFailed`
   - keep every draft field
   - show `The draft was not saved.` and the safe message
   - show the request id when the action has one
   - enable `Retry save`, which submits the current draft again with the current `baseEtag`
   - do not clear `dirty`
2. The action and the server client must not turn a timeout into a success. A timeout is `unavailable`.
3. If a timeout is ambiguous, do not automatically retry inside the client. The user retries. An automatic second `PUT` could double-apply a write that actually committed. On retry, the conditional ETag still protects a committed write: if the timed-out `PUT` committed, the retry with the old ETag returns 412, and the conflict UI from prompt 21 appears. Document that interaction in the note. You may add a test where the first response is a timeout and the stored revision has actually moved, and the retry surfaces conflict rather than a second blind write. The server already returns 412 for a stale tag; the editor must not catch 412 and reissue the `PUT` with the newer tag.
4. Initial load failure. When the loader cannot reach the service, or the service returns 500, the page shows `The saved home screen could not be loaded.` It does not render the demo factory as if it were the saved document. It does not call create or seed. A `Retry` button reloads the document request.
5. Not-found stays different from unavailable. Not-found copy is `This home screen was not found.` It still must not seed.
6. Tests:
   - a failed action leaves the title input equal to the unsaved title and does not show `Saved.`
   - retry after a subsequent success shows `Saved.` and the stored document matches the draft
   - the loader error state does not contain the demo section titles as a fake success
   - a test spy asserts the loader error path does not call `createConfiguration` or the seed function
   - 412 during retry is not followed by another `PUT` in the same turn

## Out of scope

- Building a new database, a queue, or a status page for production monitoring. Request-id display is completed in prompt 24 if you only have part of it here. Show the id in the UI now if the action already returns it.

## Acceptance criteria that fully pass

- **P03.** A failed Save leaves the draft intact, shows a useful error, and allows a successful retry. It does not report success or replace the last saved configuration with a partial write. Evidence: failure test, unchanged stored document, then a successful retry.
- **P04.** A failed initial load shows a recoverable error. It does not treat an outage as an empty configuration or overwrite stored data with defaults. Evidence: loader error test and the spy that create/seed are not called.

## Take-home PDF requirements that fully pass

- Page 4, sensible defaults and graceful error handling, for load and save failures.
- Page 3, reload restores the persisted configuration, including the negative case: a failed reload does not pretend the default seed is the saved data.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manual: stop the config service, click Save, confirm the draft remains, start the service, retry, reload, and confirm the edit persisted. Also load `/` while the service is stopped and confirm the error screen, then start the service and retry

## Done when

- P03 and P04 pass.
- The note records both manual outage checks.
- You have not started prompt 23.
