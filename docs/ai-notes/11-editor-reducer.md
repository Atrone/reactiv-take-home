# 11 — Editor reducer

13 October 2026. Prompt 12 was not started. The page at `/` still renders the loaded configuration as JSON.

## State

The editor state lives in `apps/editor/app/features/editor/editor-reducer.ts`. `EditorProvider` in `editor-context.tsx` holds it with `useReducer` and passes it through `EditorStateContext` and `EditorDispatchContext`. There is no Redux store, no Zustand store, and no second copy of the sections.

`draft` is the only working document. `selectedSectionId`, `savedBaseline`, `baseEtag`, `dirty`, `status`, `localSequence`, and `pendingSave` stay outside the portable document. `DraftDocument` matches `EditableDocument`, except color and URL fields are plain strings. An invalid string is stored as typed. Duplicate ids and other constraints are not repaired inside the reducer.

`localSequence` starts at 0 and increments on add, remove, move, section edit, image edit, and import. It does not increment when a save acknowledgement arrives. A user edit after status `saved` sets status back to `idle`. Status `saving`, `error`, and `conflict` stay as they are while the author types.

New section ids and new image ids come from the injected generator, once each, through `createSection` and `createStableId`. A new image is `{ url: "", alt: "" }`. The route does not use the provider yet.

## Commands

`hydrate` runs only while `savedBaseline` is null, `dirty` is false, and `localSequence` is 0. It copies the configuration's `schemaVersion` and `data` into both the draft and the baseline, stores `baseEtag`, selects the first section or null, and leaves `dirty` false. A later `hydrate` is ignored. That includes a second load after an empty document, a load while `dirty` is true, and a load after `importDocument` before any baseline exists. There is no command that merges a loader payload over a dirty draft.

`addSection`, `removeSection`, `moveSection`, and `updateSection` edit the one draft. `updateSection` keeps the existing id and type. A payload of a different type is ignored. `moveSection` swaps the section object with its neighbor, so image URLs stay on the same carousel. Move up on the first section and move down on the last section return the same state. Removing the selected section selects the next section, otherwise the previous, otherwise null. Other removals leave the selection on its id.

`addImage`, `updateImage`, and `removeImage` change one carousel. Removing the last image leaves `images: []` and leaves the carousel in the list. `updateImage` keeps the image id.

`importDocument` trusts its caller. It replaces the draft, selects the first imported section, sets `dirty` true, sets status `idle`, and increments `localSequence`. `savedBaseline` and `baseEtag` stay. It does not call `validateDraft`.

`saveStarted` records `{ sequence: localSequence, etag: baseEtag }` and sets status `saving`. It does not change the draft. A second `saveStarted` while status is already `saving` is ignored, so the recorded sequence stays on the in-flight click. If `baseEtag` is null, the command is ignored and no tag is invented.

`saveFailed` sets status `error`, clears `pendingSave`, and leaves the draft. `conflictObserved` sets status `conflict` and leaves the draft, `dirty`, the baseline, the ETag, and `pendingSave` unchanged.

`reloadFromServer` is the explicit replacement. It copies the server document into the draft and the baseline, stores `baseEtag`, selects the first section, clears `dirty` and `pendingSave`, and sets status `idle`. It sets `localSequence` back to 0.

## `saveAcknowledged` when the sequence is stale

The command receives the server configuration, the acknowledged ETag, and the sequence that was saved. `localSequence` is not incremented.

If `localSequence` is greater than that sequence, the branch is `acknowledgeStaleSave`. The draft object is left in place, including a newer title and an invalid in-progress color. `dirty` is set true and status is set to `idle`, not `saved`. `savedBaseline` becomes the portable part of the server configuration, and `baseEtag` becomes the acknowledged tag. `pendingSave` is cleared. The next save can send the newer draft with that tag. This is the case the tests cover: snapshot at sequence N, edit, then acknowledge sequence N. The same branch applies when `importDocument` runs after `saveStarted`: the acknowledgement names the older sequence, so the imported draft stays and the baseline becomes the document that was saved.

If `localSequence` still equals that sequence, the draft and the baseline are replaced with separate copies of the server document, `dirty` is false, and status is `saved`.

If `localSequence` is less than that sequence, the command is ignored. Reload resets the counter to 0, so a late acknowledgement of a pre-reload sequence hits this branch instead of the stale branch. The stale branch would mark the reloaded draft dirty. The ignore branch does not.

## Validation

`validateDraft` in `draft-document.ts` copies the draft, normalizes colors that already parse, and runs `editableDocumentSchema`. It returns `{ ok: true, document }` or `{ ok: false, issues }`. The issues use `issuesFromZodError`. A successful document stores lowercase `#rrggbb`. The draft still has the characters the author typed. `#` fails validation and remains in the draft. `#ABC` validates as `#aabbcc` and remains `#ABC` in the draft. The same split applies to `descriptionColor`, CTA `backgroundColor`, and CTA `labelColor`, including `#fff` stored as `#ffffff`. A CTA label of only spaces fails validation and remains spaces in the draft. Duplicate section ids fail validation and remain in the draft. Duplicate image ids inside one carousel do too. The same image id in two carousels is valid.

The reducer tests also cover commands for a missing id or the wrong section type, and those commands do not consume the next id. Removing an unselected section keeps the selection. Removing one of several sections or slides that share an id leaves the later copies. Move down swaps one neighbor and keeps the selection. An image edit stays on that slide and that carousel. Import selects the first section, or null when the file is empty, and an import during `saveStarted` leaves `pendingSave` in place. An acknowledgement whose sequence is greater than `localSequence` is ignored. `conflictObserved` during `saveStarted` keeps the pending record, and a later edit keeps status `conflict`. After `saveFailed`, an edit keeps status `error`, and the next `saveStarted` records the newer sequence and the loaded ETag rather than the revision. Hydrate stores that ETag and only `schemaVersion` and `data`. A matching acknowledgement keeps a selected id that is still present and otherwise selects the first section. Reload can store a null ETag, and an empty server document selects nothing.

## Commands and results

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 136 in `@reactiv/editor`. Thirty-three of the editor tests are the reducer and provider cases.
- `pnpm typecheck` exited 0.

The provider test renders the initial editor through context. It does not mount the route. The route file was not changed.

## Acceptance progress

No acceptance ID fully passes.

R02: move and update keep each section's id with its own fields. `validateDraft` reports duplicate ids. The import screen that rejects those files, and save/reload of the ids, are later. R02 does not pass.

R01: the draft is one document. The preview does not read it yet. R01 does not pass.

The stale `saveAcknowledged` test is the pure-state half of R05. R05 does not pass until the UI test in prompt 21.

A01 does not pass. Context and `useReducer` exist, and the route does not render through them yet. That is prompt 12.

F04 does not pass. Reorder is modeled in the reducer. The preview does not show it.

Page 1–2, Editor Behaviour, is modeled for multiple sections, reorder, and independent fields. It does not pass until the preview shows those edits without a save.

Page 1, state management: Context and `useReducer` are the approach. The route still shows JSON.
