# 06 — Create and load a configuration

12 October 2026. Prompt 07 was not started. `PUT` is not registered.

## Create and load

`POST /v1/configurations` accepts an `EditableDocument`. The service parses that body with `editableDocumentSchema` again, including when a caller already checked it. `id`, `revision`, and `updatedAt` are not read from the body. The service assigns `cfg_` plus a UUID, the insert stores revision 1, and `updated_at` stays on the database default. Success is HTTP 201, `Location: /v1/configurations/<id>`, `Content-Type: application/json; charset=utf-8`, and a strong `ETag` whose value is the quoted revision, for example `"1"`. The response body is the `Configuration` returned by the repository.

`GET /v1/configurations/:id` loads that id for `DEMO_TENANT_ID` only. A hit is 200 with the same strong ETag and `Cache-Control: private, no-store`. A miss is 404 `NOT_FOUND` with `Configuration not found.` The message does not say whether another tenant has the id. The repository call includes the server tenant. `X-Tenant-Id` is still ignored. There is no list route. `PUT` is still unregistered.

An invalid document is 422 `VALIDATION_FAILED` with `issues` and field paths. The repository is not called, so a previously stored row keeps its id, revision, timestamp, and sections. Malformed JSON is still 400 `MALFORMED_JSON`. An oversized body is still 413 `PAYLOAD_TOO_LARGE`.

The process opens a Postgres pool from `DATABASE_URL` and passes it to the repository. Constructing the pool does not query. `GET /health` still does not read rows. The first query is create or load.

Authentication tests still build the server with configuration routes omitted so their probe handlers can occupy `POST`, `GET`, and `PUT`. The create and load tests use the real routes.

## Sample 201

The request was `POST http://127.0.0.1:4019/v1/configurations` with `Authorization: Bearer [redacted]` and `Content-Type: application/json`. The response headers were `ETag: "1"`, `Location: /v1/configurations/cfg_cf3bb862-29d7-4c7b-8ac1-00ddbd5d0901`, `Content-Type: application/json; charset=utf-8`, and `Cache-Control: private, no-store`. There was no `Access-Control-Allow-Origin`. The body was:

```json
{
  "schemaVersion": 1,
  "data": {
    "sections": [
      {
        "id": "section-1",
        "type": "carousel",
        "images": [
          {
            "id": "section-2",
            "url": "https://example.com/demo/arrival-window.jpg",
            "alt": "Shop window with a new arrival display"
          },
          {
            "id": "section-3",
            "url": "https://example.com/demo/reading-table.jpg",
            "alt": "Front table stacked with featured books"
          }
        ],
        "aspectRatio": "landscape"
      },
      {
        "id": "section-4",
        "type": "text",
        "title": "New this week",
        "description": "A short list from the front table.",
        "titleColor": "#112233",
        "descriptionColor": "#334455"
      },
      {
        "id": "section-5",
        "type": "cta",
        "label": "Continue",
        "url": "https://example.com/continue",
        "backgroundColor": "#243044",
        "labelColor": "#ffffff"
      },
      {
        "id": "section-6",
        "type": "carousel",
        "images": [
          {
            "id": "section-7",
            "url": "https://example.com/demo/staff-stack.jpg",
            "alt": "Staff picks stacked on a wooden counter"
          },
          {
            "id": "section-8",
            "url": "https://example.com/demo/quiet-corner.jpg",
            "alt": "Chair in a quiet corner of the shop"
          }
        ],
        "aspectRatio": "portrait"
      },
      {
        "id": "section-9",
        "type": "text",
        "title": "From the floor",
        "description": "Notes from the people who unpack the boxes.",
        "titleColor": "#3d2b1f",
        "descriptionColor": "#5c6b73"
      },
      {
        "id": "section-10",
        "type": "cta",
        "label": "See the list",
        "url": "https://example.com/list",
        "backgroundColor": "#1f4d3a",
        "labelColor": "#f7f3ea"
      }
    ]
  },
  "id": "cfg_cf3bb862-29d7-4c7b-8ac1-00ddbd5d0901",
  "revision": 1,
  "updatedAt": "2026-10-12T21:54:01.139Z"
}
```

`GET` of that id with the bearer token returned 200 and the same body, with `ETag: "1"` and `Cache-Control: private, no-store`. `GET` of that same id without a token returned 401. The process log recorded `UNAUTHORIZED` for request id `4003e223-1a8e-4614-a3d0-e676bf34d52b` and did not contain the token or the database URL. The sample row was then deleted. A count of that id afterward was 0. `cfg_demo` is still not seeded.

A later unauthenticated `GET` of `cfg_missing` returned this body and `X-Request-Id`, with no `Access-Control-Allow-Origin`:

```json
{"error":{"code":"UNAUTHORIZED","message":"Authentication failed.","requestId":"d7b7ed30-3dae-4471-9085-ef935ac7e235"}}
```

## Commands and results

- `pnpm test` exited 0. Vitest 5.0.4 passed 62 tests in `@reactiv/contracts`, 139 in `@reactiv/config-service`, and 10 in `@reactiv/editor`.
- `pnpm typecheck` exited 0.
- With Postgres running, `Invoke-WebRequest` created the document above and fetched it with the bearer token. The fetch without the token returned 401.

## Acceptance progress

A03 passes. Loading the created id returns that configuration. An unknown id returns 404, and an id stored for another tenant returns 404 without that tenant's document. Evidence: the known-id, unknown-id, and other-tenant tests.

A04 passes. A valid create returns 201 with a service-generated id. A second create returns a different id, and the first payload is unchanged. Evidence: the create, load, and second-create tests.

A02 does not pass. Update is not implemented.

A08 does not pass. Create and load reject a missing credential and a wrong credential before the repository is called, and an unauthenticated create leaves the tenant row count unchanged. Update is not covered.

D05, D06, and D07 do not pass. Create and load return `id`, `schemaVersion`, `updatedAt`, `data`, and `revision`, and rejected creates leave the stored document unchanged. Update responses and a stored-record comparison after a rejected update are not done. Import and plain-text rendering are not done either.
