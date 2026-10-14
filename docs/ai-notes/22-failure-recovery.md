# 22 — Failure recovery

13 October 2026. Prompt 23 was not started.

## Save failure

A save whose action is unavailable, internal, misconfigured, or otherwise not a configuration dispatches `saveFailed`. The draft, including every field that was typed, stays. `dirty` stays true. The page does not say `Saved.`

The page shows `The draft was not saved.` and the action's safe sentence. When the action body has a request id, the page shows `Request id:` and that id. `Retry save` posts the current draft again with the current `baseEtag`. It is the same submit as Save. It does not invent an ETag and it does not clear the draft.

A timeout in the server client is `unavailable`, not a success. The client calls `fetch` once. It does not send a second PUT. A timed-out PUT may already have committed, so an automatic second write could apply the document twice. The user retries.

On that retry the conditional ETag still protects a write that actually committed. The editor still holds the old `baseEtag`, because `saveFailed` does not advance it. If the timed-out PUT committed, the retry with that old tag returns 412. The conflict UI from prompt 21 appears: `Someone saved a newer version. Your unsaved changes are still on this page.` The editor does not catch 412 and PUT again with the newer tag. A test covers that: the first response is unavailable while the stored revision has moved, the retry sends the original tag, the response is 412, and there is no third PUT in that turn.

## Load failure

When the loader cannot reach the service, or the service returns 500, the page shows `The saved home screen could not be loaded.` plus the safe sentence and the request id. It does not mount the editor. It does not render the demo section titles as if they were the saved document. It does not call `createConfiguration`, `seedDemoConfiguration`, or `createSeedDocument`.

`Retry` calls the router revalidator, which runs the document loader again. That is a GET. It does not create or seed.

Not-found stays separate. The page shows `This home screen was not found.` It does not show the outage sentence, and it still does not seed. The loader payload keeps the existing `Configuration not found.` sentence for the action data. The page does not render that older sentence.

## Checks

- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 315 in `@reactiv/editor`.
- In the browser, on `http://127.0.0.1:5173/`, the first text title was `Throttle B`. It was changed to `Outage kept`. The configuration service on port 4001 was then stopped. Save showed `The draft was not saved.`, `The configuration service is unavailable.`, and a request id. `Saved.` was absent. The title input and the preview stayed `Outage kept`, and the page stayed dirty. `Retry save` was enabled. The service was started again. Retry save showed `Saved.`, the page was clean, and Save was disabled. A reload showed `Outage kept` in the section list and the preview. `Throttle B` was gone. The stored first text title is now `Outage kept`.
- With the service stopped again, a load of `/` showed `The saved home screen could not be loaded.`, `The configuration service is unavailable.`, a request id, and `Retry`. It did not show a title field, `Outage kept`, `New this week`, or `From the floor`. The service was started, Retry was clicked, and the editor returned with `Outage kept` and `From the floor`. `New this week` was still absent. Save was disabled.

## Acceptance progress

P03 passes. The failure test leaves the title input on the unsaved title and does not show `Saved.` The stored document is unchanged. A later success shows `Saved.` and the stored document matches the draft.

P04 passes. The loader error state does not contain the demo section titles. The spies assert that path does not call `createConfiguration` or the seed functions. Retry loads the stored document instead of a factory.

Page 4, sensible defaults and graceful error handling, passes for load and save failures. A failed load is not treated as an empty configuration, and a failed save does not report success or replace the draft with defaults.

Page 3, reload restores the persisted configuration, includes the negative case: the failed reload did not pretend the default seed was the saved data. After the service returned, Retry showed the document that had been stored, including `Outage kept`.
