# 18 — JSON export

13 October 2026. Prompt 19 was not started.

## File

`Export JSON` is enabled. Save and Import JSON stay disabled and still say `Not available yet`.

A click runs `validateDraft` on the current draft, including unsaved edits. When that fails, nothing is downloaded. The inspectors keep the inline field errors they already show, and a status message says `Fix the highlighted fields before exporting.` The draft is not changed.

When validation succeeds, the browser downloads `home-screen.json`. The text is pretty-printed JSON with a two-space indent. The blob type is `application/json;charset=utf-8`. The object has `schemaVersion` and `data` only. Colors in the file are lowercase `#rrggbb`. Section order is the draft order. Export does not dispatch, so it does not clear `dirty`, and it does not call the configuration service.

Tests replace `jsonFileDownload.save`. The real method stays in place for the browser. Import is not implemented.

The top-level keys of a file exported after editing a title are only these:

```json
{
  "schemaVersion": 1,
  "data": {
    "sections": [
      {
        "id": "section-text-1",
        "type": "text",
        "title": "Café evening",
        "description": "…",
        "titleColor": "#aabbcc",
        "descriptionColor": "#334455"
      }
    ]
  }
}
```

The other sections were in that file and are omitted here. The typed title color was `#AbC`. The file stored `#aabbcc`. The input stayed `#AbC`. There is no configuration id, `revision`, `updatedAt`, `tenantId`, credential, selected section, or save status.

## Checks

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 220 in `@reactiv/config-service`, and 271 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- In the browser, on `http://127.0.0.1:5173/`, the first text title was changed to `Café evening` and its title color to `#AbC`. Export JSON downloaded one `home-screen.json` blob. The parsed title was `Café evening`, the title color was `#aabbcc`, and the top-level keys were `schemaVersion` and `data`. The page made no fetch. The service log shows no request after the page load. Setting the title color to `nope` left `Café evening` in the title, kept `Title color must be a hex color like #112233.`, showed `Fix the highlighted fields before exporting.`, and did not start a second download.

## Acceptance progress

D01 passes. Export downloads parseable JSON of the current draft, including unsaved edits. It includes `schemaVersion` and preserves sections, order, image URLs, ratios, copy, links, and colors. Credentials and transient UI state are absent. Evidence: the export tests.

Page 2, Import / Export, export half: the current portable document can be exported as a JSON file. The import half and malformed-file handling do not pass until prompt 19.

R06 is not fully passed. A syntactically valid image URL can now be exported, including one that fails to load, because `validateDraft` still accepts it. The explicit test that a 404 does not block export or Save remains prompt 20.
