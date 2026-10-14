# Prompt 11 — Editor reducer

Implement only this prompt. Preconditions: prompt 10 is done. The loader returns the demo configuration. The page may still show JSON.

## Read first

- Architecture section 6, state ownership, reducer commands, selection, and the rule that invalid in-progress strings are kept while typing
- Architecture section 5, "Allow incomplete values while typing"
- Take-home PDF pages 1–2, Editor Behaviour: real-time changes, multiple sections, reorder
- Acceptance criteria F04, R01, R02, A01. None fully pass in this prompt except the pieces the tests actually cover. R02's full pass is prompt 20. A01's full pass is prompt 12

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- One draft is the source of truth for later inspectors and the preview. Do not keep a second copy of the sections in component state.
- UI-only fields stay outside the portable document: selection, save status, validation issues, in-flight metadata.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/11-editor-reducer.md`.
- Do not implement the visual preview in this prompt. Pure state and tests only, plus the context providers if they have no presentational children yet.

## Goal

A `useReducer` state machine that can add, remove, reorder, and edit the three section types, including carousel images, and that can accept a future import and a future save acknowledgement without losing newer local edits.

## State

```ts
type EditorState = {
  draft: DraftDocument;
  selectedSectionId: string | null;
  savedBaseline: EditableDocument | null;
  baseEtag: string | null;
  dirty: boolean;
  status: "idle" | "saving" | "saved" | "error" | "conflict";
  localSequence: number;
  pendingSave: { sequence: number; etag: string } | null;
};
```

`DraftDocument` mirrors `EditableDocument`, but color and URL fields are plain strings that may be invalid while typing. Other constraints, such as duplicate ids, are reported by a validator rather than repaired inside the reducer.

`localSequence` increments on every user edit. It does not increment when a save acknowledgement arrives.

## Commands

Implement these and no ad hoc setters:

- `hydrate` — used once from loader data when the state is still the initial empty state. Sets the draft, the saved baseline, and `baseEtag`. Selects the first section if any. `dirty` is false.
- `addSection` — appends a factory-built section of the given type with a new id from the injected generator. Selects it. Marks dirty. Increments `localSequence`.
- `removeSection` — removes by id. If it was selected, select the next section, otherwise the previous, otherwise null. Dirty and sequence update.
- `moveSection` — `up` or `down` by id. No-op at the ends. Selection stays on the moved id. Order of the other sections is otherwise unchanged. Dirty and sequence update.
- `updateSection` — replaces one section's editable fields by id. Does not change its id or type. Does not touch other sections. Dirty and sequence update.
- `addImage`, `updateImage`, `removeImage` — operate on one carousel by section id and image id. New image ids come from the generator. Removing the last image leaves `images: []`. Dirty and sequence update.
- `importDocument` — replaces the draft with a validated `EditableDocument`, keeps `baseEtag` and `savedBaseline` unchanged, selects the first section, sets `dirty` true, increments `localSequence`, and sets status to `idle`. This command trusts its caller. The import prompt is responsible for validating before dispatch.
- `saveStarted` — records `{ sequence: localSequence, etag: baseEtag }` and sets status `saving`. Does not change the draft.
- `saveAcknowledged` — input is the server configuration and the sequence that was saved. If `localSequence` still equals that sequence, replace the draft with the server document, update the baseline and `baseEtag`, clear `pendingSave`, set `dirty` false and status `saved`. If `localSequence` is greater, update only the baseline and `baseEtag`, clear `pendingSave`, leave the draft and `dirty` true, and set status `idle`. Never apply this command by wiping a newer draft.
- `saveFailed` — status `error`, clear `pendingSave`, leave the draft.
- `conflictObserved` — status `conflict`, leave the draft and `dirty` unchanged.
- `reloadFromServer` — explicit user action. Replaces the draft and baseline with the server document, updates `baseEtag`, clears dirty and conflict.

Do not implement a command that silently merges a loader payload over a dirty draft. Prompt 21 wires revalidation to these commands.

## Tests

Use a deterministic id generator.

- Adding two sections of the same type gives them different ids and different default content.
- Updating the first text title does not change the second text title.
- Moving the second carousel above the first swaps those ids and keeps each carousel's image URLs with its id.
- Move up on the first section and move down on the last section are no-ops.
- Removing the selected middle section selects a neighbor.
- Removing the last image leaves an empty list and does not remove the carousel.
- `importDocument` changes the draft and leaves `baseEtag` at the previous value.
- Save snapshot at sequence N, then edit, then `saveAcknowledged` for sequence N: the draft still shows the edit, `dirty` is true, and `baseEtag` is the acknowledged tag.
- `saveAcknowledged` when the sequence matches replaces the draft and clears dirty.
- `hydrate` does not run a second time in a way that clobbers a dirty draft. If `hydrate` is dispatched while `dirty` is true, ignore it.

Export `validateDraft(draft)` that uses the shared schema after normalizing colors, and returns either an `EditableDocument` or the issue list. Invalid in-progress color strings fail this function and remain in the draft. Unit-test that split.

## Context

Add `EditorStateContext` and `EditorDispatchContext` in `apps/editor/app/features/editor/`. The page does not need to use them for a polished UI yet. A test can render a provider. Do not introduce Redux, Zustand, or a global store.

## Out of scope

- Presentational inspectors, CSS, Save button, fetch wiring except the pure commands above.

## Acceptance criteria

No acceptance ID fully passes.

Progress that must be true:

- R02: identity is stable across the reducer's move and update tests. Import rejection of duplicate ids and save/reload are later, so R02 does not pass.
- R01: the draft is one document. The preview does not read it yet.
- The save-acknowledgement test is the pure-state half of R05. R05 does not pass until the UI test in prompt 21.

## Take-home PDF requirements

Page 1–2, Editor Behaviour, is modeled: multiple sections, reorder, and independent fields. The requirement does not pass until the preview shows those edits without a save.

Page 1, state management: Context and `useReducer` are now the approach. A01 passes in the next prompt once the route renders through that context.

## Verification

- `pnpm test`
- `pnpm typecheck`

## Done when

- The reducer tests above pass.
- The note records the `saveAcknowledged` branch you implemented for a stale sequence.
- You have not started prompt 12.
