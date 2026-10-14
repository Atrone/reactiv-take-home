# 21 — Save reconciliation and conflicts

13 October 2026. Prompt 22 was not started.

## Save while typing

Save copies the validated document with `structuredClone` and records `localSequence` and `baseEtag` at the click. Later keystrokes change the draft and increment `localSequence`. They do not change the body already posted.

A second Save click is ignored while `status` is `saving`. The button stays enabled. Typing still updates the draft.

When the acknowledgement for sequence N arrives and the current sequence is still N, `saveAcknowledged` replaces the draft, clears dirty, and the page shows `Saved.`

When the current sequence is greater than N, the same action updates `baseEtag` and `savedBaseline` to the acknowledged document, keeps the current draft object, leaves `dirty` true, and does not show `Saved.` The page shows `Unsaved changes.` The next Save sends the newer draft with the ETag from that acknowledgement. That is the A/B case: the request stored A, the user has typed B.

`saveAcknowledged` is the only automatic ETag advance. It is not a conflict.

## Loader revalidation

The provider still hydrates only from its first props. A later loader payload goes through `loaderReconciliationDecision` and never dispatches `hydrate`.

A clean draft is ignored. A save in flight (`status` `saving` or `pendingSave` set) is ignored, so our own revalidation of document A is not treated as someone else's update while B is being typed. An equal ETag is ignored. A different ETag whose sections equal the draft is ignored, and that newer tag is not stored as `baseEtag`. A different ETag whose document is not the draft dispatches `conflictObserved` and keeps the draft.

The first failed load still shows the error page. A later failed revalidation leaves the mounted editor in place.

`shouldRevalidate` returns true for action status 412 so Compare and Reload can read the winner. Every other status keeps the router's default. A 200 still revalidates. A 503 does not.

## 412 and the conflict panel

The action already returns `data()` with the service status. `PRECONDITION_FAILED` is read as a conflict, including the request id. It does not throw, and it does not replace the draft. The page dispatches `conflictObserved` and does not show `Saved.`

When status is `conflict` the alert is `Someone saved a newer version. Your unsaved changes are still on this page.` Compare lists local and server sections as order, type, and a short label. There is no diff library. `Reload server version` asks `Discard your unsaved changes and load the server version?` and then dispatches `reloadFromServer` with the latest loader document. That discards the local draft. It does not PUT. `Export local work` uses the prompt 18 exporter. An invalid local draft shows the export block message and does not download. No control writes the local draft over the server with the server's newer ETag.

The demo API returns 412 when `If-Match` is stale and the editor keeps the draft. That is the SCL02 behavior for one demo tenant. It is not a hosted multi-user product.

## Checks

- `pnpm typecheck` exited 0.
- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 309 in `@reactiv/editor`. An earlier run of the same command timed out the existing live-preview field case at 5 seconds while the config service tests were running beside it. That file renders `EditorShell` directly. Rerun of the file passed 9 tests, and the following full `pnpm test` passed. The prompt 07 conditional-update tests were not edited. Two updates with the same ETag still return 200 then 412.
- In the browser, on `http://127.0.0.1:5173/`, network latency was set to 4 seconds. The first text title started as `Kept after site data`. It was changed to `Throttle A` and Save was clicked. Before that response settled, the title was changed to `Throttle B`. After the response, the title input and the phone preview showed `Throttle B`, `Throttle A` was not on the preview, `Unsaved changes.` was shown, `Saved.` was absent, the page stayed dirty, and the conflict alert was absent. A reload then showed `Throttle A` in the title, the section list, and the preview, and Save was disabled. The title was changed to `Throttle B` again and Save was clicked with no further edits. The status became `Saved.` and the page was clean. A second reload showed `Throttle B`. The stored first text title is now `Throttle B`.

## Acceptance progress

R05 passes. The pending-save UI test holds the first Save, changes the title from A to B, and resolves the Save with the document that contains A and a new ETag. The preview shows B, the status is not `Saved.`, dirty stays true, and the next Save body contains B and that new ETag. Before that second Save, the test renders the loader document and the title is A.

SCL02 is not claimed as a production control. Prompt 30 must say that in the tradeoffs and must not call it a production SLA.
