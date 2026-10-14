# Prompt 24 — Correlation and redaction

Implement only this prompt. Preconditions: prompt 23 is done.

## Read first

- Architecture section 7, request ids and the rule to redact authentication and cookies from logs
- Acceptance criteria R09 and the remaining safe-message part of A07
- Take-home PDF page 3, credentials never exposed to the browser, including via logs that a user-facing error might echo

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Logs may include method, path, status, duration, and request id. They must not include the bearer token, cookies, or the configuration JSON body.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/24-correlation-and-redaction.md`.

## Goal

A failed save or load shows a request id the user can read, and the same id appears in the config-service log and the editor-server log, without secrets beside it.

## Implement

1. The editor server client sends `X-Request-Id` on every private-service call. Generate it at the start of the loader or action and pass it through. The service already accepts a safe incoming id from prompt 05.
2. The loader and action include that `requestId` on success metadata and on error results returned to the page.
3. The failure UI from prompt 22 renders `Reference: <id>` for load and save errors.
4. Structured logs on both processes: one JSON line per request with `requestId`, `method`, `path`, and `status`. Redact `authorization`, `cookie`, and `set-cookie` headers if a logger would otherwise print headers. Do not log request bodies.
5. Tests:
   - a failed `PUT` through the app action returns a request id, and a stub service records the same id on the inbound request
   - a log snapshot of a request that carries a bearer token does not contain that token string
   - a log snapshot does not contain a distinctive title string that was present in the document body
   - the UI error state shows the same id

Use an injected logger in tests so you do not depend on stderr capture if that is awkward. The production path should still write the line to stdout.

## Out of scope

- A hosted log vendor, tracing product, or metrics backend. A console JSON logger is enough for R09.

## Acceptance criteria that fully pass

- **R09.** Failed load and save requests carry a safe correlation id from the app server to the service logs and to the user-visible error. A reviewer can match the two layers. Credentials and whole configuration bodies are not logged. Evidence: the tests above.

A07 already passed in prompt 07. This prompt must not regress it by leaking a stack or token in the new log line. Add the redaction test to the A07 evidence in the note.

## Take-home PDF requirements

Page 3, private credentials stay off the client and out of operational output that this app controls. Page 4, graceful errors, now include a reference id a reviewer can use.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Manual: stop Postgres or force a 500, Save, read the on-screen reference, and find the same id in both process logs. Confirm the token is absent. Do not paste the token into the note

## Done when

- R09 passes.
- The note records the manual id match.
- You have not started prompt 25.
