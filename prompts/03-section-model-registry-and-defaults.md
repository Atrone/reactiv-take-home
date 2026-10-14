# Prompt 03 — Section model, registry, and defaults

Implement only this prompt. Preconditions: prompt 02 is done and the contract tests pass.

## Read first

- Architecture sections 5 and 6 (registry, stable IDs, reducer commands you are not implementing yet, empty states)
- Architecture section 2, the Indigo and platform rows: ordered presentation blocks and a small registry, not a catalog dump
- Take-home PDF pages 1–2: three section types, more than one of each, ordered list
- Acceptance criteria R01, R02, R03, F01. None of them fully pass in this prompt

## Project rules

- Implement only this prompt. Do not edit `prompts/`.
- The registry is static data and pure functions. Do not dynamically import or download renderers.
- Every new function has a block comment and line comments on the steps inside the body.
- Append `docs/ai-notes/03-section-model-registry-and-defaults.md`.
- Do not build React components, routes, or SQL.

## Goal

Create the pure section model the editor, the seed, and the tests will share: default factories, stable ID creation, and a registry keyed by the three section types. Exhaustive TypeScript handling must make a forgotten type a compile error.

## Implement

1. In `packages/contracts` or `apps/editor/app/features/sections/` if the functions need to stay UI-adjacent, place the pure parts that do not import React in a module both the seed script and the editor can import. Prefer `packages/contracts` for factories and ID helpers that have no React imports. The registry of React components is created in later prompts; this prompt's registry maps each type to:
   - a `create(id: string): Section` factory that returns a valid section
   - a short `label` for the add menu (`Carousel`, `Text`, `Button`)
   - the aspect-ratio display map: `portrait` → `3 / 4`, `landscape` → `16 / 9`, `square` → `1 / 1`
2. ID helper. Generate section and image IDs once, with `crypto.randomUUID()` or an injected generator so tests are deterministic. IDs are not authorization. Do not derive IDs from array indexes. Do not generate a new ID during render; there is no render in this prompt, but the helper must be a function callers invoke on add, not a value computed inside a component body. Export the helper in a form that takes a `() => string` generator argument defaulting to `crypto.randomUUID`.
3. Defaults, all valid under the prompt 02 schema:
   - Carousel: no images, aspect ratio `landscape`, a real generated id
   - Text: title `Title`, description empty, title color `#112233`, description color `#334455`
   - CTA: label `Continue`, url `https://example.com`, background `#112233`, label color `#ffffff`
4. `createDemoDocument(generateId)` returns a valid `EditableDocument` with exactly two carousels, two text sections, and two CTAs, in that order: carousel, text, CTA, carousel, text, CTA. Every section has distinct copy, colors, and, for carousels, distinct image URLs using `https://example.com/...` paths. Each carousel has two images with distinct alt text. This fixture is for tests and for the later seed. It must parse with the prompt 02 schema.
5. A second exported fixture is not required yet. Prompt 27 adds the contrasting brand fixture.
6. `assertNever` or a switch that returns the registry entry so adding a fourth union member fails typecheck until the registry grows. Do not add a fourth type.
7. Unit tests:
   - demo document parses and has six sections in the stated order
   - two created carousels do not share an id when the generator returns different values
   - the same generator input is not called again by reading the section
   - each default section parses
   - the aspect-ratio map contains only the three architecture ratios
   - a test that documents the extension seam: the registry object has exactly the keys `carousel`, `text`, and `cta`. In a comment above that test, explain that a quiz section would add a union member, a factory, a renderer, an inspector, and a fixture, and would not require a new database table. That comment is the seed of R03. Do not implement a quiz.

## Out of scope

- React inspectors and renderers, reducer, persistence, import/export, README prose beyond the test comment.

## Acceptance criteria

No acceptance ID fully passes.

Progress that must be true:

- R01: one serializable `EditableDocument` is the fixture. There is no renderer yet, so R01 does not pass.
- R02: factories assign an ID at creation time and the demo fixture uses unique IDs. Reorder, import, and reload do not exist yet, so R02 does not pass.
- R03: the pure registry seam and the quiz-extension comment exist. The README explanation does not, so R03 does not pass.
- F01: the demo document is the documented default content the seed will store. The app does not load it yet, so F01 does not pass.

## Take-home PDF requirements

Page 1–2, Functional Requirements: the model can represent multiple carousels, text sections, and CTAs, with image URLs, aspect ratio, title, description, both text colors, CTA label, link, and both CTA colors.

Page 1, Preview Screen Components, does not pass yet because nothing is rendered.

## Verification

- `pnpm test`
- `pnpm typecheck`
- Temporarily add a fake section type in a scratch branch of the union only if you can do it in a test type assertion. Do not leave a fourth type in the schema. If you cannot prove exhaustiveness without dirtying the schema, cite the switch's `never` default in the note and leave the schema at three types.

## Done when

- The demo fixture and factories pass the contract schema tests.
- The note records where the pure registry lives.
- You have not started prompt 04.
