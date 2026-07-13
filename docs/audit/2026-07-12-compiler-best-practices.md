# Compiler best-practices audit

Date: 2026-07-12
Scope: `packages/compiler/src` and compiler tests. No code changes made.

## Verdict

Nazare compiler now follows most practical compiler architecture best practices for a small language/tooling compiler:

- explicit phase pipeline;
- clear frontend / resolution / IR / checking / validation / emit split;
- source spans preserved through passes;
- diagnostics aggregated instead of throwing for user errors;
- filesystem access isolated behind `ReadFile`;
- stable flat syntax/IR/graph data structures;
- no output-text regex lowering;
- explicit mode registry;
- emit mostly pure span projection;
- good golden and diagnostic test coverage.

Remaining gaps are not architectural blockers, but matter if compiler grows: phase orchestration duplication, overlap-safety in emit edits, partial recovery/error gating, performance caching/incremental APIs, and formal spec docs for language semantics.

## Best-practice checklist

### 1. Explicit phases and one-way data flow — PASS

Entry point `index.ts` exposes readable flow:

`parseNazareLiquid` → `resolveComponentContracts` → `resolveAssetImports` → `syntaxFromAst` → `bindArtifactIR` → `artifactGraphFromIR` → `checkArtifactIR` / `checkVanillaSchema` → `validateArtifactIR` / `validateArtifactGraph` → `emitTheme`.

Good:

- flow visible from code;
- emit separated from compile;
- build adds dependency checking explicitly;
- validation separated from user checks.

Gap:

- same phase sequence is partly repeated in `resolver.ts` for dependencies. This is visible but duplicate. Best practice is one internal `compileCore()` / `compileDependency()` orchestration helper so pass order cannot drift.

### 2. Parse owns surface syntax only — PASS

`parser.ts` mostly follows frontend best practice:

- collects Nazare nodes and spans;
- preserves LiquidHTML AST;
- reports parse diagnostics instead of crashing;
- separates unsupported modeled gaps into `notes`;
- locates references in Liquid expression regions, not whole output text.

Good:

- source spans maintained;
- Liquid parse errors become diagnostics;
- scripts/styles blanked to preserve offsets;
- explicit duplicate diagnostics added for imports, props, render args.

Gap:

- parser still contains several mini-grammars (`importPattern`, `renderPattern`, raw block regexes, top-level splitting). This is acceptable for current scope, but grammar should become a documented module/spec as syntax grows.

### 3. File I/O boundary isolation — PASS

`resolver.ts` and `bundle.ts` keep all external file reads behind `ReadFile`.

Good:

- compile remains testable and deterministic;
- path math is isolated in `paths.ts`;
- imports cannot escape project root;
- nested dependency import failures are now surfaced.

Gap:

- no shared per-build cache object exposed to callers; contract derivation caches internally only per call. For large projects, best practice is explicit compiler context/cache.

### 4. Stable IR and no hidden identity collapse — PASS after fixes

`syntax.ts` produces flat `ArtifactSyntaxNode[]`; `symbols.ts` builds facts only.

Good:

- later passes do not consume parser tree directly;
- IDs owned by `ids.ts`;
- duplicate-sensitive syntax IDs now include occurrence indexes;
- bind does not emit diagnostics.

Gap:

- syntax IDs still include authored names. Good for readability, but long-term robust IDs usually separate stable occurrence identity from display/debug names.

### 5. Separate bind/check/validate concerns — PASS

`symbols.ts`, `check.ts`, `validate.ts` are properly separated.

Good:

- bind records symbols/resolutions only;
- check reports user constraint diagnostics;
- validate reports compiler invariant failures;
- `CHECK_RULES` is single mode registry.

Gap:

- some semantic facts are recomputed outside bind (e.g. reference lowering provenance in `emit.ts`, data-channel resolution in `data-channel.ts`). This is fine now, but best practice for larger compilers is to make resolved reference/value projections first-class IR facts.

### 6. Diagnostics quality and recovery — MOSTLY PASS

Good:

- diagnostics centralized in `diagnostics.ts`;
- codes are stable and specific;
- parse/check/emit diagnostics aggregate;
- malformed Liquid is diagnostic, not crash;
- notes are separate from issues.

