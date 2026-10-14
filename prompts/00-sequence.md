# Prompt sequence: Reactiv home screen editor

Run these prompts one at a time, in order, each in its own coding-agent session. Stop at the end of a prompt. Do not start the next prompt in the same session.

The workspace to implement in is `C:\Users\atrone\cursorProjects\reactiv-take-home`. Do not modify files under `prompts/`.

## Sources

Read these before prompt 01, and again whenever a later prompt cites them. They are inputs, not an existing implementation.

- Architecture: `C:\Users\atrone\cursorProjects\reactiv-take-home\docs\Reactiv_Assessment_Architecture_Client_Inspired.md`
- Take-home PDF: `C:\Users\atrone\cursorProjects\reactiv-take-home\docs\Reactiv - Take-Home Challenge - Full Stack - Build a Mobile App Home Screen Editor + Backend API.pdf`
- Acceptance criteria: `C:\Users\atrone\cursorProjects\reactiv-take-home\docs\Reactiv_Acceptance_Criteria(5).pdf`

## How to run one prompt

1. Read that prompt file completely.
2. Read the source sections it names.
3. Inspect the repository and confirm the prompt's preconditions. If a precondition is missing, stop and say so. Do not silently redo earlier prompts.
4. Implement only that prompt.
5. Run the verification it names. Fix failures before finishing.
6. Append a factual note to `docs/ai-notes/` as the prompt requires.
7. Stop. Report which acceptance IDs now fully pass, with the command or walkthrough that showed it.

## Locked choices

The PDF allows more than one stack. The acceptance checklist offers suggested numbers and says an equivalent choice is acceptable when it is documented. This sequence follows the architecture note.

| Topic | Implement this | Do not implement this |
| --- | --- | --- |
| UI framework | React Router v7 framework mode, server runtime on, TypeScript strict | Next.js, a static SPA with client-only fetching, React Router data mode as the app shell |
| API | REST under `/v1/configurations` | GraphQL |
| Processes | `apps/editor` and a separate Fastify `apps/config-service` | The editor importing the database, or the browser calling the private service |
| Storage | Postgres, SQL migrations, Docker Compose named volume | In-memory, SQLite, or file storage as the submitted store |
| Document | Architecture discriminated union: `schemaVersion`, `data.sections[]` with `type` of `carousel`, `text`, or `cta` | A nested `settings` wrapper, a second `position` field |
| Extra metadata | Service-owned `revision` plus strong `ETag` / `If-Match` | Letting the browser set `id`, `updatedAt`, `revision`, or tenant |
| Landscape ratio | `16 / 9`. Portrait `3 / 4`. Square `1 / 1`. `object-fit: cover` | Treating the checklist's suggested landscape `4 / 3` as mandatory. Document `16 / 9` in the README |
| Limits | Architecture section 5, listed again in prompt 02 | The checklist's example of 1 MiB, 50 sections. Those are an alternative, not this contract |
| Save | Manual Save. Preview is local | Autosave |
| Configurations in the UI | One server-selected demo configuration | A configuration picker. Create and load-by-id still exist on the API |
| Reorder | Move up and move down buttons | Drag-and-drop |
| Scope of the submission | Required criteria F, D, A, P, Q and recommended criteria R01–R09 | Publish pipeline, CDN, Shopify, native apps, quizzes, claimed SLOs |

`R05` in the acceptance PDF is the in-flight save rule: save snapshot A, edit to B while that save is pending, then when A's save completes the preview still shows B, the editor stays unsaved, and reload shows A. The PDF table splits that sentence away from the `R05` label. It is not the carousel rule. `R06` is reserved carousel frames and broken-image placeholders.

Production extensions `SCL01`, `SCL03`, and `SCL04` are prompts 32 and 33. Do not start them until prompt 31 passes, and do not start them at all unless the user asks. Conditional updates that satisfy the behavior in `SCL02` are part of prompt 21 because the architecture requires them for this editor. The README must describe that as demo optimistic concurrency, not as a production multi-region product.

## Order

