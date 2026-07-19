# Compiler frontend refactor plan

## Goal

Make compiler inputs modular so Nazare can support multiple source languages while keeping one shared semantic pipeline for graphing, checks, validation, and emission.

The immediate driver is a Liquid Storybook-like development workflow:

- `.nz.liquid` components continue using the strict existing compiler path.
- Raw Shopify `.liquid` snippets/sections can be parsed best-effort for preview, migration, and control generation.
- Future source languages can be added as explicit frontends if they can map into the Nazare artifact model.

## Current architecture

The compiler currently has one hardcoded input path:

```text
compileNazareArtifact()
→ parseNazareLiquid()
→ syntaxFromAst()
→ bindArtifactIR()
→ check/validate
→ emitTheme()
```

This is simple and strict, but it makes `.nz.liquid` the only first-class compiler input.

## Target architecture

Introduce a frontend layer before the shared compiler pipeline:

```text
source language
→ compiler frontend
→ ArtifactIR + contracts + diagnostics
→ shared checks/validation/graph
→ shared emit
```

A frontend is a translator from a source language into Nazare semantic facts. It should not be arbitrary compile magic; it must express:

- component kind
- props/settings/blocks contract
- template/render body
- imports/dependencies
- assets
- emitted Shopify artifact target
- diagnostics/notes with confidence where inference is weak

## Public types sketch

```ts
export type CompileInput = {
  source: string;
  file: string;
  readFile?: ReadFile;
  strictness?: CompilerMode;
};

export type FrontendCapabilities = {
  explicitProps: boolean;
  explicitSchema: boolean;
  imports: boolean;
  behavior: boolean;
};

export type FrontendResult = {
  ir: ArtifactIR;
  contract: ArtifactContract;
  contracts: ArtifactContract[];
  capabilities: FrontendCapabilities;
  issues: Diagnostic[];
  notes: Diagnostic[];
  sourceForEmit?: string;
};

export type CompilerFrontend = {
  name: string;
  accepts(file: string, source: string): boolean;
  compile(input: CompileInput): FrontendResult;
};
```

Generic API:

```ts
export function compileArtifact(
  input: CompileInput & { frontends?: CompilerFrontend[] },
): CompileResult;
```

Selection order:

1. explicit frontend, if provided
2. first `accepts()` match
3. diagnostic: unsupported input type

Compatibility API remains:

```ts
compileNazareArtifact(source, file, options)
buildNazareTheme(source, file, options)
```

These become wrappers around the Nazare frontend.

## First frontend: existing Nazare Liquid

Wrap the current path as a frontend:

```text
.nz.liquid
→ nazareLiquidFrontend
→ existing parse/resolve/syntax/bind/project path
```

This should be a mechanical refactor with no semantic changes.

## Raw Liquid support

Raw Shopify Liquid should be explicit and best-effort.

Recommended module split:

```text
packages/liquid-contract       raw Liquid parser + inferred contract
packages/compiler              shared compiler pipeline + Nazare frontend
packages/frontend-liquid       raw .liquid frontend (can start internal)
packages/dev-server            story/workshop runtime
```

Initial implementation can keep the raw Liquid frontend inside `packages/compiler/src/frontends/raw-liquid.ts` until the boundary stabilizes.

### Contract inference

Raw Liquid parser extracts an assistive contract from Shopify Liquid/HTML AST:

- variable reads: `{{ product.title }}`, `{{ section.settings.heading }}`
- snippet renders: `{% render 'price', product: product %}`
- settings and blocks from `{% schema %}`
- asset references
- translation keys
- Shopify globals
- dynamic/ambiguous access warnings

Example shape:

```ts
export type RawLiquidContract = {
  kind: "snippet" | "section" | "template" | "unknown";
  inputs: Array<{
    name: string;
    source: "local" | "section.settings" | "block.settings" | "global";
    type: "string" | "number" | "boolean" | "object" | "array" | "unknown";
    required: boolean | "unknown";
  }>;
  renders: Array<{ name: string; args: Record<string, string>; dynamic: boolean }>;
  settings: Array<{ name: string; type: string; label?: string }>;
  assets: string[];
  translations: string[];
  globals: string[];
  warnings: string[];
};
```

Use a real Shopify-aware Liquid parser rather than regex. Candidate: `@shopify/liquid-html-parser`.

### Phase 1 raw Liquid frontend

Use an adapter that builds a virtual `.nz.liquid` source, then delegates to the Nazare frontend:

```text
raw .liquid
→ inferLiquidContract()
→ adaptRawLiquidToNazareSource()
→ nazareLiquidFrontend.compile()
```

This proves the Storybook workflow quickly while preserving the existing compiler core.

Example:

```liquid
<button>{{ label }}</button>
```

becomes virtual Nazare source:

```liquid
{% props label: string %}

<button>{{ props.label }}</button>
```

The adapter should use an AST transform for identifier rewriting; regex is too fragile.

### Phase 2 raw Liquid frontend

Once the model is stable, emit `ArtifactIR` directly:

```text
raw .liquid AST
→ ArtifactIR
→ shared checks/graph/emit
```

This removes the virtual-source bridge and makes raw Liquid a true first-class frontend.

## Check gating

Not all frontends provide the same confidence level. Checks should be gated by capabilities and compiler mode:

- strict package-authoring checks stay enabled for `.nz.liquid`
- inferred raw Liquid contracts use migration/preview checks
- ambiguous raw Liquid produces warnings/notes, not false hard errors

This prevents best-effort inference from weakening the strict Nazare authoring path.

## Emit boundary

Long-term, emit should consume shared compiler facts rather than Nazare parser-specific AST details:

```text
ArtifactIR + contracts + sourceForEmit
→ emitTheme()
```

If emitter needs parser-specific information, that information should move into `ArtifactIR` or a typed frontend output field.

## Workshop pipeline

A Storybook-like dev tool should sit above the compiler:

```text
story file
+ component source
→ choose frontend by extension
→ compileArtifact()
→ emitTheme()
→ Liquid renderer with mock Shopify context
→ iframe preview
```

The workshop owns:

- story files
- controls
- mock data
- hot reload
- preview iframe

Compiler owns:

- parsing/frontend translation
- semantic facts
- diagnostics
- emission

## Registry and Browse boundary

Registry Browse is separate from compiler frontends.

- Browse reads registry metadata and code payloads.
- Browse does not compile components unless adding preview functionality.
- Story/workshop preview uses compiler and dev-server runtime.

## Migration plan

1. Add `CompilerFrontend`, `CompileInput`, `FrontendResult`, and capability types.
2. Wrap current `.nz.liquid` path as `nazareLiquidFrontend`.
3. Add `compileArtifact()` generic API.
4. Keep `compileNazareArtifact()` and `buildNazareTheme()` as compatibility wrappers.
5. Add `packages/liquid-contract` for raw Shopify Liquid contract inference.
6. Add raw Liquid frontend using virtual `.nz.liquid` delegation.
7. Add workshop/dev-server flow that selects frontend by file extension.
8. Move raw Liquid frontend from virtual source to direct `ArtifactIR` when stable.

## Non-goals for first pass

- Do not change registry payload format.
- Do not make Browse depend on compiler.
- Do not weaken strict `.nz.liquid` checks.
- Do not require raw Liquid inference to be authoritative.
