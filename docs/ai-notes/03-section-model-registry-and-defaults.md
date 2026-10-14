# 03 — Section model, registry, and defaults

12 October 2026. Prompt 04 was not started. No acceptance ID fully passes.

## Where the pure registry lives

The pure model is in `@reactiv/contracts`, which the seed script and the editor can both import. It does not import React.

- `packages/contracts/src/registry.ts` holds `sectionRegistry`, `getSectionRegistryEntry`, `createSection`, and `ASPECT_RATIO_DISPLAY`.
- `packages/contracts/src/ids.ts` holds `createStableId`.
- `packages/contracts/src/demo-document.ts` holds `createDemoDocument`.
- Tests are in `packages/contracts/src/registry.test.ts`.

`apps/editor/app/features/sections/` does not exist yet. React inspectors and renderers are later prompts. This registry maps a type to a factory and an add-menu label. It does not load a component.

`sectionRegistry` has exactly the keys `carousel`, `text`, and `cta`.

| Key | `label` | `create(id)` |
| --- | --- | --- |
| `carousel` | Carousel | No images, `aspectRatio: "landscape"` |
| `text` | Text | Title `Title`, description `""`, title color `#112233`, description color `#334455` |
| `cta` | Button | Label `Continue`, url `https://example.com`, background `#112233`, label color `#ffffff` |

The stored carousel field is the name `portrait`, `landscape`, or `square`. `ASPECT_RATIO_DISPLAY` is the shared CSS map, not a fourth registry key, because text and CTA sections have no aspect ratio:

| Name | CSS |
| --- | --- |
| `portrait` | `3 / 4` |
| `landscape` | `16 / 9` |
| `square` | `1 / 1` |

Landscape is `16 / 9`, the architecture ratio. The map is frozen. A fourth key fails the `AspectRatioDisplay` parameter, and a new member of `ASPECT_RATIOS` falls through to `never` until the map learns a value.

## Ids

`createStableId(generateId)` calls `generateId` once and returns the string. Callers invoke it when adding a section or an image. The helper does not derive an id from an array index, and the id is not an authorization secret.

The default calls `crypto.randomUUID()`. The parameter is a local `randomUuid` function rather than the bare method `crypto.randomUUID`. Passing that method unbound throws `Value of "this" must be of type Crypto`. `randomUuid` calls it as a method so the receiver stays `crypto`.

`createSection(type, generateId?)` calls `createStableId` once, then `getSectionRegistryEntry(type).create(id)`. The factory stores that id. Reading the section does not call the generator. Omitting `generateId` uses the UUID default.

## Demo fixture

`createDemoDocument(generateId)` returns one `EditableDocument` with schema version 1. Screen order is the array order. There is no `position` field, and the object is not a `Configuration`: it has no `id`, `revision`, or `updatedAt`. The function parses with `editableDocumentSchema` and throws when the generator repeats a section id or repeats an image id inside one carousel.

`generateId` is called ten times, in this order, so a later seed can pass a fixed queue:

1. First carousel section id
2. First carousel, first image id
3. First carousel, second image id
4. First text section id
5. First CTA section id
6. Second carousel section id
7. Second carousel, first image id
8. Second carousel, second image id
9. Second text section id
10. Second CTA section id

The six sections are carousel, text, CTA, carousel, text, CTA. The two text blocks and the two CTAs differ in copy and colors. The two carousels use different image URLs on `https://example.com/...`, different alt text, and `landscape` then `portrait`. Each carousel has two images. With `callCountGenerator("demo")` the ids are `demo-1` through `demo-10` in the order above.

| Order | Type | Distinct content |
| --- | --- | --- |
| 1 | carousel | `landscape`. `https://example.com/demo/arrival-window.jpg` ("Shop window with a new arrival display"). `https://example.com/demo/reading-table.jpg` ("Front table stacked with featured books"). |
| 2 | text | Title "New this week". Description "A short list from the front table." Colors `#112233` and `#334455`. |
| 3 | cta | Label "Continue". URL `https://example.com/continue`. Background `#243044`. Label color `#ffffff`. |
| 4 | carousel | `portrait`. `https://example.com/demo/staff-stack.jpg` ("Staff picks stacked on a wooden counter"). `https://example.com/demo/quiet-corner.jpg` ("Chair in a quiet corner of the shop"). |
| 5 | text | Title "From the floor". Description "Notes from the people who unpack the boxes." Colors `#3d2b1f` and `#5c6b73`. |
| 6 | cta | Label "See the list". URL `https://example.com/list`. Background `#1f4d3a`. Label color `#f7f3ea`. |

