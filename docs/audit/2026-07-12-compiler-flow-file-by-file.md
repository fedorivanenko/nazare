# Compiler flow audit — file by file

Date: 2026-07-12
Scope: `packages/compiler/src`, starting at public entry point `packages/compiler/src/index.ts`.
Request: architecture clarity, separation of concerns, explicit visible flow, no implicit behavior / hidden feature / magic. No code changes made.

## Verdict

Overall architecture is clean and readable. Main flow is explicit in `index.ts`:

`parseNazareLiquid` → `resolveComponentContracts` → `resolveAssetImports` → `syntaxFromAst` → `bindArtifactIR` → `artifactGraphFromIR` → `checkArtifactIR` / `checkVanillaSchema` → `validateArtifactIR` / `validateArtifactGraph` → optional `emitTheme`.

Concern split is mostly good:

- parse locates source facts and notes unsupported Liquid/HTML.
- resolver owns `readFile` and import graph boundaries.
- syntax flattens AST to stable records.
- bind builds symbols/resolutions without diagnostics.
- check judges user constraints.
- validate judges compiler invariants.
- emit projects by source spans.

No old large hidden regex-lowering issue remains. However, some implicit/default behavior and duplicate-name edge cases still make parts of flow less explicit than ideal.

## Ranked findings

### 1. Duplicate author names silently collapse because IDs are name-derived

Files: `syntax.ts`, `ids.ts`, `symbols.ts`, `check.ts`, `validate.ts`

Several syntax IDs are keyed by authored names rather than occurrence indexes:

- `propDeclarationSyntaxId(file, name)`
- `importSyntaxId(file, localName)`
- `propArgumentSyntaxId(file, renderIndex, propName)`
- `argumentExpressionSyntaxId(file, renderIndex, propName)`

Effects:

- duplicate props can share one prop symbol / one declaration ID;
- duplicate import aliases overwrite `importTargetsByLocalName` in bind;
- duplicate render arguments share IDs and are reduced by `Set` checks;
- validation does not reliably catch the duplicate because identity already collapsed.

Architecture issue: uniqueness is an implicit assumption, not a visible parse/check rule. If duplicates are illegal, parse/check should diagnose them before IDs collapse. If duplicates are legal, occurrence IDs should preserve both nodes and a later policy should decide.

### 2. Nested missing imports can be hidden during dependency checks

File: `resolver.ts`

`resolveComponentContracts` reports missing direct imports from the entry file, but inside recursive `derive()` a missing nested import returns `undefined` without pushing `importNotFound`. `checkDependencies()` calls `resolveComponentContracts(importedAst, readFile)` but ignores its `issues`.

Effect: build can miss `IMPORT_NOT_FOUND` for an imported component's imported component, especially when the missing import is not rendered and therefore does not create an unresolved render-contract diagnostic.

Architecture issue: import graph diagnostics are split between contract derivation and dependency checking, but dependency checking discards part of that boundary output. Flow is less explicit than the docs/comments claim.

### 3. CSS module binding is not really per binding

Files: `parser.ts`, `references.ts`, `check.ts`, `emit.ts`, `css-modules.ts`

Reference nodes carry `binding` (`styles`, `cardStyles`, etc.), but style checking builds one global class-definition map keyed only by class name. Emit scopes only by component name: `nz-${component}__${className}`.

Effects:

- `a.foo` can validate because another bound sheet `b` defines `.foo`;
- two bound sheets with `.foo` collide into the same emitted class;
- authored binding name appears meaningful, but output/checking treat bindings as one component-wide class namespace.

Architecture issue: visible model says css-module binding; implementation behaves as component-wide class map. Either make this explicit as design, or key definitions/scoping by binding/source.

### 4. Root selection still has implicit fallback behavior

File: `emit.ts`

`rootElement()` uses explicit `nz-root` if present, otherwise the first top-level element. Warnings exist for multiple top-level roots and multiple markers, but a single unmarked element is silently selected.

Architecture issue: this behavior is visible in code and comment, so not hidden, but it is still implicit behavior from author perspective. If “whole flow explicit” is strict, require `nz-root` when scripts/block stamping are needed, or surface a note when fallback root selection happens.

### 5. Build dependency validation is not exactly same as entry validation

Files: `index.ts`, `resolver.ts`

Entry compile validates both IR and graph. `checkDependencies()` validates dependency IR but not dependency graph.

Effect: likely low risk because graph is derived and entry graph validation covers entry only. Still, “build validates dependencies” is not literally the same pass set as entry compile.

Architecture issue: dependency flow should either call the same compile/check helper per dependency, or document that dependency graph validation is intentionally skipped.

### 6. Parser still owns many mini-grammars by regex/manual splitting

Files: `parser.ts`, `type-expression.ts`, `references.ts`

Current parser has explicit helpers for each syntax shape, which is good. Still, important mini-grammars are hand-rolled:

- `importPattern`
- `renderPattern`
- `scriptBlockPattern` / `styleBlockPattern`
- `splitTopLevelWithOffsets`
- reference token scanning

This is not hidden magic, but it concentrates many syntax rules in one file. Most are commented and bounded. Highest-risk ones are script/style block regex extraction before LiquidHTML parsing, because this is source surgery before the structural parser runs.

Recommendation: keep as-is short term, but add tests around edge syntax (`%` in raw tag markup, duplicate tags, nested/raw weirdness). Longer term: parse raw tags via LiquidHTML AST if parser can preserve bodies safely.

## File-by-file notes

