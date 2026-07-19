# Compiler frontend refactor plan

## Goal

Make compiler inputs modular without weakening the current `.nz.liquid` authoring path.

The compiler should become a shared semantic pipeline with pluggable source frontends:

```text
source language
→ frontend
→ Nazare semantic model
→ shared graph/check/validate/emit pipeline
```

Immediate use case: a Storybook-like Liquid workshop.

- `.nz.liquid` remains strict and authoritative.
- raw Shopify `.liquid` becomes best-effort and migration-friendly.
- future inputs can be added only if they translate into the Nazare artifact model.

## Architectural principles

1. **Frontend translation is explicit.** No source language enters the shared pipeline accidentally.
2. **The shared pipeline consumes facts, not parser details.** Frontends produce the same semantic model.
3. **Strictness is preserved.** Heuristic raw Liquid inference must not relax `.nz.liquid` checks.
4. **Best-effort inputs are marked.** Raw Liquid contracts carry confidence and warnings.
5. **Emit is downstream of semantics.** Emitter should depend on `ArtifactIR` and contracts, not a particular parser AST.
6. **Registry and Browse stay outside compilation.** Browse reads metadata/code; preview/workshop compiles.

## Current architecture

Current public entry points are tightly coupled to Nazare Liquid parsing:

```text
compileNazareArtifact(source, file)
→ parseNazareLiquid(source, file)
→ resolveComponentContracts(ast)
→ resolveAssetImports(ast)
→ syntaxFromAst(ast)
→ bindArtifactIR(syntax)
→ check/validate/project
→ CompileResult

buildNazareTheme(source, file)
→ compileNazareArtifact(source, file)
→ checkDependencies(ast)
→ emitTheme(source, compiled)
```

This makes `.nz.liquid` the only first-class input and lets later stages rely on parser-specific data.

## Target architecture

```text
CompileRequest
→ FrontendRegistry.select()
→ CompilerFrontend.compile()
→ FrontendResult
→ normalize/project shared result
→ graph/check/validate
→ emit
```

Layer ownership:

```text
packages/compiler
  public compile API
  frontend selection
  shared semantic pipeline
  built-in .nz.liquid frontend
  emit API

packages/liquid-contract
  raw Shopify Liquid parsing
  inferred contract model
  no dependency on compiler internals if possible

packages/frontend-liquid (or compiler/src/frontends/raw-liquid.ts initially)
  raw .liquid frontend
  maps RawLiquidContract + Liquid AST to Nazare semantic model

packages/dev-server
  workshop/story runtime
  frontend selection by file extension
  watch/hot reload
  Liquid render sandbox

apps/website
  Browse/docs/marketing UI
  no compile dependency unless preview is intentionally added
```

## Shared semantic boundary

The key design choice: frontends must output compiler facts, not arbitrary rendered code.

Preferred long-term boundary:

```ts
export type FrontendResult = {
  ir: ArtifactIR;
  contract: ArtifactContract;
  contracts: ArtifactContract[];
  capabilities: FrontendCapabilities;
  sourceForEmit?: string;
  issues: Diagnostic[];
  notes: Diagnostic[];
};
```

`ArtifactIR` is the shared semantic model. `NazareAst` remains implementation detail of the `.nz.liquid` frontend.

Short-term bridge for raw Liquid may output virtual `.nz.liquid`, then delegate to the Nazare frontend. That is an implementation shortcut, not the final architecture.

## Public API shape

```ts
export type CompileInput = {
  source: string;
  file: string;
  readFile?: ReadFile;
  strictness?: CompilerMode;
};

export type CompileArtifactOptions = CompileInput & {
  frontend?: CompilerFrontend;
  frontends?: CompilerFrontend[];
};

export type CompilerFrontend = {
  name: string;
  accepts(file: string, source: string): boolean;
  compile(input: CompileInput): FrontendResult;
};

export type FrontendCapabilities = {
  explicitContract: boolean;
  explicitProps: boolean;
  explicitSchema: boolean;
  explicitImports: boolean;
  explicitBehavior: boolean;
  inferredContract: boolean;
};

export function compileArtifact(options: CompileArtifactOptions): CompileResult;
```

