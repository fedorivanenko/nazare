# Nazare

Nazare compiles typed Liquid components into Shopify themes and provides demand-driven build, inspect, and preview tooling.

## Commands

```sh
nazare build [source-root]       # validate and atomically publish owned output
nazare check [source-root|file]  # run the same build products without emission
nazare inspect theme [dir]       # semantic project report
nazare inspect impact <file>     # dependencies, dependents, and affected pages
nazare inspect metafield <id>    # definitions, readers, and affected pages
nazare preview build [dir]       # static component workbench
nazare preview check [dir]       # validate and render every authored story
nazare preview serve [dir]       # revisioned live preview
nazare build --watch             # revisioned build events
nazare check --watch             # revisioned check-only events
nazare inspect theme --watch     # revisioned inspection events
```

Project paths come from `nazare.theme.json`; generated output ownership is recorded under `.nazare/` in the output directory. Build publication validates ownership and revisions before atomically replacing files.

## Architecture

Nazare computes typed products on demand:

```text
revisioned project inputs
→ ProjectSession
→ ComputationGraph
→ target-neutral source products
→ Shopify semantic/query/build products
→ owned output plan
→ revision-guarded atomic publication
```

Build, inspect, and preview share revisioned source products but request different projections. `build --watch`, `check --watch`, `inspect theme --watch`, and Preview serve publish only current revision `result` or `update-failed` events; superseded work is aborted. Dependency reads automatically create invalidation edges. Pure computations may be cached; filesystem publication and other side effects are never cached.

Stable semantic identity uses project-relative `ProjectFileId` values. Dynamic references and opaque runtime behavior remain explicit uncertainty rather than guessed dependencies.

### Package direction

```text
@nazare/core
├─ @nazare/source
└─ @nazare/compiler
   ├─ @nazare/target-shopify
   └─ @nazare/preview
```

`@nazare/compiler` exposes intentional modules:

```text
@nazare/compiler/compile
@nazare/compiler/computation
@nazare/compiler/extensions
@nazare/compiler/output
@nazare/compiler/portable
@nazare/compiler/project
@nazare/compiler/source-products
```

The compiler cannot import targets, Preview, or CLI packages. Architecture tests enforce this direction. Compiler root exposes direct compile APIs only; architecture consumers use intentional submodules.

## Development

```sh
pnpm install
pnpm exec tsc -b
biome check .
node --test packages/compiler/tests/*.test.mjs
node --test packages/target-shopify/tests/*.test.mjs
node --test packages/preview/tests/*.test.mjs
```

Detailed refactor architecture and remaining work live in:

- [`notes/optimized-refactor.ts`](notes/optimized-refactor.ts)
- [`notes/optimized-refactor-plan.md`](notes/optimized-refactor-plan.md)
