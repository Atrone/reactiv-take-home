# Prompt 21 — Save reconciliation and conflicts

Implement only this prompt. Preconditions: prompt 20 is done. Save and reload work for a single quiet edit.

## Read first

- Architecture section 6, "Save correctness, including edits made during a request", including the title A/B example and loader revalidation
- Architecture section 7, 412 and the rule against silent overwrite
- Acceptance criteria R05 and the verification note for T06's race. SCL02's behavior is implemented for this demo API and must not be described as a production multi-editor product

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Never resolve a conflict by writing the local draft over the server with the server's newer ETag.
- Never let a loader revalidation replace a dirty draft.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/21-save-reconciliation-and-conflicts.md`.

## Goal

Typing during Save keeps the newer text. A stale update surfaces a recoverable conflict and leaves both the local draft and the remote document intact until the user chooses.

## Reconciliation rules

1. Save captures the immutable document and the `localSequence` at click time.
2. Only one save runs at a time. If `status` is `saving`, ignore further Save clicks. Typing still updates the draft and increments `localSequence`.
3. When the response for sequence N arrives and the current sequence is N, apply the server document, clear dirty, and show `Saved.`
4. When the response for sequence N arrives and the current sequence is greater than N, update `baseEtag` and `savedBaseline` to the acknowledged document, keep the current draft, keep `dirty` true, and do not show `Saved.` Show `Unsaved changes.` This is the A/B case: the request stored A, the user has typed B, the next Save must send B with the ETag from A's acknowledgement.
5. A loader revalidation that arrives while `dirty` is true must not dispatch `hydrate`. If the loader's ETag equals `baseEtag`, ignore it. If the loader's ETag differs and the loader document is not equal to the draft, dispatch `conflictObserved` and keep the draft. Do not adopt the newer ETag as `baseEtag` in that case. Adopting it would let the next Save overwrite someone else's update.
6. Our own `saveAcknowledged` is the only automatic ETag advance. It is not a conflict.
7. On 412 from the action, dispatch `conflictObserved`, keep the draft, and do not show `Saved.`

## Conflict UI

When status is `conflict`:

- Message: `Someone saved a newer version. Your unsaved changes are still on this page.`
- `Compare` shows a plain summary of local versus server: section order, type, and a short label for each. A readable list is enough. No diff library.
- `Reload server version` asks for confirmation, then dispatches `reloadFromServer` with the latest loader document. That discards the local draft.
- `Export local work` downloads the current valid draft with the prompt 18 exporter. If the local draft is invalid, say so and do not download.
- No button silently overwrites the server.

The action returns 412 as a structured error the fetcher can read, including the request id. It must not throw away the client draft.

## Tests

- UI: mock the action so the first Save stays pending. Change the title from A to B. Resolve the Save with the document that contains A and a new ETag. Assert the preview shows B, the status is not `Saved.`, dirty is true, and the next Save body contains B and the new ETag.
- UI: resolving that first Save while no further edits happened shows `Saved.` and the preview matches A.
- UI: a revalidation payload with a different title while the draft is dirty leaves the input showing the dirty title.
- UI or route: a 412 response leaves the input value in place and shows the conflict message.
- Two direct API updates with the same ETag still behave as in prompt 07. Do not weaken that test.
- Imported drafts still show `Imported, not saved.` and are dirty, so a later loader refresh does not wipe them.

## Out of scope

- Real sessions for multiple people, presence, automatic merge, CRDTs, autosave.
- Claiming SCL02 as a production control. In the note, write: the demo API returns 412 when `If-Match` is stale and the editor keeps the draft. That is the SCL02 behavior for one demo tenant. It is not a hosted multi-user product.

## Acceptance criteria that fully pass

- **R05.** Save captures draft A. Edit to B while A's save is pending. When A's save completes, the preview shows B, the editor shows unsaved changes, and a reload without another Save shows A. Evidence: the pending-save UI test and a reload assertion against the stored A document.

SCL02 is not an acceptance ID this sequence claims as a production extension. The behavior the checklist describes for optimistic concurrency is present: the loser gets 412 and keeps the draft. Prompt 30 must say that in the tradeoffs and must not call it a production SLA.

## Take-home PDF requirements

Page 4, graceful error handling and pragmatism: a slow save and a stale write do not destroy the in-progress edit. The PDF does not require multi-user collaboration. This prompt is the architecture's recommended refinement of the required Save flow.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manual: throttle the network, Save, type a new title before the response, and confirm the new title remains and `Saved.` does not appear. Reload and confirm the pre-keystroke value is what was stored. Save again and confirm the new title then persists

## Done when

- R05 passes, including the reload-shows-A check.
- The note records the manual throttle result.
- You have not started prompt 22.
