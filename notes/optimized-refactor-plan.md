# Nazare optimized architecture refactor plan

Companion blueprint: [`optimized-refactor.ts`](./optimized-refactor.ts).

## Policy

This refactor has **no backward-compatibility requirement**.

- Delete obsolete public APIs instead of deprecating them.
- Do not maintain old and new execution pipelines in parallel.
- Update all monorepo consumers and tests in the same slice as an API change.
- Preserve behavior, diagnostics, deterministic IDs, output ownership, and atomicity unless a phase explicitly changes them.
- Temporary compile failures are acceptable inside a local commit sequence, but every phase ends type-safe and tested.
- Prefer moving proven algorithms behind new products over rewriting their semantics.

## Target dependency graph

```text
@nazare/core
├─ stable IDs, diagnostics, spans, generic contracts
│
├── @nazare/source
│   └─ parsers, source documents, target-neutral frontends
│
└── @nazare/compiler
    ├─ Product / Computation contracts
    ├─ computation graph and cache
    ├─ ProjectSession and transactional revisions
    ├─ dependency closure and generic semantic products
    └─ capability registry
         │
         ├── @nazare/target-shopify
         │   ├─ Shopify source semantics
         │   ├─ Shopify output capabilities
         │   └─ ownership/reconciliation transactions
         │
         ├── @nazare/target-hydrogen (future)
         │   ├─ portable-model → Hydrogen lowering
         │   └─ React/routes/GraphQL output capability
         │
         └── @nazare/preview
             ├─ preview products
             ├─ story/fixture rendering
             └─ static/live workbench publication

@nazare/cli-client
└─ typed requests → session → event formatting

@nazare/registry
└─ registry operations outside ProjectSession
```

`@nazare/compiler` must never import a target package.

## Desired package surface

### `@nazare/core`

Export only stable value contracts:

```text
Diagnostic
SourceSpan
StableId
ProjectFileId
Uncertainty
Evidence
```

Do not put runtime orchestration in Core.

### `@nazare/source`

Export:

```text
SourceFrontend
ParsedFile
SourceFacts
SourceDocument
frontend registry
built-in Liquid/Nazare Liquid parsers
```

Source facts must not contain Shopify roles or target-specific records.

### `@nazare/compiler`

Primary API:

```text
Product<Key, Result>
Computation<Key, Result>
defineComputation()
ComputationGraph
ProjectHost
ProjectSession
AnalysisPlan
ComputationRegistrar
NazarePipeline
CapabilityRegistry
createProjectSession()
```

No giant re-export barrel of individual implementation passes.

### `@nazare/target-shopify`

Primary API:

```text
shopifyTarget()
ShopifyBuildCapability
ShopifyInspectCapability
ShopifyPreviewCapability
Shopify semantic product constructors
```

### `@nazare/preview`

Primary API:

```text
PreviewModel
renderPreviewStories()
publishPreview()
preview capability implementation
```

## Non-negotiable invariants

1. Canonical paths and stable IDs produce deterministic output.
2. Source facts are partitioned by file.
3. Target facts are separate products derived from source facts and target role.
4. Computation cache keys include namespace, product version, key, and direct dependency hashes.
5. Diagnostics and uncertainty stay owned by the product that produced them.
6. Queries and indexes are lazy.
7. Data-flow fixed points recompute affected SCCs, not the whole project.
8. Failed project updates leave the previous revision usable.
9. Failed output transactions leave the previous output tree usable.
10. Obsolete revisions are never published.
11. Side effects are never skipped because a pure projection was cached.
12. Compiler has no target-specific imports.
13. Source semantic target, transforms, and output capabilities compose independently.
14. Pipeline identity/version participates in cache identity.

## Phase 0 — lock behavioral safety

Goal: retain semantic confidence while contracts are deleted.

- [ ] Record current benchmark baselines:
  - incremental single-file edit
  - full theme inspection
  - theme scaffold
  - parser throughput
- [ ] Keep canonical theme equivalence and replay tests as behavior gates.
- [ ] Add fixtures covering:
  - file add/change/delete
  - dependency-edge add/remove
  - dependency cycles
  - target role change caused by path move
  - external metafield snapshot change
  - `.theme-check.yml`-only change
  - output collision
  - failed output transaction
- [ ] Assert stable IDs and canonical ordering independently from current API shapes.
- [ ] Assert telemetry counts for warm edits: parsed files, processed pass keys, replaced records, graph deltas.

Exit gate:

```text
Behavior fixtures and benchmark baselines run without depending on old API names.
```

## Phase 1 — computation graph foundation

Create under `packages/compiler/src/computation/`:

