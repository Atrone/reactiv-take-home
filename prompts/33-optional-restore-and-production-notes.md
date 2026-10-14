# Prompt 33 — Optional restore drill and production non-claims

Do not run this prompt unless the user explicitly asks for a restore drill or for the production-extension notes. Prompt 31 must already be done. If the user asked for both optional prompts, run prompt 32 first.

## Read first

- Architecture sections 10–12 and 17. These describe a proposed enterprise system and chosen targets. They are not measurements of this repo
- Acceptance criteria SCL03 and SCL04
- The current README and `docs/architecture.md`

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Do not implement a CDN, an outbox publisher, multi-region failover, or a load generator and then call the architecture targets met.
- Do not invent latency, availability, or throughput numbers.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/33-optional-restore-and-production-notes.md`.

## Goal

Record an honest local restore drill, and write down the production targets as targets that this repository has not proven.

## Implement

1. Restore drill, local only:
   - Save a distinctive configuration
   - Take a `pg_dump` of the database to a file outside the git tree, or to a path listed in `.gitignore`
   - Delete the demo row, or restore into a second empty database
   - Restore the dump
   - `GET` the configuration and assert the title, revision, and tenant id match the dump
   - Automate this if you can. If it is a script, run it and keep the output in the note
2. Write `docs/production-extensions.md` that states, in separate sections:
   - **Not built:** immutable publish artifacts, outbox worker, CDN, shopper delivery path, compatibility gates for native clients, multi-region writer failover, autosave, Shopify connectors
   - **SCL03:** no capacity claim is made. Quote the architecture envelope as a future test plan, including the 100,000 delivery requests per second figure, and say this repo has not run that test. Do not copy the figure into the README feature list
   - **SCL04:** the local dump/restore result you just observed, the restart result from prompt 29, and an explicit statement that no availability percentage or recovery-time objective has been measured
   - The preview benchmark remains a local authoring measurement, not a shopper measurement
3. Update the README with one paragraph that points at `docs/production-extensions.md` and repeats that those targets are not claims.

## Acceptance criteria

- **SCL03 does not pass.** The criterion requires a reproducible capacity test with latency and error distributions. This prompt forbids claiming that test. The row in `docs/submission-checklist.md` stays `not claimed`.
- **SCL04 does not pass as a production objective.** You may record that a local dump and restore recovered the last dumped configuration. The criterion's availability and recovery objectives need measured evidence this repo does not have. Mark the row `local restore only`.

## Take-home PDF requirements

The PDF does not require this prompt. Page 4, pragmatism, is protected by refusing to claim the enterprise design.

## Verification

- Run the dump and restore
- Read `docs/production-extensions.md` and confirm it contains no sentence like "the system achieves" or "meets the SLO"
- `pnpm test` still passes

## Done when

- The drill result is in the note and the production doc states the non-claims.
- Stop. The prompt sequence is finished.
