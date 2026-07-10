# Architecture Audit — 2026-07-10

Scope: full repo (~2k lines). Pipeline `parse → syntax → bind → graph → validate` plus thin CLI. Pipeline shape itself is good — clean pass separation, types-first design. Issues below, ordered by impact on clarity/structure.

## Architecture issues

### 1. String-encoded IDs are load-bearing and parsed back — hidden coupling

`syntax.ts` builds IDs like `syntax:props-interface:${file}`; `symbols.ts` then does string surgery to recover data: `fileFromPropsInterfaceId()`, `.replace(/^symbol:component:/, ...)` (`packages/compiler/src/symbols.ts:427-437`). ID format is an undocumented contract between two modules. File path with `:` or format change → silent breakage. Also redundant: syntax nodes already carry `fileId`/`ownerId`/`propsInterfaceId` — binder should look nodes up, not parse IDs.

**Fix:** one `ids.ts` module owns all ID construction (already half-exists as scattered helpers); binder navigates via node fields + an id→node map. Never decode an ID.

### 2. `bindArtifactIR` does three jobs

`symbols.ts:19-244` creates symbols, resolves references, *and* type-checks contracts (missing/unknown/mismatched props → diagnostics). Then `validate.ts` partially re-checks binder output, including awkward "did binder already emit diagnostic for this?" logic (`validate.ts:61-73`) — a checker inspecting another checker's output to avoid double-reporting. Classic sign the passes are misdivided.

**Fix:** binder emits symbols + resolutions only. Separate `check.ts` pass consumes IR + contracts, owns all constraint diagnostics. `validate.ts` keeps only structural invariants (graph endpoints).

### 3. Diagnostics scattered across three shapes and three sources

`ParseDiagnostic` (`ast.ts`) and `ValidationIssue` (core) are the same shape with different names. Diagnostics accumulate in `ast.diagnostics`, `ir.diagnostics`, and validate returns — `index.ts` concatenates. Reader can't tell where a code originates.

**Fix:** single `Diagnostic` type in core; every pass returns `{ output, diagnostics }`; pipeline collects. Also centralize diagnostic codes + messages in one `diagnostics.ts` catalog — currently message strings are inlined at emit sites with inconsistent prefixes (`NAZARE_PARSE_*`, `IR_*`, `CONSTRAINT_*`).

### 4. Regex mini-language parsing for type expressions

`parser.ts` parses `string.setting({label: "...", default: ...})` with regexes: `/\.required\s*\(/`, `stringObjectValue` (`parser.ts:297-338`). Only string defaults survive; nested objects break; malformed prop entries silently `continue` (`parser.ts:165, 200`) — no diagnostic, prop just vanishes. That's the opposite of self-explanatory for users of the DSL.

**Fix:** dedicated `type-expression.ts` with tiny recursive-descent parser producing a structured `TypeExpressionAst`; emit diagnostics for anything skipped. Isolates the DSL grammar in one readable place.

### 5. Flat `ArtifactSyntaxNode[]` + linear scans everywhere

`expressionForArgument`, `argumentsForRender` do `syntax.find(...)` per argument (`symbols.ts:302-370`); `validate.ts` re-filters `ir.resolutions` per node; `pushEdge` dedups with `edges.some(...)` — O(n²) patterns and noisy call sites.

**Fix:** make `ArtifactIR` an indexed structure: `nodesById: Map<Id, Node>`, `byKind`, resolution indexes. Reads become `ir.node(argument.expressionId)` — faster and self-documenting.

### 6. Core is one 363-line type dump, ~30% aspirational

`section`, `snippet`, `schema`, `schema-field`, `style-expression`, `behavior` nodes; edge kinds `binds-schema`, `computes-style`, `attaches-behavior`, `depends-on`; `ConstraintRule<T>` — none produced or consumed anywhere. Reader can't tell real system from roadmap.

**Fix:** split core by pipeline layer (`source.ts`, `syntax.ts`, `symbols.ts`, `graph.ts`, `contract.ts`, `manifest.ts`, `diagnostic.ts`) mirroring compiler passes; delete or quarantine unimplemented kinds into a clearly-marked `planned.ts` (or just git history). Drop filler `packageName` exports (core, cli-dev, registry-api are placeholder one-liners).

### 7. CLI hardcodes contract resolution to `examples/` via `resolve(here, "../../..")`

`cli-client/src/index.ts:79-110` — breaks the moment package installs outside the repo; `catch { return undefined }` swallows manifest/compile errors, degrading to a vague "contract not loaded" warning. Also the double-compile (compile once to discover imports, recompile with contracts) is a workaround for a missing compiler API.

**Fix:** define `ContractResolver` interface in compiler (`resolve(packageId) → ArtifactContract | undefined`); compiler accepts it, or exposes cheap `extractImports(source)`. CLI supplies fs-based resolver; registry-api later supplies HTTP one. Surface resolver errors as diagnostics.

### 8. No tests

Parser + binder are exactly the code that regresses silently. `.nazare-out/*.json` outputs are snapshot fixtures waiting to be formalized.

**Fix:** golden-file tests: compile every `examples/components/*`, snapshot ir/graph/issues, `vitest` or `node:test`. Cheapest possible safety net and doubles as living documentation of compiler output.

## Smaller notes

- `edge:${edges.length + 1}` IDs are order-dependent and meaningless; derive edge id from `kind:from:to` — stable and dedup becomes a Set lookup.
- `compileNazareArtifact` return type is inferred; declare explicit `CompileResult` — it's the package's main public API.
- Parser computes `reachability` via control-flow range containment (`parser.ts:352`) — semantic analysis inside parsing; fine for v0, but belongs in syntax/bind layer once control flow gets modeled.
- `unsupportedSyntax` map keeps only first node per category — later occurrences lose spans; consider collecting all, capping message count at report time.
- README layout block is good — keep it in sync as packages become real; add one paragraph per compiler pass in `packages/compiler/README.md` (the pass pipeline is the core mental model and currently lives only in `index.ts` code).

## Status (2026-07-10)

All eight issues addressed same day, in commits `3da807c`..HEAD:

1. ✅ ids.ts owns all ID formats; symbol scopes navigate nodes, no ID parsing
2. ✅ bind/check split; validate.ts keeps structural invariants only
3. ✅ single `Diagnostic` type; `diagnostics.ts` catalog of all codes
4. ✅ `type-expression.ts` recursive-descent parser; silent skips now diagnose
5. ✅ `ir-index.ts` indexed lookups replace linear scans
6. ✅ core split by layer; aspirational kinds deleted
7. ✅ `ContractResolver` in compiler; CLI fs resolver, no repo-relative path, no double compile
8. ✅ golden tests over examples + unit tests for check/type-expression (17 tests)

Smaller notes: stable content-derived edge ids ✅, explicit `CompileResult` ✅, compiler README ✅. Deferred: reachability stays in parser (fine for v0), unsupported-syntax dedup keeps first node per category.

Follow-up found while testing: string literals are not assignable to `url` props — only `section.settings.*` typed `url` passes. Existing semantics, now documented by tests; decide later whether intentional.

## Suggested order

1. Split binder → `bind` + `check` (issue 2) — biggest structural clarity win.
2. Kill ID string-parsing, add `ids.ts` + indexed IR (issues 1, 5).
3. Unify diagnostics (issue 3).
4. Golden tests over examples (issue 8) — do before further refactors, protects them.
5. Type-expression parser (issue 4), contract resolver (issue 7), core split (issue 6) as follow-ups.