Empty default carousels come from `sectionRegistry.carousel.create`. The demo carousels are this fixture, with two slides each. A second brand fixture is prompt 27.

## Exhaustiveness

`getSectionRegistryEntry` switches on `Section["type"]`. The `carousel`, `text`, and `cta` arms return registry entries. The `default` arm is `return assertNever(type)`. After those three cases, `type` is `never`. A fourth union member fails that call until the switch and the registry both grow.

`defineSectionRegistry` takes `T extends Record<Section["type"], SectionRegistryEntry>` intersected with `Record<Exclude<keyof T, Section["type"]>, never>`. A missing key fails the `Record` constraint. An extra key is required to be `never`.

The schema was not given a fourth member. `packages/contracts/src/document.ts` is unchanged. The test file proves the seam without a scratch type in the union:

- `SectionTypesMatchRegistry` is true only when `keyof typeof sectionRegistry` and `Section["type"]` are the same set. The test assigns `true`.
- `QuizIsRegistered` is `"quiz" extends keyof typeof sectionRegistry`. The test assigns `false`.
- The comment above `it("registers exactly carousel, text, and cta")` says a quiz section would add a union member, a factory, a renderer, an inspector, and a fixture, and would not require a new database table. That comment is the seed of R03. Quiz is not implemented.

Prompt 02 already rejects a document whose `type` is `quiz`. That test still passes. It does not add `quiz` to the schema.

## Commands and results

- `pnpm test` exited 0. Vitest 5.0.4 passed 50 tests in `@reactiv/contracts`, 30 in `@reactiv/config-service`, and 10 in `@reactiv/editor`.
- `pnpm typecheck` exited 0. That typechecked `@reactiv/contracts` including its tests, the config service, and the editor.

## Follow-up tests

The same registry gained tests for edges found while reviewing the implementation. `@reactiv/contracts` now has 62 passing tests. `pnpm typecheck` and `pnpm test` still exit 0. The config service still has 30 tests, and the editor still has 10.

`createStableId` returns a space, an empty string, and a repeated string unchanged, and a second read does not call the generator. Factories keep a whitespace id. An empty id fails at creation with `Section id must be a non-empty string.` Two text sections built with the same id are separate objects: editing one title leaves the other, and the next factory result, on `Title`. Pushing a slide onto one carousel leaves the next carousel empty.

Omitting the generator on carousel, text, and CTA assigns three different UUID ids and the documented defaults. That is the path that calls `crypto.randomUUID` as a method. Reading a text section and a CTA does not call the generator again.

`getSectionRegistryEntry("quiz")` throws `Unexpected value: quiz`. Assigning `4 / 3` to the landscape display ratio throws, and the value stays `16 / 9`. Replacing the carousel factory throws, and the next create is still an empty landscape carousel. Assigning a quiz key throws, and the registry keys stay `carousel`, `text`, and `cta`. The stored name `landscape` looks up `16 / 9`, and that CSS string is not itself an aspect-ratio name.

Two `createDemoDocument` calls with the same generator sequence are deep-equal and do not share section arrays. Changing the first document's image URL leaves the second document and a later build on the fixture URL. A repeated section id, with unique image ids, fails with `Section ids must be unique in the document.` The same image id in both carousels parses. The demo carousels have slides, the first text title is not `Title`, the first CTA url is not `https://example.com`, and the second carousel is `portrait`. The document has no `tenantId`.

## Acceptance progress

R01 does not pass. `createDemoDocument` is one serializable `EditableDocument`. Nothing renders it yet.

R02 does not pass. Factories store an id chosen at creation, and the demo fixture uses the generator for every section id and image id. Reorder, import, and reload do not exist yet.

R03 does not pass. The pure registry seam and the quiz-extension comment exist. The README explanation does not.

F01 does not pass. The demo document is the default content the seed will store. The app does not load it yet.
