# Prompt 20 — Save and reload

Implement only this prompt. Preconditions: prompt 19 is done. Import and export tests pass. The server action from prompt 10 can update the demo configuration.

## Read first

- Architecture section 7, the Save sequence
- Architecture section 6, success only after acknowledgement, and do not reseed on failure
- Take-home PDF page 3, suggested user flow, and the sentence that reloading restores the persisted configuration
- Acceptance criteria F01, F04, D02, P01, P02, R02

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Show a saved confirmation only after the configuration service acknowledges the write.
- The browser posts to the editor action. It does not post to port 4001 and it does not attach the private token.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/20-save-and-reload.md`.
- In-flight edit reconciliation beyond a correct `saveStarted` / `saveAcknowledged` wiring can be refined in prompt 21. This prompt must not report success for a request that failed, and must not drop the draft on failure. Prompt 22 makes failure UX complete if you only stub it here. Prefer a correct basic failure message now if it is small: keep the draft and show the error. Prompt 22 will add retry.

## Goal

The user edits, the preview updates, the user presses Save, and a later reload shows the saved screen. Clearing `localStorage` does not change that result.

## Implement

1. Enable `Save`. It is disabled when `validateDraft` fails or when `dirty` is false. When disabled because of validation, the existing field errors remain visible.
2. On Save, build the `EditableDocument` from the draft, dispatch `saveStarted`, and submit `{ document, baseEtag }` to the route action with `useFetcher`. Do not navigate away from the editor.
3. The action remains the prompt 10 action: server-side validation, demo id from the server, `PUT` with `If-Match`.
4. When the fetcher returns the updated configuration, dispatch `saveAcknowledged` with that payload and the sequence captured at `saveStarted`.
5. Success UI: a polite live region `Saved.` only in the branch where the acknowledged sequence matches and `dirty` is false. If you cannot yet hit the mismatched-sequence branch from the UI, leave that branch in the reducer and cover it in prompt 21. Do not show `Saved.` merely because the fetcher settled.
6. The loader on a full page reload hydrates a clean editor from the stored configuration. It still must not invent a default when the service is down.
7. Tests:
   - Integration or route test: Save posts to the app action, the action calls `updateConfiguration` with the demo id and the ETag, and the returned sections include the edited title
   - After a successful acknowledgement, `dirty` is false
   - A reload loader result equal to the saved document renders that title
   - Clearing storage is asserted by a test that the loader path does not read `localStorage`. A Playwright test can also clear `localStorage` and reload if the app is easy to boot. At minimum, a code-level test proves the hydrate source is the loader data
   - Round-trip fixture used for F04, F07, F08, F09, D02, and D06: two of each section type, distinct title and description colors, a multiline Unicode description, one carousel set to portrait, and reordered sections. Export, save, reload, and compare the payload, including section ids
   - Import a valid file, see `Imported, not saved.`, Save, load again, and compare to the imported payload. This closes D02
   - A syntactically valid image URL that fails to load still shows `Image unavailable`, and Export and Save both succeed. This closes R06
   - The browser-side save helper test fails if `Authorization` is set on the fetcher request

Also run the existing reducer tests so `saveAcknowledged` still preserves a newer sequence.

## Out of scope

- The full conflict screen, the delayed-response race UI test, and failed-load recovery beyond what prompt 10 already does. Prompts 21 and 22 cover them.
- Do not add autosave.

## Acceptance criteria that fully pass

- **F01.** First use after the seed shows the documented demo home screen. When a saved configuration exists, reload loads that configuration into the editor and the preview. A successful load does not substitute an unrelated default. Evidence: seed plus reload test. A failed load must still not substitute defaults; keep the prompt 10 behavior.
- **F04.** Reorder, including two sections of the same type moving past each other, is reflected in the editor, the preview, the export, and a saved reload. Each section keeps its own settings. Evidence: the round-trip fixture. Move buttons remain the mechanism.
- **D02.** Importing a valid export replaces the draft and the preview. Save and reload restore that payload. The UI shows `Imported, not saved.` until Save. Evidence: import-then-save test.
- **P01.** Save persists the current valid ordered payload through the server action and the private API. Success is shown only after acknowledgement. The browser does not hold the private key. Evidence: action test and the live-region assertion.
- **P02.** After Save, refresh restores the payload through the backend. The restore path does not depend on `localStorage`. Evidence: loader test after a saved write, and a test or inspection that hydrate reads loader data.
- **R02.** Section ids survive edit, reorder, export, import, and save/reload. New sections get new ids. React keys are section ids. Duplicate ids in an import are rejected, which prompt 19 already proved. Evidence: the round-trip fixture asserts ids, plus the prompt 19 duplicate test still passes.
- **F07.** The round-trip fixture sets a carousel to portrait and, after export, import, save, and reload, the frame is still portrait (`3 / 4`). Landscape remains `16 / 9` and square remains `1 / 1` in the renderer from prompt 15.
- **F08.** The round-trip fixture includes a multiline Unicode description. It is still that text after export, import, save, and reload.
- **F09.** The round-trip fixture gives the two text sections different title and description colors. Each color is still on the same section after reload.
- **R06.** A carousel whose image URL is syntactically valid and returns 404 still shows `Image unavailable`, and Export and Save stay available. Saving that document succeeds. The 404 does not remove the URL from the draft.

## Take-home PDF requirements that fully pass

- Page 3, suggested user flow: load a saved or seeded configuration, edit, preview updates immediately, Save, refresh restores the saved configuration.
- Page 1 and page 3: reloading the page restores the persisted configuration.
- Page 3: persistence goes through the server action. Autosave is not implemented, which the PDF allows.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manual: change a title, Save, clear site data for localhost in the browser, reload, confirm the title remains. Stop before prompt 21

## Done when

- The IDs above pass.
- The note records the manual clear-site-data result.
- You have not started prompt 21.
