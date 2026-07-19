# Audit: `feat/plain-liquid-frontend` + compiler flow

Worktree: `/Users/fedori/Coding/personal/nazare-plain-liquid-frontend`
Branch: `feat/plain-liquid-frontend`

## Current state

`feat/plain-liquid-frontend` currently points at `main` / `origin/main` (`a1056fd Refactor compiler frontend architecture (#54)`). There are no branch commits ahead of `main`.

Working tree changes:

```txt
 M packages/compiler/README.md
 M packages/compiler/src/emit.ts
 M packages/compiler/src/frontend.ts
 M packages/compiler/src/index.ts
 M packages/compiler/src/parser.ts
?? docs/audit-plain-liquid-frontend.md
?? packages/compiler/src/frontends/plain-liquid.ts
?? packages/compiler/src/plain-liquid.ts
?? packages/compiler/src/settings-reads.ts
?? packages/compiler/tests/plain-liquid.test.mjs
```

## Checks run

```sh
cd /Users/fedori/Coding/personal/nazare-plain-liquid-frontend
biome check packages/compiler/src packages/compiler/tests/plain-liquid.test.mjs packages/compiler/README.md docs/audit-plain-liquid-frontend.md
pnpm --filter @nazare/compiler -s typecheck
node --test packages/compiler/tests/plain-liquid.test.mjs
pnpm -s test:compiler
```

Results in this checkout:

- `biome check ...` passed.
- `pnpm --filter @nazare/compiler -s typecheck` passed.
- `node --test packages/compiler/tests/plain-liquid.test.mjs` passed: 14/14 tests.
- `pnpm -s test:compiler` passed: 165/165 compiler tests.

## Plain Liquid frontend audit

### Current assessment

Previous blockers are addressed:

- built-in `plainLiquidFrontend` exists and is selected by `compileArtifact()` for plain `.liquid` files after `nazareLiquidFrontend`;
- `CompileInput.frontendOptions` carries frontend-owned options;
- `FrontendResult.metadata` / `CompileArtifactSuccess.frontendMetadata` carry frontend metadata;
- `compilePlainLiquid()` and `buildPlainLiquid()` live in `packages/compiler/src/index.ts` and delegate through `compileArtifact({ frontend: plainLiquidFrontend })`;
- duplicate exported wrapper implementations were removed from `packages/compiler/src/plain-liquid.ts`;
- settings reads are collected by shared `settings-reads.ts` scanner from parser `VariableLookup` nodes, not regex over source text;
- string literals containing `section.settings.x` / `block.settings.x` are ignored by tests;
- dependency extraction classifies static, dynamic, layout-none, and unsupported cases;
- unsupported dependency markup is an error, so incomplete dependency facts block build-style emit unless caller opts into `emitOnError`;
- unquoted `{% layout none %}` is modeled explicitly;
- `Range` expression scanning visits `start` / `end` children and `ForMarkup.collection`;
- plain Liquid `contractProvenance` is `"none"`, not confused with Shopify authored schema;
- public option types are exported;
- `plainLiquidMetadata()` has a stricter guard.

### Remaining Plain Liquid findings

No blocking Plain Liquid findings remain.

Non-blocking Plain Liquid follow-ups: none.

## Full compiler flow audit: file by file

### Entry + frontend selection

#### `packages/compiler/src/index.ts`

Role: public API and orchestration: frontend selection, shared projection, Nazare build emit, plain Liquid wrappers.

Flow:

1. `compileArtifact()` selects explicit frontend, caller frontends, `nazareLiquidFrontend`, then `plainLiquidFrontend`.
2. `nazare-ast` results go through `projectArtifact()`.
3. `direct-ir` results go through `projectIR()`.
4. `compileNazareArtifact()` forces `nazareLiquidFrontend` and throws only if generic result is failure or AST missing.
5. `buildNazareTheme()` compiles, checks dependencies, emits.
6. `compilePlainLiquid()` forces `plainLiquidFrontend` and extracts typed metadata.
7. `buildPlainLiquid()` emits source unchanged only when `canEmit` or explicit `emitOnError`.

Findings:

- Plain metadata guard is explicit enough for current known frontend. Generic `frontendMetadata` remains `unknown` by design; typed wrappers must guard.

#### `packages/compiler/src/frontend.ts`

Role: frontend contract and support metadata.

Findings:

- `frontendOptions?: Record<string, unknown>` is explicit frontend-owned extension point.
- `metadata?: unknown` is intentionally opaque; wrapper guards are required and present for plain Liquid.

#### `packages/compiler/src/frontends/nazare-liquid.ts`