```text
product.ts
computation.ts
graph.ts
context.ts
cache.ts
scheduler.ts
transaction.ts
diagnostics.ts
```

- [x] Implement namespaced `Product<Key, Result>`.
- [x] Implement typed `defineComputation()`.
- [x] Serialize structured keys canonically.
- [x] Record dependency edges automatically through `context.get()` and `context.input()`.
- [x] Memoize by direct dependency hashes.
- [x] Deduplicate concurrent reads of the same product.
- [x] Support `AbortSignal` and interactive/background priority.
- [x] Aggregate product-owned diagnostics and uncertainty.
- [x] Implement graph update transaction with commit/rollback.
- [ ] Add cycle diagnostics; allow declared fixed-point/SCC products only.
- [x] Add typed `ComputationRegistrar` and `CapabilityRegistry`.
- [ ] Keep target-specific model types inside capability-owned `run()` methods; do not create central build/inspect/preview model unions.
- [x] Add `NazarePipeline { source, transforms, output }` composition.
- [x] Register source, transform, and output computations before session execution.
- [x] Include every pipeline contributor ID/version in cache identity.
- [x] Add in-memory cache implementation.
- [x] Add filesystem cache implementation.

Tests:

```text
cache hit/miss
transitive invalidation
concurrent deduplication
cancellation
failed transaction rollback
product version invalidation
canonical structured keys
```

Exit gate:

```text
A synthetic graph recomputes only downstream nodes after one input edit.
```

## Phase 2 — project host and revisioned inputs

Create under `packages/compiler/src/project/`:

```text
file-id.ts
input-provider.ts
host.ts
snapshot.ts
session.ts
session-update.ts
analysis-plan.ts
```

- [x] Introduce stable `ProjectFileId { workspace, package, path }`.
- [ ] Replace absolute-path identity with project-relative identity.
- [x] Implement lazy filesystem `InputProvider`.
- [x] Model revisioned external project data through generic input providers.
- [x] Add revisioned config, Theme Check, metafield snapshot, and remote-data metadata inputs.
- [x] Build one coalesced filesystem watcher per session.
- [x] Merge external input-provider watchers into the session watcher.
- [x] Coalesce rapid file events into one change batch.
- [x] Implement atomic add/change/delete updates.
- [x] Implement move updates.
- [x] Commit a new revision only after project-session validation.
- [x] Ensure stale computations are cancelled and never published.

Exit gate:

```text
ProjectSession can open, watch, update, rollback, and retain the last valid revision.
```

## Phase 3 — source products

Create under `packages/compiler/src/products/source/`:

```text
file.ts
classification.ts
parsed-file.ts
source-facts.ts
dependency-edges.ts
closure.ts
```

- [x] Move frontend selection behind `parsedFile(fileId)`.
- [x] Move parser/fact identities into frontend versions and graph dependency identities.
- [x] Split target-neutral syntax/facts from Shopify enrichment products.
- [x] Make `sourceFacts(fileId)` independent of target.
- [x] Make `dependencyEdges(fileId)` partitioned by source.
- [x] Resolve closure by demand from analysis roots.
- [x] Preserve opaque frontend and uncertainty behavior.
- [ ] Remove whole-scope parsing from command paths.

Reuse from current code:

```text
theme-source-frontends.ts
source frontend adapters
fact-cache-revision generation
component dependency resolver
path normalization and safety checks
```

Delete after migration:

```text
ThemeAnalysisCache
ThemeAnalysisMemo
analyzeNormalizedThemeFiles() whole-project cache orchestration
```

Exit gate:

```text
Changing one independent file parses and extracts facts for exactly one file.
```

## Phase 4 — Shopify target package

Create `packages/target-shopify/` and move target ownership there.

Move or adapt:

```text
packages/theme/src/*
packages/compiler/src/theme-file-classifier.ts
packages/compiler/src/theme-*-facts.ts
packages/compiler/src/theme-*-pass.ts
packages/compiler/src/theme-*-index.ts
packages/compiler/src/theme-metafields.ts
packages/compiler/src/theme-script-network.ts
packages/compiler/src/theme-check-policy.ts
packages/compiler/src/emit.ts Shopify-specific emission
```

Do not mechanically move generic scheduler/store utilities; rename and retain those in compiler.

- [x] Implement Shopify role classification.
- [x] Register per-file target fact products.
- [x] Register per-file declarations and references.
- [x] Adapt declaration, reference, and resolution passes into computation products.
- [x] Adapt remaining incremental passes into computation products.
- [x] Partition records by stable owner/source IDs.
- [x] Model render resolution and data flow through SCC-local products.
- [x] Preserve explicit convergence budgets and product-owned diagnostics.
- [x] Register target schema, metafield, behavior, capability, classification, and evidence products.
- [x] Register Shopify semantic capability through `CapabilityRegistry`.

