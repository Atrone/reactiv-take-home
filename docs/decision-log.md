# Decision log

Phase 1 planning used ChatGPT with memory and a 6.1 Sol max model, and a thin system prompt. Phase 2 used Cursor with Grok 4.7 at a very high setting. That system prompt required a comment on every function and class. Notes for prompts 01–29 are in `docs/ai-notes/`. The Phase 2 notes skip Decision 3, so this log does not invent one.

## Planning

I gave the model the evaluation context from the call that is not in the PDF, and asked for the next step that would most improve the odds of passing. It said to write acceptance criteria first, use the recommended stack, and record decisions immediately. I then read public Reactiv project descriptions, separated published facts from architectural inferences, and treated extra client-inspired capabilities as optional. The architecture stayed a proposal until the build checked it.

I asked twice for acceptance criteria that also covered behaviors inferable from public Reactiv work. That produced two PDFs. I checked each against the assessment and kept the one with clearer, independently checkable behaviors, because the next phases would be a partial build and then a human check.

I asked twice for an architecture inspired by public client examples. The two results were similar. I kept the client-inspired one because it protects edits made during a pending save and stays inside the assessment, instead of centering scale. A successful save of snapshot A must not replace draft B. I added that case to the criteria: the preview keeps B, the editor stays unsaved, and a reload shows A. The component test is `keeps B when A's save completes, and a reload shows A`.

## Implementation

I asked for a step-by-step prompt set, erring toward more steps, each naming the criteria and PDF requirements for that step. The result is prompts 01–31 in `prompts/`. `prompts/00-sequence.md` is the index. Optional prompts 32 and 33 were not started. I reviewed the order against the PDF, the criteria, and the boundaries. The data model, API, and persistence come before editor behavior, and tests arrive along the way. I did not find a sequencing problem large enough to rewrite the plan, so I accepted it.

I then ran one prompt at a time and compared the code and tests with the PDF, the criteria, and the architecture before continuing. After each implementation prompt I required automated tests of observable behavior and the edge cases found while building. A one-off CLI check does not survive the next prompt. `pnpm test` is the Vitest suite. Playwright covers the carousel, the viewports, the journeys, and the credential boundary. The restart check is `scripts/restart-check.ps1`.

## Later changes

After the required behavior was in place, I replaced the Move up and Move down buttons with dragging a section. Arrow Up and Arrow Down on the drag handle still reorder. I added a color picker beside each color field. It writes the same input. I then adjusted spacing, type, borders, and hierarchy from public Reactiv material, without copying a screen or adding a feature.

## Tradeoffs in the code

React Router 7.18.4 framework mode, not the PDF's Next.js option. Loaders and actions are the server boundary. REST under `/v1/configurations`, not GraphQL: create, load, and a conditional update. A separate Fastify service, not a route that opens the database. The editor does not depend on `pg`, and the browser does not call the private API.

Postgres on the named volume `reactiv_pg`, not SQLite, files, or memory. On 13 October 2026 a config-service restart against that volume kept revision 18 and the title from that run. Deleting the volume drops the data. Concurrency is one conditional `UPDATE` on `revision`. There is one demo tenant. Row-level security is not enabled. Manual Save, not autosave. The preview is local reducer state, so typing does not save.

## With more time

I would add the schema migration function described in the README. It does not exist yet. I would also add a configuration picker, a reviewed publish step separate from Save, and real sessions, and I would check in the CI workflow the notes describe. I would not claim a content delivery network, an availability percentage, or a multi-tenant production product until those existed and were measured.