Selection order:

1. `options.frontend`, if provided
2. first match from `options.frontends`
3. built-in `nazareLiquidFrontend`
4. unsupported-input diagnostic

Compatibility wrappers remain stable:

```ts
compileNazareArtifact(source, file, options)
buildNazareTheme(source, file, options)
```

These call `compileArtifact({ frontend: nazareLiquidFrontend, ... })`.

## Result model

`CompileResult` should become frontend-agnostic:

```ts
export type CompileResult = {
  frontend: string;
  syntax?: ArtifactSyntaxNode[];
  ir: ArtifactIR;
  graph: ArtifactGraph;
  issues: Diagnostic[];
  notes: Diagnostic[];
  canEmit: boolean;
  contract: ArtifactContract;
  contracts: ArtifactContract[];
  capabilities: FrontendCapabilities;
  sourceForEmit?: string;
};
```

`ast` can remain on `compileNazareArtifact()` return for compatibility, but generic `compileArtifact()` should not require a `NazareAst`.

## Built-in `.nz.liquid` frontend

Current path becomes `nazareLiquidFrontend`:

```text
.nz.liquid source
→ parseNazareLiquid()
→ resolveComponentContracts()
→ resolveAssetImports()
→ syntaxFromAst()
→ bindArtifactIR()
→ projectArtifact()
→ FrontendResult
```

Behavior must remain unchanged in first refactor.

Compatibility requirement:

- Existing tests should pass unchanged.
- Existing diagnostics should remain same where possible.
- Existing `compileNazareArtifact()` shape should remain source-compatible.

## Raw Liquid frontend

Raw Shopify Liquid should be explicit and best-effort.

### Raw contract inference package

`packages/liquid-contract` parses raw Liquid and extracts a contract:

```ts
export type RawLiquidContract = {
  kind: "snippet" | "section" | "template" | "unknown";
  inputs: RawLiquidInput[];
  renders: RawLiquidRender[];
  settings: RawLiquidSetting[];
  blocks: RawLiquidBlock[];
  assets: string[];
  translations: string[];
  globals: string[];
  warnings: Diagnostic[];
};

export function inferLiquidContract(source: string, file: string): RawLiquidContract;
```

Extractable facts:

- variable reads: `{{ product.title }}`, `{{ label }}`
- section settings: `section.settings.heading`
- block settings: `block.settings.image`
- schema settings/blocks from `{% schema %}`
- snippet renders: `{% render 'price', product: product %}`
- assets: `{{ 'x.css' | asset_url }}`
- translation keys: `{{ 'products.card.title' | t }}`
- Shopify globals: `product`, `cart`, `collection`, `routes`, `settings`
- dynamic/ambiguous reads as warnings

Use a Shopify-aware Liquid parser, not regex. Candidate: `@shopify/liquid-html-parser`.

### Raw frontend phase 1: virtual Nazare bridge

```text
raw .liquid
→ inferLiquidContract()
→ adaptRawLiquidToNazareSource()
→ nazareLiquidFrontend.compile()
```

Example input:

```liquid
<button>{{ label }}</button>
```

Virtual `.nz.liquid`:

```liquid
{% props label: string %}

<button>{{ props.label }}</button>
```

Constraints:

- identifier rewrite must be AST-based
- dynamic access becomes warning and likely `unknown`
- Shopify globals must not be rewritten into props
- section/schema constructs should map to section/block contract where possible

### Raw frontend phase 2: direct IR

```text
raw Liquid AST
→ RawLiquidContract
→ ArtifactIR
→ shared graph/check/emit
```

This removes virtual source and makes raw Liquid a real frontend.

## Checks and validation architecture

Checks need capability-aware gates.

```text
FrontendCapabilities + CompilerMode
→ enabled check set
```

Modes:

- `strict`: package-authoring, current `.nz.liquid` behavior
- `loose`: migration/preview, fewer hard errors
- optional future `inferred`: best-effort raw Liquid checks

Rules:

- explicit `.nz.liquid` contract errors stay errors
- inferred raw Liquid ambiguity becomes warning/note
- checks requiring explicit props/schema skip when capability is absent
- emit preconditions must be minimal and artifact-based

## Emit architecture

Current `emitTheme(source, compiled, options)` should evolve toward:

```ts
emitTheme({
  ir,
  contract,
  contracts,
  sourceForEmit,
  options,
});
```

Emitter should not inspect `NazareAst` unless behind a frontend-specific adapter.

If emitter needs data currently only present on `NazareAst`, move that data into one of:

- `ArtifactIR`
- `ArtifactContract`
- explicit `FrontendResult` field

## Dependency resolution architecture

Current dependency resolution reads imported `.nz.liquid` files and derives contracts.

Target:

```text
frontend resolves own imports
or
shared resolver delegates each imported file to frontend registry
```

Preferred long-term:

```ts
export type ResolveDependency = (file: string) => Promise<FrontendResult | undefined>;
```

For first pass, keep existing resolver for `.nz.liquid`; raw Liquid frontend can start with no imported contract resolution or delegate only known `.nz.liquid` imports.

## Story/workshop architecture

The Storybook-like tool should sit above compiler:

```text
*.stories.json/ts
+ component source
→ choose frontend by extension
→ compileArtifact()
→ emitTheme()
→ render emitted Liquid with mock Shopify context
→ iframe preview
```

Workshop owns:

- stories
- controls
- mock data
- watch/hot reload
- browser UI
- iframe isolation
- render sandbox

Compiler owns:

- frontend translation
- semantic facts
- diagnostics
- theme emission

## Registry and Browse boundary

Browse remains registry/UI architecture:

```text
registry API
→ component metadata/summaries
→ Astro pages/cards
```

Browse should not require compiler. If Browse later gets live previews, that preview path should call workshop/preview services, not registry storage code.

## Implementation phases

### Phase 0: design guardrails

- Document this architecture.
- Identify current compiler functions that leak `NazareAst` into checks/emit.
- Mark public compatibility APIs that must not break.

### Phase 1: extract frontend seam

- Add `CompilerFrontend`, `CompileInput`, `FrontendResult`, `FrontendCapabilities` types.
- Move current hardcoded path into `nazareLiquidFrontend`.
- Add `compileArtifact()` generic entry point.
- Implement `compileNazareArtifact()` as wrapper.
- Keep test expectations unchanged.

### Phase 2: make pipeline frontend-agnostic

- Make generic `CompileResult` not require `ast`.
- Gate checks by capabilities.
- Audit `emitTheme()` for parser-specific assumptions.
- Move required emit facts into `ArtifactIR`/contracts.

### Phase 3: raw Liquid contract package

- Add parser-backed `inferLiquidContract()`.
- Add tests for variables, renders, schema, assets, translations, dynamic access.
- Emit warnings for ambiguous contracts.

### Phase 4: raw Liquid frontend bridge

- Add `rawLiquidFrontend` using virtual `.nz.liquid` delegation.
- AST-rewrite local variable reads to props.
- Preserve Shopify globals.
- Run in `loose` mode by default.

### Phase 5: workshop integration

- Add dev-server/workshop selection by extension.
- Add story file format.
- Compile, emit, render in iframe.
- Surface diagnostics and inferred controls.

### Phase 6: direct raw Liquid IR

- Replace virtual `.nz.liquid` bridge with direct `ArtifactIR` emission when stable.
- Keep bridge as fallback if useful for migration diagnostics.

## Risks

- **IR too Nazare-specific.** Mitigation: move parser-specific assumptions out of IR gradually.
- **Raw Liquid inference overpromises.** Mitigation: warnings + capability flags + loose mode.
- **Emit depends on `NazareAst`.** Mitigation: audit and move required facts into shared model.
- **Frontend selection ambiguity.** Mitigation: explicit frontend override and deterministic order.
- **Breaking public API.** Mitigation: keep wrappers and existing tests green through Phase 1.

## Non-goals for first pass

- No registry payload changes.
- No Browse/compiler coupling.
- No raw Liquid authoritative publishing contract.
- No support for every language upfront.
- No compiler UI responsibilities.