Exit gate:

```text
Shopify target products reproduce canonical semantic records and diagnostics.
Compiler imports no Shopify package or Shopify-only type.
```

## Phase 4A — source/output composition gate

Prove architecture supports different source and output platforms before migrating all consumers.

- [x] Define `PortableApplicationModel` with render trees, components, routes, contracts, data requirements, assets, diagnostics, and uncertainty.
- [x] Add a Shopify-semantics → portable-model transform product.
- [x] Add fake alternate output capabilities in tests.
- [x] Compose `source: shopifySemanticTarget()` with independent output capabilities.
- [x] Verify changing output capability reuses parse and source-fact products.
- [x] Verify output-specific products do not enter Shopify source semantics.
- [x] Verify unsupported source behavior remains explicit uncertainty, never guessed output.
- [x] Reserve the future Hydrogen shape:

```text
Shopify Liquid semantics
→ PortableApplicationModel
→ HydrogenBuildModel
→ React/TSX + routes + Storefront GraphQL + assets
```

Exit gate:

```text
One session successfully composes Shopify source semantics with two independent
output capabilities, with separate cache identities and no compiler changes.
```

## Phase 5 — lazy query products

Replace `ThemeComputation` with products under target Shopify:

```text
project-model
project-graph
dependency-index
impact-index
behavior-index
metafield-index
affected-pages
unused-files
```

- [x] Preserve lazy materialization: graph and indexes compute only when requested.
- [x] Partition query indexes by stable owner/filter keys and record IDs.
- [x] Return versioned query outputs.
- [x] Preserve uncertainty and evidence in query results.
- [x] Migrate graph-server query requests through `ProjectSession.get(product)`.
- [x] Move graph-server external-input watch notifications to shared providers.
- [x] Remove graph-server `ThemeProgram` and `ThemeComputation` query dependencies.
- [x] Migrate direct CLI file-impact inspection to Shopify query products.
- [x] Migrate direct CLI metafield-impact inspection to Shopify query products.
- [x] Migrate full CLI theme graph/report inspection to Shopify query products.
- [x] Delete `ThemeComputation` and `ThemeProgram`.
- [x] Delete old compiler-owned direct graph-query and persisted-inspection cache helpers.

Exit gate:

```text
An impact query does not construct graph, behavior, or metafield indexes.
A graph query reuses already-computed semantic products.
```

## Phase 6 — build products and output transaction

Replace:

```text
buildNazareThemeWorkspace()
ThemeBuildSession
buildTheme() orchestration
```

With:

```text
BuildCapability.model(plan)
BuildCapability.emit(buildModel)
emissionPlan(buildModel)
ownedOutputPlan(emittedFiles)
OutputTransaction
```

- [x] Add validated `OwnedOutputPlan` collision and stale-owned deletion planning.
- [x] Add revision-guarded `AtomicOutputStore` transaction contract.
- [x] Wire build products and publication through shared Shopify `ProjectSession`.
- [x] Preserve build scopes as analysis roots: workspace, closure, file, files.
- [x] Compile only reachable source closure.
- [x] Detect output collisions before writes.
- [x] Preserve merchant-owned data through explicit owned-path deletion plans.
- [x] Preserve build-manifest ownership and reject unowned or merchant-modified output.
- [x] Derive deterministic schema locks and breaking-drift products.
- [x] Add run-once migration application and three-way locale merge products.
- [x] Persist output, schema lock, migration ledger, and locale base in one transaction.
- [x] Migrate CLI build orchestration from `buildTheme()` to demand-driven products.
- [x] Remove graph-server `ThemeBuildSession` ownership.
- [x] Stage writes and stale owned-file deletions.
- [x] Atomically publish or roll back output transaction.
- [x] Keep check-only mode as build without emission.
- [x] Prevent obsolete revisions from committing output.
- [x] Delete `ThemeBuildSession` compatibility API.
- [x] Delete obsolete `@nazare/theme` orchestration package.
- [x] Delete old compiler workspace build API.

Exit gate:

```text
Build fixtures are byte-equivalent where behavior is unchanged.
Failed builds and stale revisions cannot mutate output.
```

## Phase 7 — preview products