Role: Nazare Liquid source adapter.

Flow:

1. parse source with `parseNazareLiquid()`;
2. resolve component contracts;
3. resolve asset imports;
4. return `nazare-ast` result.

Findings:

- Good separation: frontend parses/resolves; shared projection checks/validates.
- Asset import diagnostics are inserted into AST diagnostics by `resolveAssetImports()` and phase-preserved by `markDiagnostics()`. No silent drop seen.

#### `packages/compiler/src/frontends/plain-liquid.ts`

Role: plain Shopify Liquid source adapter.

Flow:

1. validate `frontendOptions.parseMode`;
2. parse/index plain Liquid;
3. create file-only direct IR;
4. attach vanilla schema diagnostics and metadata.

Findings:

- `contractProvenance: "none"` is correct; Shopify schema is not a Nazare contract.
- Invalid frontend option produces an error diagnostic but still parses with default options. This is visible and blocks `canEmit`; acceptable.

### Parse + source facts

#### `packages/compiler/src/parser.ts`

Role: Nazare Liquid parser. Extracts Nazare nodes, authored schema, settings reads, raw script/style blocks, refs/data/islands, unsupported Liquid/HTML notes.

Findings:

- Prior raw-source regex settings scan is removed. Parser now uses shared `scanSettingsReadsFromLiquidAst()` from `settings-reads.ts`.
- Regression test covers settings-looking string literals in `.nz.liquid`.
- Parser still uses tolerant LiquidHTML mode by design and reports unsupported Liquid/HTML as notes. This is explicit in current compiler model.
- Raw script/style extraction is complex but purpose is explicit: protect HTML parser spans.

#### `packages/compiler/src/settings-reads.ts`

Role: shared Liquid AST scanner for literal `section.settings.x` / `block.settings.x` reads.

Findings:

- AST-based scan avoids previous false positives from strings/plain text.
- Handles `ForMarkup.collection` and `Range.start` / `Range.end`.
- Unknown expression shapes produce a visible `LIQUID_UNSCANNED_SETTINGS_EXPRESSION` warning diagnostic.

#### `packages/compiler/src/plain-liquid.ts`

Role: plain Shopify Liquid parser/indexer.

Findings:

- Strict default, tolerant opt-in, parse failure `factsCollected: false`, explicit skipped-facts diagnostic.
- Unsupported dependency markup is error. Good.
- Settings-read scan is shared with Nazare parser through `settings-reads.ts`.

#### `packages/compiler/src/ast.ts`

Role: AST/fact type definitions.

Findings:

- Shared `settingsReads` model is now fed by one scanner, reducing drift.

#### `packages/compiler/src/source.ts`

Role: offset/position/span conversion.

Findings:

- Simple, explicit utility. No issue found.

#### `packages/compiler/src/paths.ts`

Role: local import path normalization.

Findings:

- Explicit relative-path handling and traversal blocking. No issue found.

### Resolve + projection

#### `packages/compiler/src/resolver.ts`

Role: project file access boundary: component contract resolution, dependency checks, asset import replacement.

Findings:

- Good: all file reads go through `ReadFile`.
- `checkDependencies()` intentionally ignores unreadable imports because `resolveComponentContracts()` reports them. This is documented. Acceptable if callers keep using the paired flow.

#### `packages/compiler/src/pipeline.ts`

Role: shared pass orchestration after frontend output.

Findings:

- Single place for graph/check/validate/contract projection.
- `projectIR()` defaults all frontend issues to parse phase unless already phased. Frontend authors must phase non-parse diagnostics themselves.

#### `packages/compiler/src/syntax.ts`

Role: lower AST to flat syntax records and literal expression type inference.

Findings:

- Flat explicit shape.
- `inferExpressionType()` intentionally only handles simple literals. Unknowns are allowed and later type checks treat unknown as assignable. This is broader compiler permissiveness. If strict mode should mean no unchecked types, add diagnostics for unknown expression types at typed render sites.

#### `packages/compiler/src/symbols.ts`

Role: bind syntax facts into symbols/resolutions and derive contracts.

Findings:

- Throws on impossible missing scope instead of fabricating.
- `componentKindFromIR()` defaults to `snippet` when no component syntax exists. Documented behavior, but still a default.

#### `packages/compiler/src/graph.ts`

Role: graph projection from IR.

Findings:

- No issue found in flow review. Validation checks endpoints.

#### `packages/compiler/src/ir-index.ts`

Role: query/index helpers over IR.

Findings:

- No issue found in flow review.

#### `packages/compiler/src/merge.ts`