| Prompt | File | What it adds | Acceptance IDs that fully pass here |
| --- | --- | --- | --- |
| 01 | `01-scaffold-the-workspace.md` | Workspace, both processes, Compose, env template | None yet. Stack choices are fixed |
| 02 | `02-shared-contracts-and-validation.md` | Zod document, error, and limit schemas plus unit tests | None yet. D07 rules exist as unit tests; the API enforces them in prompt 07 and D07 fully passes in prompt 19 |
| 03 | `03-section-model-registry-and-defaults.md` | Defaults, stable IDs, static registry, demo document fixture | None yet. R03's code seam exists; the README half passes in prompt 30 |
| 04 | `04-postgres-repository.md` | Migration, tenant-scoped repository, conditional update | None yet. P06 is fully proven through the API in prompt 07 |
| 05 | `05-configuration-service-auth-and-errors.md` | Auth, error shape, body limits, request IDs | None yet. A08 is fully proven across all three operations in prompt 07 |
| 06 | `06-create-and-load-configuration.md` | `POST` and `GET` | A03, A04 |
| 07 | `07-conditional-update.md` | `PUT` with `If-Match`, coherent commits | A02, A05, A06, A07, A08, D05, D06, P06. The API half of D07 is required here; D07 fully passes in prompt 19 once import uses the same rules |
| 08 | `08-demo-seed-and-startup.md` | Deterministic seed, missing-env failures | Q03 |
| 09 | `09-server-only-configuration-client.md` | Editor's only private HTTP client | None yet. A09 and A10 are fully proven in prompt 25 |
| 10 | `10-loader-and-action-mediation.md` | Server loader and action, demo scope | A11. A10's path exists; browser proof is prompt 25 |
| 11 | `11-editor-reducer.md` | Draft reducer, selection, dirty flag, loose draft strings | R02 at reducer level is necessary but the full ID, including import and reload, passes in prompt 20 |
| 12 | `12-editor-shell-and-reorder.md` | Editor chrome, add, move, remove, responsive frame | A01 |
| 13 | `13-text-section.md` | Text inspector and preview | Safe-rendering half of D07. F08 and F09 editing behavior is the exit gate; both fully pass in prompt 20 once export and reload keep the text |
| 14 | `14-cta-section.md` | CTA inspector and preview | F10 |
| 15 | `15-carousel-section.md` | Carousel inspector and preview | F05, F06. F07 geometry is the exit gate; F07 fully passes in prompt 20 once a ratio survives export and reload |
| 16 | `16-live-preview-behavior-tests.md` | Automated edit/preview coverage | F02, F03, Q02, R01 |
| 17 | `17-image-resilience.md` | Reserved frames, broken images, lazy loading | None yet. The R06 frame and placeholder behavior is the exit gate; R06 fully passes in prompt 20 once a broken image still allows export and Save |
| 18 | `18-json-export.md` | Export the current valid draft | D01 |
| 19 | `19-json-import.md` | Atomic import rejection and replacement | D03, D04, D07. D02's import half is necessary; D02 fully passes in prompt 20 because it includes Save and reload |
| 20 | `20-save-and-reload.md` | Manual Save and refresh | F01, F04, F07, F08, F09, D02, P01, P02, R02, R06 |
| 21 | `21-save-reconciliation-and-conflicts.md` | In-flight edits, conflicts, dirty revalidation | R05. Demo behavior described by SCL02, without a production claim |
| 22 | `22-failure-recovery.md` | Failed load and failed Save | P03, P04 |
| 23 | `23-limits-and-inline-validation.md` | Shared limits at UI and API, in-progress input | F12, R07 |
| 24 | `24-correlation-and-redaction.md` | Request IDs across both logs and the UI | R09 |
| 25 | `25-credential-boundary-proof.md` | Bundle, network, and export inspection | A09, A10, Q01 |
| 26 | `26-responsive-and-accessibility.md` | 375, 768, 1440 and keyboard behavior | F11 |
| 27 | `27-brand-fixtures.md` | Two brand documents, no hardcoded brand colors | R04 |
| 28 | `28-preview-benchmark.md` | Honest local preview measurement | R08 |
| 29 | `29-end-to-end-and-restart.md` | Browser journeys and Postgres restart | P05's restart evidence. The README half of P05 passes in prompt 30 |
| 30 | `30-readme-architecture-and-decision-log.md` | README, architecture, 1–2 page Decision Log | D08, P05, Q04, Q05, R03 |
| 31 | `31-submission-gate.md` | Clean-checkout run of the documented commands | Q06 |
| 32 | `32-optional-tenant-isolation.md` | Only if the user asks. Local tenant isolation and RLS | SCL01, if this prompt is actually completed |
| 33 | `33-optional-restore-and-production-notes.md` | Only if the user asks. Local restore drill and honest non-claims | SCL03 and SCL04 only as documented non-claims plus a local drill |

## Coverage check

After prompt 31, these IDs must fully pass: F01–F12, D01–D08, A01–A11, P01–P06, Q01–Q06, R01–R09.

These IDs must not be claimed as production capabilities after prompt 31: SCL01, SCL03, SCL04. SCL02's conflict behavior is implemented for the demo API in prompt 21 and must be described with that limit.

PDF traceability, so a later prompt does not drop a page-4 requirement:

| PDF requirement | Where it fully passes |
| --- | --- |
| React Router v7 or Next.js, TypeScript preferred, REST or GraphQL, Context or equivalent | A01 in prompt 12, using the locked choices above |
| Carousel, text, and CTA fields | F05 and F06 in prompt 15; F10 in prompt 14; F07, F08, and F09 in prompt 20 |
| Live preview, multiple sections, reorder, responsive UI | F02 and F03 in prompt 16; F01 and F04 in prompt 20; F11 in prompt 26; F12 in prompt 23 |
| JSON import/export and invalid files | D01–D04 in prompts 18–20 |
| Configuration metadata, payload, storage tradeoffs | D05–D06 in prompt 07; P05–P06 in prompts 07, 29, and 30 |
| Load, create, update, validation, errors, schema evolution | A02–A08, D05, and D06 in prompt 07; D07 in prompt 19; D08 in prompt 30 |
| Private authentication and server-only credentials | A08 in prompt 07; A09 and Q03 in prompts 08 and 25 |
| Loaders, actions, and refresh persistence | A10–A11 and P01–P04 in prompts 10, 20, 22, and 25 |
| Separation of concerns, tests, env vars, graceful errors | Q01–Q03 and F12 and P03–P04 |
| Decision Log, README, public-repo readiness | Q04–Q06 in prompts 30 and 31 |

## Notes the implementing agent must keep

From prompt 01 onward, keep `docs/ai-notes/`. Prompt 30 turns those notes into the submitted Decision Log. The log has to describe what actually happened. Do not invent an AI rejection, a prompt, or a test result to make the log look complete.