- [x] Remove direct preview component compilation from old workspace build API.
- [x] Define story discovery as products keyed by story file.
- [x] Define fixture inputs through providers.
- [x] Define preview model by component/story roots.
- [x] Render stories independently and concurrently.
- [x] Cache pure render plans, not publication side effects.
- [x] Move preview serve watcher to the shared `ProjectSession`.
- [x] Cancel stale renders on revision changes.
- [x] Keep scaffold and fixture management outside project analysis.
- [x] Delete preview-specific compiler workspace orchestration.

Exit gate:

```text
One component edit recompiles/renders only affected stories.
Static build, check, and watch use the same preview products.
```

## Phase 8 — CLI replacement

Replace command orchestration in `packages/cli-client/src/index.ts` with:

```text
raw argv
→ typed ProjectRequest
→ direct init/registry/preview utility fork
→ resolve source/transform/output pipeline
→ create ProjectSession
→ request product
→ consume NazareEvent
```

- [x] Parse options once.
- [ ] Use one `--watch` execution mode for build, inspect, and preview.
- [ ] Stream revisioned result/update-failed events.
- [x] Keep text/JSON/DOT formatting outside compiler.
- [x] Remove `check` implementation; route alias to build check-only if alias remains.
- [x] Remove source/graph-server direct compiler plumbing after replacement.
- [ ] Delete old CLI adapters rather than retaining compatibility wrappers.

Exit gate:

```text
CLI only knows typed requests, capabilities, sessions, and events.
```

## Phase 9 — exports and dead-code deletion

- [ ] Replace `packages/compiler/src/index.ts` giant barrel with intentional public modules.
- [x] Delete old theme workspace/session/computation/build exports.
- [x] Delete old caches superseded by computation cache.
- [x] Delete duplicate path, diagnostic, and graph stores.
- [ ] Remove deprecated aliases and compatibility classes.
- [ ] Rename remaining generic `theme-*` files to domain-neutral names.
- [x] Verify package dependency direction.
- [ ] Regenerate fact/product cache revisions.
- [ ] Update README and architecture notes.

Exit gate:

```text
rg finds no obsolete API names.
No package imports an internal source path from another package.
```

## Implementation commit sequence

Each item should be an independently understandable commit; compatibility is not required between commits on the branch.

1. Add graph primitives and tests.
2. Add transactional graph updates and cache.
3. Add ProjectFileId, providers, host, and session.
4. Add file/classification/parse/source-fact products.
5. Add dependency-edge and closure products.
6. Create target Shopify package and role/fact enrichment.
7. Add pipeline composition and portable application model seam.
8. Adapt declaration/reference/resolution passes.
9. Adapt SCC data-flow and remaining semantic products.
10. Adapt lazy query/index products; delete `ThemeComputation`.
11. Adapt build/emission/output transaction; delete workspace build/session APIs.
12. Adapt preview products and watcher.
13. Replace CLI orchestration.
14. Collapse exports, delete dead code, move files.
15. Run full equivalence, corpus, benchmark, and package smoke gates.

## Validation loop

During implementation, run the smallest relevant gate first:

```bash
biome check <changed paths>
pnpm typecheck
node --test <affected test files>
```

At phase boundaries:

```bash
pnpm test:compiler
pnpm test:theme
pnpm test:cli
pnpm test:corpus
pnpm test:doc-agreement
pnpm benchmark:incremental
pnpm benchmark:inspect
```

Before merge:

```bash
pnpm test:all
pnpm test:package
pnpm check:no-dist
```

Do not run project build scripts while an asset/watch build is already running.

## Performance acceptance

Cold runs:

- No material regression against baseline without an explicit tradeoff note.
- Inspect queries do not build unrelated indexes.
- Build/preview analyze only requested roots and reachable closure.

Warm runs:

- Independent one-file edit parses one file.
- Dependency edit recomputes changed file plus reverse-affected closure.
- SCC-local data flow processes affected SCCs only.
- Theme Check-only edit does not rebuild source facts or semantic records.
- External snapshot edit invalidates only products that read that provider.
- Stale computations are cancelled and never emitted.

Memory:

- Product cache supports bounded retention/LRU.
- Watch sessions do not retain obsolete revisions indefinitely.
- Concurrent requests deduplicate the same computation.

## Stop conditions

Stop and redesign before continuing if any phase requires:

- Compiler importing target Shopify.
- Source facts containing target roles.
- Source semantics and output capability forced into one target object.
- Target-specific build models added to a central compiler union.
- A new output platform requiring a compiler control-flow branch.
- One project fingerprint invalidating every semantic product.
- A new query requiring edits to central engine dispatch.
- A new pass requiring separate manual invalidation code.
- Build writes before validation completes.
- Watch output without revision identity.
- Two active semantic pipelines kept solely for compatibility.