### `index.ts`

Good entry point. Compile/build flow is explicit and documented. `buildNazareTheme()` visibly adds dependency checking and emit. One nit: `CompileResult.syntax` and `CompileResult.ir` comments both say “Flat syntax nodes...” for `ir`; comment should distinguish IR.

### `parser.ts`

Strong separation: parse owns surface syntax, spans, unsupported notes. Good: scripts/styles blanked to preserve spans; references collected once from Liquid expression regions; notes separate from diagnostics.

Concerns: duplicate props/imports/args not diagnosed here; root fallback not relevant here; script/style raw-block regex extraction is pre-parser source manipulation.

### `ast.ts`

Clear parse-output model. Good distinction between diagnostics and notes. `NazareOpaqueNode` exists but parser does not emit it; either future placeholder or dead API surface.

### `references.ts`

Good improvement over textual output rewriting. References are located facts with spans. Style binding semantics concern remains: scanner respects binding names, later checker/emitter mostly do not.

### `resolver.ts`

Good filesystem boundary. `ReadFile` is explicit. Asset import resolution clones AST, good. Main issue: nested import graph issues can be dropped during dependency checks.

### `syntax.ts`

Good flat syntax projection. Concern: name-derived IDs collapse duplicates. This file is where occurrence identity should be preserved or duplicate policy should already be enforced.

### `symbols.ts`

Good “facts only, no diagnostics” binder. Scope lookup navigates syntax nodes instead of parsing IDs, good. Concern: duplicate aliases/properties are not surfaced; `importTargetsByLocalName` overwrite is implicit.

### `graph.ts`

Clean derived projection. No major issues. Edge IDs from content are explicit.

### `check.ts`

Good rule registry; mode behavior visible in `CHECK_RULES`. Good concern split: contracts/scripts/authoring/styles. Concerns: duplicate authored names not checked; style definitions are global across bindings.

### `validate.ts`

Good compiler-invariant pass. Concern: cannot catch duplicate authored syntax after ID collapse; dependency graphs not validated in `checkDependencies()`.

### `emit.ts`

Mostly good span-projection architecture. Emit does not re-read transformed output except final whitespace compaction. References inside render tags are handled by rebuilding render tags from syntax, explicit and reasonable.

Concerns: root fallback first top-level element; CSS scoping ignores binding/source; `applyEdits()` has no overlap assertion, so invariant depends on earlier passes.

### `hoist.ts`

Hoisting is explicit and well documented. Collision and alias-reuse checks make generated behavior visible. Good architecture.

### `schema.ts`

Clear IR-to-Shopify schema projection. Small fallback: unknown block slot path emits `name.toLowerCase()`, though check should report unknown reference in strict mode. Acceptable but slightly magical in emit output after errors.

### `bundle.ts`

Clear project-scoped bundler boundary. Good: relative-only specifiers, cycle/missing diagnostics. Concern: emit-time bundling diagnostics mean some script import errors appear only during emit, not plain compile; this is documented by separate `checkComponentScripts`/emit path.

### `css-modules.ts`

Good use of PostCSS/selector parser; no regex over CSS values. Concern: scoping name lacks binding/source component, causing component-wide class namespace.

### `data-channel.ts`

Clear derived data contract. Limitation: expression type resolution only recognizes exact `props.x`. That is explicit in code and okay for now; document in user-facing model if needed.

### `script-scan.ts`

Good AST-based scanner. Explicit limitation: no scope analysis; shadowing is separately checked. Good.

### `script-modules.ts`

Small focused pass. Good.

### `check-script.ts`

Separate opt-in expensive TS check is reasonable. Virtual FS behavior is documented. No major architecture issue.

### `check-vanilla.ts`

Clear vanilla schema checker. Good separation from Nazare-generated schema.

### `type-expression.ts`

Hand-rolled DSL parser is explicit and readable. No hidden behavior found. Keep tests as grammar grows.

### `runtime.ts`

Typed runtime source is cleaner than opaque string. Behavior is visible. Runtime still uses DOM queries and `Proxy`, but this is runtime layer, not compiler-flow magic.

### `ids.ts`

Good single owner of ID formats. Main issue: name-derived syntax IDs require duplicate-name diagnostics elsewhere, currently missing.

### `paths.ts`

Clear project-relative path math. No issue.

### `diagnostics.ts`

Good central diagnostic registry. Missing factories for duplicate imports/props/render args/style binding collisions if project decides to make those illegal.

## Recommendations

1. Add explicit duplicate-name rules before or during check:
   - duplicate prop declarations;
   - duplicate import local names;
   - duplicate render argument names per render site;
   - duplicate stylesheet binding names if bindings are intended unique.
2. Preserve occurrence identity in syntax IDs where duplicates can appear, then check duplicates as user errors.
3. Fix `resolver.ts` so dependency import graph issues are surfaced for nested dependencies.
4. Decide CSS module model:
   - component-wide class namespace: remove per-binding illusion from docs/types/messages; or
   - true per-binding modules: key definitions and scoped names by binding/source.
5. Decide root policy:
   - keep first-root fallback but surface note; or
   - require `nz-root` for scripts/block stamping.
6. Make dependency checking reuse the same validation set as entry compile, or document intentional differences.

## Bottom line

Architecture is mostly clean and explicit. Biggest remaining risk is not pass separation; it is implicit uniqueness/global-namespace assumptions. Fixing duplicate identity and CSS binding semantics would make compiler flow much closer to “no magic, all behavior visible from code.”
