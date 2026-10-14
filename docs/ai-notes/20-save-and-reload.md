# 20 — Save and reload

13 October 2026. Prompt 21 was not started.

## Save

`Save` is enabled when the draft is dirty, `validateDraft` succeeds, and the loader supplied a base ETag. A clean draft stays disabled. An invalid field stays disabled and the inspector errors stay visible. A missing ETag also stays disabled, because `saveStarted` would otherwise do nothing.

A click builds the portable document, dispatches `saveStarted` with the sequence at that moment, and `useFetcher.submit` posts `{ document, baseEtag }` to `/?index` as JSON. The editor stays on the page. The editor route is an index route under the root layout. A POST to `/` alone reaches that layout, which has no action, and the page shows `Method Not Allowed`. The first browser attempt did that. The action path is `/?index`.

The fetcher options have no headers. The request does not set `Authorization` and does not use port 4001. The route action from prompt 10 still validates, takes the demo id from the server, and sends `If-Match`.

`Saved.` is a polite live region (`role="status"`, `aria-live="polite"`). It renders only when the reducer status is `saved` and `dirty` is false, which is the matching-sequence branch of `saveAcknowledged`. A settled fetcher is not enough. If the user has a newer sequence, the reducer keeps that draft dirty and this screen does not say `Saved.`. That mismatch is covered by the existing reducer tests. The delayed-response UI is prompt 21.

A failed action dispatches `saveFailed`, keeps the draft, and shows the action's sentence in an alert. The fallback sentence is `The configuration could not be saved.` A 412 uses this failure path for now. Prompt 21 is the conflict screen. There is no retry button and no autosave.

`Imported, not saved.` is cleared when the acknowledgement leaves the draft clean, so a later edit does not bring that sentence back.

A full reload hydrates from the loader payload. The loader still reads the configuration service. It does not read browser storage, and a failed load still does not invent a document.

## Checks

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 296 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- In the browser, on `http://127.0.0.1:5173/`, the first text title was changed from `New this week` to `Kept after site data`. The section row and the phone preview showed that title before Save. Save then showed `Saved.`, the live region was polite, and Save became disabled. The data request was `http://127.0.0.1:5173/_root.data?index`. No resource request used port 4001. `localStorage` and `sessionStorage` were then set to `Stored only in the browser`, a cookie named `editor-draft` was set, and all three were cleared. After a reload, `localStorage` was empty, the cookie was empty, and both the section list and the preview still showed `Kept after site data`. `New this week` was gone. `From the floor` was still there. Save was disabled. `sessionStorage` afterwards contained only `react-router-scroll-positions`, which the router wrote on that reload.

## Acceptance progress

F01 passes. The first load is the seeded home screen. After Save, a reload loader result renders the saved title. A failed load still does not substitute a default.

F04 passes. The round-trip fixture moves one text section past the other with Move down. Export, the save body, and the reload keep that order and each section's own settings.

D02 passes. Importing the exported file shows `Imported, not saved.`, replaces a temporary title, and Save plus a later loader result match the imported payload, including section ids.

P01 passes. Save posts to the editor action. The action calls `updateConfiguration` with `cfg_demo` and the loaded ETag. `Saved.` appears after that acknowledgement. The fetcher request has no `Authorization` header.

P02 passes. The reload title comes from the loader result. The loader and the hydrate modules do not read `localStorage`. Clearing storage and rendering that loader result still shows the saved title.

R02 passes. The round-trip fixture asserts the same section ids through export, import, save, and reload. The prompt 19 duplicate-id rejection still passes.

F07 passes. The fixture sets one carousel to portrait and leaves the other landscape. After save and reload the frames are `3 / 4` and `16 / 9`. During the same case the landscape carousel is switched to square, the frame is `1 / 1`, and it is switched back to landscape before export. The saved document does not contain a square carousel. The prompt 15 renderer still maps square to `1 / 1`.

F08 passes. The fixture description is `Café`, a line break, `第二行`, a line break, and `Naïve — “quotes”`. That text is still on the same section after export, import, save, and reload.

F09 passes. The two text sections keep `#112233` / `#334455` and `#aa5500` / `#0055aa` on their own ids after reload.

R06 passes. A syntactically valid image URL that fails to load shows `Image unavailable`. Export and Save stay available once the draft is dirty. The saved document still contains the URL.

The suggested flow on page 3 is the browser check above: load, edit, preview updates immediately, Save, refresh restores the stored configuration. Persistence goes through the server action. Autosave is not implemented.