Role: deterministic IR merge/dedupe.

Findings:

- Unknown resolution kind throws instead of silent dedupe gap.

### Checks + validation

#### `packages/compiler/src/check.ts`

Role: user-facing semantic checks.

Findings:

- `CompilerMode` default is `strict`. Good, documented.
- `isAssignable()` returns true if either side is `unknown`. This can hide type gaps from `inferExpressionType()`. Not a plain Liquid blocker, but relevant to “no implicit behavior” across compiler.

#### `packages/compiler/src/check-vanilla.ts`

Role: validate `section.settings.x` / `block.settings.x` reads against authored Shopify schema.

Findings:

- Depends on `settingsReads` accuracy. Shared AST scanner improves this.

#### `packages/compiler/src/check-script.ts`

Role: TypeScript virtual-program script checking.

Findings:

- Explicit virtual FS/module handling. No flow issue found.

#### `packages/compiler/src/validate.ts`

Role: compiler invariant validation over IR and graph.

Findings:

- Structural compiler bugs become diagnostics, not silent.

#### `packages/compiler/src/diagnostics.ts`

Role: diagnostic factories and stable codes/messages.

Findings:

- Good centralization.
- New plain/shared settings diagnostics live outside this file. Consider moving them here for code consistency and discoverability.

### Emit + runtime/assets

#### `packages/compiler/src/emit.ts`

Role: Shopify theme file emission via span-based source edits, CSS/script/runtime outputs.

Findings:

- Overlapping edits become diagnostic instead of corrupted output.
- Precondition errors now stop before emitting files. Good.

#### `packages/compiler/src/schema.ts`

Role: generated Shopify schema from IR.

Findings:

- Defaults/presets are explicit in code. No flow issue found.

#### `packages/compiler/src/css-modules.ts`

Role: CSS class extraction/rewrite.

Findings:

- Invalid CSS is treated as uninspectable helper behavior per comment. If CSS module facts are a hard build guarantee, parse failures should become diagnostics. Current behavior can hide CSS module class facts.

#### `packages/compiler/src/bundle.ts`

Role: JS dependency bundling for scripts.

Findings:

- Relative-only module graph is explicit. No flow issue found.

#### `packages/compiler/src/runtime.ts`

Role: emitted browser runtime.

Findings:

- `ParseKind` treats anything except known `number` / `boolean` as pass-through string. Acceptable if generated kinds are controlled; if new data types are added, add generated kind validation.

#### `packages/compiler/src/script-modules.ts`

Role: unsupported JS/TS module syntax detection.

Findings:

- No flow issue found.

#### `packages/compiler/src/script-scan.ts`

Role: script static scans for default export, refs/data accesses, reserved context shadows.

Findings:

- No specific flow issue found in this pass.

#### `packages/compiler/src/references.ts`

Role: CSS/props reference scanning in Liquid regions.

Findings:

- Uses regex on isolated Liquid regions, not whole source.
- Correctness depends on `parser.ts` `liquidRegion()` returning regions. Unknown region shapes return `undefined` and may skip references silently. Existing unsupported Liquid/HTML notes do not specifically cover reference scan gaps.

#### `packages/compiler/src/data-channel.ts`

Role: infer script data channel payload descriptors from refs/data bindings.

Findings:

- Non-prop/unknown-typed binding reads as string by design comment. If strict no-magic is applied globally, consider diagnostic for unknown data binding type.

#### `packages/compiler/src/hoist.ts`

Role: hoist dependency setting props through parents.

Findings:

- Explicit collision diagnostics. No flow issue found.

#### `packages/compiler/src/type-expression.ts`

Role: parse/check props type DSL.

Findings:

- Unknown type/call names are represented in parse result and checked. Good.

#### `packages/compiler/src/extensions.ts`

Role: extension API types.

Findings:

- No flow issue found.

#### `packages/compiler/src/ids.ts`

Role: stable opaque ID construction.

Findings:

- IDs are opaque by policy. No flow issue found.

## Priority follow-ups

1. In strict mode, consider diagnostics for unknown expression types at typed render sites and unknown data binding parse kinds.
2. Consider generated kind validation for runtime parse kinds if new data types are added.


## Summary

Plain Liquid frontend matches the requested shape: explicit frontend, explicit options, strict parse by default, explicit failure states, no regex semantic settings facts, unsupported dependency markup as errors, and pass-through emit gated by `canEmit` unless explicitly overridden. Worktree is green for compiler checks (`biome`, compiler typecheck, plain tests, full compiler tests). Remaining items are broader compiler design follow-ups, not blockers for the plain Liquid frontend.