Gaps:

- no severity policy gate before emit. Emit can run with known compile errors and produce best-effort output. Useful for tooling, but build mode should probably expose an explicit `canEmit` / `hasErrors` / `emitOnError` policy.
- compiler-invariant diagnostics share same `Diagnostic` shape as user errors. Good for plumbing, but consumers may need category/source field (`parse`, `check`, `validate`, `emit`) to display correctly.

### 7. Emit as projection, not reparse/rewrite — MOSTLY PASS

Good:

- Liquid edits use spans;
- references lower by located spans;
- render tags rebuilt from syntax facts;
- CSS parsed through PostCSS/selector parser;
- runtime source is typed TS function, not opaque string.

Gaps:

- `applyEdits()` does not assert no overlaps. Best practice: emit should fail loudly on overlapping edits because overlap means compiler bug.
- final Liquid whitespace compaction (`replace(/\n{3,}/g, "\n\n").trim()`) is intentional output formatting, but it is still whole-output text mutation. Low risk; document as formatting stage or isolate as `formatLiquidOutput()`.

### 8. Determinism and reproducible output — PASS

Good:

- source order sorting in parser;
- stable IDs and graph edge IDs;
- snapshots cover emitted output;
- generated headers record provenance.

Gap:

- dependency diagnostics can appear multiple times in some graph shapes because each dependency visit derives contracts recursively. `checked` dedupes visited files, but `resolveComponentContracts()` can report nested failures per parent. Usually acceptable; best practice is diagnostic de-dupe by `(code, span, message)` at top-level aggregation.

### 9. Testing strategy — PASS

Good:

- diagnostic table tests;
- emit snapshots;
- references regression tests;
- runtime VM tests;
- type-expression parser tests;
- CSS module tests;
- explicit API tests for architectural behavior.

Gaps:

- no property/fuzz tests for parser mini-grammars or source span round-trips;
- no explicit tests for edit-overlap safety because no guard exists;
- no large fixture/performance regression tests.

### 10. Performance / scalability — ADEQUATE FOR NOW

Good:

- simple flat arrays and derived indexes;
- `indexArtifactIR()` localized;
- TypeScript script checking is opt-in, not on main compile path;
- contract derivation uses cache per resolution.

Gaps:

- repeated `indexArtifactIR()` calls across check subpasses;
- repeated parsing/binding of dependencies between compile, dependency checks, and emit/build;
- no incremental compiler/session API;
- no cross-phase shared memoization.

For current small compiler, fine. For theme-sized projects, add `CompilerContext` with caches for source, AST, syntax, IR, contracts, diagnostics.

### 11. Language spec / explicit semantics — PARTIAL

Code comments are strong, but best practice is separate user/compiler spec docs for:

- Nazare tag grammar;
- prop type DSL grammar;
- loose vs strict semantics;
- CSS module binding model;
- root selection policy;
- dependency/build validation policy;
- emit-on-error policy.

Current semantics are mostly visible from code and tests, but not centralized as a language spec.

## Remaining best-practice recommendations

1. Add internal orchestration helper for shared pass sequence.
   - Avoid drift between `compileNazareArtifact()` and `checkDependencies()`.
2. Add `applyEdits()` overlap assertion.
   - Compiler bug should surface clearly.
3. Add explicit emit policy.
   - `emitOnError?: boolean`, `canEmit`, or `result.status`.
4. Introduce compiler diagnostic categories.
   - `phase: "parse" | "resolve" | "check" | "validate" | "emit"`.
5. Create compiler context/cache for project builds.
   - Avoid repeated dependency parsing/binding.
6. Document formal syntax/semantics in `docs/`.
   - Especially CSS module binding and root fallback.
7. Add parser/span fuzz tests.
   - Protect mini-grammars and offset math.
8. Optionally move reference replacement decisions from emit into bind/IR.
   - Stronger “bind resolves, emit projects” invariant.

## Bottom line

Compiler best practices are mostly applied. Architecture is clean, phase boundaries are readable, diagnostics are centralized, and hidden behavior has been reduced. Remaining work is hardening: shared orchestration, edit invariant guards, explicit emit policy, caching, and formal spec docs.
