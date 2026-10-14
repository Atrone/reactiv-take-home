# Prompt 30 — README, architecture, and Decision Log

Implement only this prompt. Preconditions: prompt 29 is done. The journeys and the restart check have been run. `docs/ai-notes/` has notes from the earlier prompts.

## Read first

- Take-home PDF page 4, AI Usage and Submission
- Architecture sections 14, 16, and 17
- Acceptance criteria D08, P05, Q04, Q05, R03
- Every file in `docs/ai-notes/`

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- The Decision Log describes what actually happened in this repository. Do not invent a rejected AI idea, a prompt you did not use, or a test you did not run.
- If a note is missing, inspect the code and write only what you can verify. Say when a note was missing.
- The Decision Log is 1–2 pages. Do not exceed two pages.
- Every new function has a block comment and line comments on the steps inside the body. Documentation files do not need line comments.
- Append `docs/ai-notes/30-readme-architecture-and-decision-log.md` with the list of documents you wrote. The Decision Log itself is `docs/decision-log.md`.

## Goal

A fresh reviewer can set the system up from the README, understand the boundary, and read a short honest account of the AI-assisted decisions.

## README

Write `README.md` at the repo root with:

- What the project is, in one paragraph
- Exact setup: Node version, pnpm, Docker, copy `.env.example` to `.env`, replace `replace-me` with a local token, `docker compose up -d postgres`, `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, start the config service, start the editor
- Required environment variables and the statement that `replace-me` will not boot
- How to run tests, typecheck, Playwright, and the restart check
- High-level architecture: browser, React Router loaders and actions, server-only client, private Fastify API, Postgres. Link to `docs/architecture.md` and `docs/boundary.md`
- Storage tradeoff: Postgres was chosen for a durable volume and conditional updates. The PDF also allows SQLite, files, and memory. Restart keeps data in the named volume. Deleting the volume drops it. In-memory storage was not used. Concurrency is a conditional `UPDATE` on `revision`. There is one demo tenant, not production row-level security
- Aspect ratios: portrait `3 / 4`, landscape `16 / 9`, square `1 / 1`, `object-fit: cover`. Note that the acceptance checklist suggested landscape `4 / 3` and this project followed the architecture note instead
- Limits, required and optional fields, and the import format. Point at `docs/field-rules.md` or fold that file in
- CTA behavior: the preview button reveals the URL; `Open destination` opens a new tab
- Schema version 1. Unknown versions are rejected. A future migration would be a pure function from version N to N+1 with a fixture that preserves order, ids, copy, and colors, applied on read or on an explicit migrate command, plus a contract test. Do not implement that function. Say it does not exist yet
- How a quiz section would be added: extend the union, the Zod schema, the registry factory, one inspector, one renderer, and fixtures. Persistence stays a JSON document. This is the R03 explanation
- What is not implemented: autosave, configuration picker, drag-and-drop, Shopify, native apps, publish/CDN, claimed SLOs, multi-tenant production auth. Conditional 412 behavior exists for the demo API and is not a production multi-user product
- The local preview benchmark number from `docs/preview-benchmark.md`, labeled as a local observation
- Commands must be ones you have run. Prefer `pnpm` scripts so they are not PowerShell-only. Mention PowerShell as the shell you used

## Architecture doc

Write `docs/architecture.md` for the system that exists. Include the trust-boundary diagram in words or Mermaid, the document shape, and the save race. Mark enterprise items from architecture sections 10–12 as not built. Do not paste those sections as if they were implemented.

## Decision Log

Write `docs/decision-log.md` at 1–2 pages. Use these notes:

Phase 1 (planning); chatgpt harness w/ memory and 6.1 sol max model, very thin system prompt:




Decision 1: Give AI the context given to me on call but not in the PDF about how I will be evaluated, and ask what the best next step would be to maximize odds of passing the assessment.

Result: Start with creating acceptance criteria, then use the given recommended architecture/languages, start recording decisions immediately.

My decision and rationale: I researched public Reactiv project descriptions to identify possible extensibility needs and revised the proposed architecture. I distinguished published facts from architectural inferences, and treated additional client-inspired capabilities as optional enhancements. The architecture remains a proposal; its correctness and capacity require implementation and verification.



Decision 2: Prompt twice (to compare afterwards): Create acceptance criteria for the PDF assessment. Ensure it includes criteria you can infer from real reactiv technical projects you can find online.

Result: Created two acceptance criteria PDFs.

My decision and rationale: I validated each against the assessment, ensuring each req is covered in some way in the criteria. I chose the one with clearer, independently checkable behaviors since our next phases will be partial build -> human validation, which means this acceptance criteria will make failures easier to isolate.



Decision 3: Prompt twice (to compare afterwards): Create an ideal architecture for this reactiv take home assessment inspired by online architectual examples from real reactiv clients.

Result: Created two very similar architectures upon human validation. 

My decision and rationale: I validated each against the assessment, ensuring each decision is in the allowed scope in the assessment. I chose the client inspired architecture since it explicitly handles protecting work during a pending save; which matches the pragmatic approach the PDF recommends without overly focusing on scalability like the other architecture does. I preferred this design because a successful save response should not overwrite newer edits made while the request was pending. It separates the submitted snapshot from the current draft. Added this to the acceptance criteria for future testing: Start saving draft A, make further edits to produce draft B, then complete A’s save. The preview should retain B, the editor should still indicate unsaved changes, and reloading should restore A.






Phase 2 (implementation and testing); cursor harness with grok 4.7 very high model, system prompt ensures there are comments for every function and class:



Decision 1: Use the acceptance criteria, architecture, and take home assessment PDF to create a set of prompts for a coding agent as smart as you to implement this system step-by-step (in other words, prompt by prompt). Make sure you err on the side of more steps than less. Ensure each prompt includes the expected acceptance criteria and take home assessment requirements that should pass at that prompt phase. Put these prompts in separate md files in this repo.

Result: Created 31 prompts, each for a phase of development and testing.

My decision and rationale: I reviewed the generated implementation plan against the assessment requirements, acceptance criteria, and architectural boundaries before accepting it. I specifically checked that the sequence established the data model/API boundaries and persistence path before layering on editor behavior and polish, and that testing was introduced incrementally rather than deferred until the end. I did not find a sequencing issue significant enough to justify changing the plan, so I accepted it as generated. Acceptance of AI output here was an explicit decision, not a default.



Decision 2: Move from prompt result to prompt result, marking and evaluating each architectural implementation, assessment requirement, and acceptance criteria against the master documents. Execute the implementation plan incrementally rather than asking the agent to build the entire application at once.

Result: An incrementally implemented and validated codebase, with each phase checked against its assigned acceptance criteria and assessment requirements before proceeding.

My decision and rationale: After each prompt, I inspect the resulting implementation and test results against three sources of truth: the assessment PDF, the acceptance criteria, and the architecture. I only proceed when the relevant requirements are satisfied or I've explicitly documented why the implementation differs. This keeps AI-generated mistakes localized and makes architectural drift easier to detect.


Decision 4: Update each prompt with a second prompt in the conversation that says "Review the functions and behavior added or modified during the previous prompt. Add or update automated tests for every meaningful behavior or correctness property introduced or changed. Prefer testing externally observable behavior over implementation details. Ensure important edge cases and regressions identified during implementation are captured by tests".

Result: Each implementation phase leaves behind automated regression coverage for the behavior it introduces or modifies.

My decision and rationale: During incremental AI-assisted implementation, the agent frequently verifies its work interactively using CLI tools or one-off checks. That verification is useful for the current turn but is transient and does not protect the behavior from regressions introduced by later prompts. I therefore require each implementation step to convert meaningful verification into durable automated tests. I prefer tests of externally observable behavior and important edge cases over tests coupled to individual implementation details. This leaves behind executable evidence of the assumptions and behavior validated during development, allowing both humans and later AI agents to re-verify them throughout the application's lifecycle. This practice will also improve the implementation code since it will be modified to be easier to test. Testable code is more maintainable.



Decision 5: Update the UI to allow clicking and dragging sections up and down instead of requiring the user to click "Move up" or "Move down" buttons.

Result: A correctly implemented drag-and-drop section ordering UI.

My decision and rationale: After all acceptance criteria and take-home requirements were met, I felt some human taste was still missing from the UI. Reordering sections is a direct manipulation task, so dragging the section itself felt more natural than repeatedly clicking directional buttons. I made this change to reduce friction without changing the underlying section ordering behavior.



Decision 6: Update the UI to add color pickers to each section's settings, with the selected color mapped directly to the corresponding color input in the details pane.

Result: A correctly implemented color picker that stays synchronized with the existing color input.

My decision and rationale: After all acceptance criteria and take-home requirements were met, I looked for places where the UI was functionally correct but could be easier to use. Entering color values manually works, but choosing a color visually is faster and more intuitive. I kept the existing input while adding the color picker so the user can choose whichever interaction is more appropriate.



Decision 7: Using publicly available information about Reactiv's preferred UI style, update the application's CSS to better reflect Reactiv's look and feel.

Result: Updated the application's visual styling while keeping the existing functionality and acceptance criteria intact.

My decision and rationale: Once the required functionality was complete, I used publicly available Reactiv material as a reference for the final visual pass. I did not want to copy individual screens or introduce unnecessary functionality. Instead, I used the references to inform choices such as spacing, typography, borders, controls, and overall visual hierarchy. This gave the application a more polished and relevant look while keeping the implementation focused on the assessment.



Decision 8: Create a GitHub CI workflow that runs all relevant automated tests in the repository on each commit to the main branch.

Result: A CI workflow that automatically validates the application whenever changes are committed to main.

My decision and rationale: The repository already had automated tests covering the functionality built throughout the assessment, but those tests were only useful if they continued to be run as the application changed. I added CI so every commit to main is automatically checked against the same test suite I used during development. This turns the tests from a point-in-time validation step into an ongoing guard against regressions and makes the state of the main branch easier to trust.


Also include technical tradeoffs you actually encoded: React Router versus the PDF's Next.js option, REST versus GraphQL, a separate service versus a route-only API, Postgres versus the PDF's other stores, manual Save versus autosave, local preview versus saving on each keystroke.

## Acceptance criteria that fully pass

- **D08.** Schema version 1 is explicit, version 2 is rejected with no mutation, and the README explains how a future migration would be added without claiming the migrator exists. Evidence: the existing version-2 test plus the README paragraph.
- **P05.** README states the Postgres choice, restart behavior, the revision check, and the single-tenant demo limit. The restart evidence is the prompt 29 run. Evidence: README section plus that note.
- **Q04.** README has setup, environment variables, start commands, test commands, architecture, and tradeoffs. Evidence: the file. A clean checkout run is prompt 31; if you can do it now without skipping prompt 31's bar, still leave prompt 31 to repeat it from a clean state.
- **Q05.** `docs/decision-log.md` is 1–2 pages and states how AI was used, what was changed or kept, tradeoffs, and later improvements. Entries match the notes and the tests. Evidence: the log and `docs/ai-notes/`.
- **R03.** The registry seam exists from prompt 03, and the README explains how a quiz or video section would be added without rewriting persistence or forking the editor. Evidence: README plus the registry module.

## Take-home PDF requirements that fully pass

- Page 4, AI Usage: a 1–2 page Decision Log covering how AI was used, what was changed or rejected, key tradeoffs, and what you would improve with more time.
- Page 4, Submission README: local setup, required environment variables, how to run the app and the backend, high-level architecture, notable tradeoffs or assumptions.

Q06, the public repository and the clean run, is prompt 31.

## Verification

- Read the README and follow it yourself on the current checkout. Fix commands that fail
- Count Decision Log pages. If it is longer than two pages, cut it
- `pnpm test` and `pnpm typecheck` still pass
- Search the README for claims of CDN, 99.95% availability, and row-level security. Remove those claims

## Done when

- D08, P05, Q04, Q05, and R03 pass.
- The note lists the documents and the Decision Log page count.
- You have not started prompt 31.
