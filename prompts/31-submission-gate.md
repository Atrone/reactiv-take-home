# Prompt 31 — Submission gate

Implement only this prompt. Preconditions: prompt 30 is done. README, `docs/architecture.md`, and `docs/decision-log.md` exist.

## Read first

- Take-home PDF page 4, Submission and Evaluation Criteria
- Architecture section 17, the submission checklist
- Acceptance criteria Q06 and verification scenario T08
- `README.md`

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- Do not create a git commit, a GitHub repo, or a GitLab project unless the user asks in this session. Prepare the tree so it is safe to publish when they ask.
- Do not invent a public URL.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/31-submission-gate.md`.

## Goal

Prove a stranger can follow the README, run the tests, and complete the main journey. Fix the README or the product where that fails. Confirm the tree has no secrets.

## Implement

1. Clean-checkout drill. Use a copy of the repo in a temporary directory, or a fresh install after removing `node_modules`, without deleting the user's `.env` permanently. Do not delete the Postgres volume. In the clean copy:
   - follow the README from the top
   - create `.env` from `.env.example` and set a local token
   - migrate, seed, start both processes
   - run the test command the README names
   - run typecheck
   - open `/`, edit a title, save, reload, and confirm the title
   - export and import a file
2. If a README step is wrong, fix the README. If a step reveals a product bug, fix the bug and add or extend a test.
3. Secret scan of the working tree, excluding `node_modules` and build output:
   - no file named `.env` is tracked or about to be tracked
   - no file contains a live token other than `replace-me` and test tokens such as `boundary-token-do-not-leak`
   - `docs/` and the client build do not contain the local `.env` token
4. Confirm `docs/decision-log.md` is still 1–2 pages after any edits.
5. Confirm the main journey has no uncaught runtime error in the browser console during the clean-checkout walkthrough. Fix uncaught errors.
6. Write `docs/submission-checklist.md` as a table of F01–F12, D01–D08, A01–A11, P01–P06, Q01–Q06, and R01–R09. Each row is `pass` only if an earlier prompt's evidence still exists. If you find a gap, go back to the behavior and fix it in this prompt, then mark it `pass`. Do not mark SCL01, SCL03, or SCL04 as pass. For SCL02, write `demo API only, not a production claim`.
7. List anything you could not run. A checklist row cannot say `pass` for a check you skipped.

## Acceptance criteria that fully pass

- **Q06.** The repository contains the runnable source, the README, and the Decision Log. The documented typecheck and tests pass. A reviewer can edit, import, export, save, and reload without an uncaught runtime error. Evidence: the clean-checkout note. A public remote URL is the user's publishing step. Say in the note that the remote was not created because the user has not asked. That does not fail Q06's product bar; the PDF's "provide a link" is a submission act. In `docs/submission-checklist.md`, mark the public link as `waiting on the user` rather than `pass`.

## Take-home PDF requirements that fully pass

- Page 4, Evaluation Criteria, as a whole: functionality, API and architecture, code quality, extensibility, user experience, and documented tradeoffs are evidenced by the checklist.
- Page 4, Submission: the tree is ready for a public repository. Do not push it in this prompt.

## Verification

- The clean-checkout commands
- `pnpm test`
- `pnpm typecheck`
- Playwright if the README says to run it
- Secret scan

## Done when

- The checklist exists and every required and recommended ID is `pass` or has a defect you are still fixing. Do not finish with a known failing ID.
- The note records the clean-checkout result and that no remote was created.
- Stop. Do not start prompt 32 unless the user asks.
