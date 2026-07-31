# @nazare/core

`@nazare/core` is the shared data model for Nazare. It contains no compiler logic and no runtime behavior. Its job is to define the stable, serializable shapes that other packages exchange: syntax nodes, IR, symbols, contracts, graphs, diagnostics, and Shopify schema output.

Use this package when you need to consume compiler output, store artifacts, render diagnostics, inspect graphs, or build tools around Nazare without importing compiler internals.

## Architecture role

```txt
             ┌────────────────────┐
source file  │ @nazare/compiler   │
────────────▶│ parses/checks/emits│
             └─────────┬──────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ @nazare/core       │
             │ shared contracts   │
             └─────────┬──────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
      CLI          registry        tests/tools
```

`core` deliberately avoids behavior. That keeps compiler output easy to serialize, snapshot, diff, send over APIs, and validate in tools.

## Data model

```txt
syntax
  Literal authored facts from one source file:
  component kind, imports, props, render sites, refs, scripts, styles.
  Nodes keep source spans for diagnostics and editor integrations.

IR
  Bound compiler facts:
  symbols, aliases, prop bindings, render targets, setting projections.
  The IR is still flat and serializable.

graph
  Query/visualization projection of the IR:
  nodes + typed edges. It adds no new semantic facts; it can be rebuilt.

contract
  Public boundary of a component:
  component kind, prop requirements, prop types, hoisted settings.
  Used to validate render sites across files.

diagnostic
  User-facing or compiler-invariant message:
  severity, code, optional phase, optional node/edge/span.

theme schema
  TypeScript shape for generated Shopify `{% schema %}` JSON.
```

## Main exports

### Syntax

- `ArtifactSyntaxNode`
- `FileSyntaxNode`
- `ComponentSyntaxNode`
- `ImportSyntaxNode`
- `PropDeclarationSyntaxNode`
- `RenderSiteSyntaxNode`
- `ReferenceSyntaxNode`
- `ScriptSyntaxNode`
- `StyleSyntaxNode`

### IR / symbols / contracts

- `ArtifactIR`
- `ArtifactResolution`
- `ArtifactSymbol`
- `ArtifactContract`
- `ComponentKind`

### Graph

- `ArtifactGraph`
- `ArtifactGraphNode`
- `ArtifactGraphEdge`

### Diagnostics

- `Diagnostic`
- `DiagnosticSeverity`
- `DiagnosticPhase`
- `SourceSpan`

### Semantics and schema

- `SemanticType`
- `PropTypeInfo`
- `ThemeSchema`
- `ThemeSchemaSetting`

## Minimal usage

```ts
import type { ArtifactIR, Diagnostic } from "@nazare/core";

export function hasErrors(issues: Diagnostic[]): boolean {
	return issues.some((issue) => issue.severity === "error");
}

export function renderSummary(ir: ArtifactIR): string {
	const renderSites = ir.syntax.filter((node) => node.kind === "render-site");
	return `${renderSites.length} render sites`;
}
```

## Design rules

- IDs are opaque strings. Do not parse IDs for data; navigate nodes/resolutions instead.
- Compiler phases may add `Diagnostic.phase` (`parse`, `resolve`, `check`, `validate`, `emit`) so consumers can group messages.
- Types in this package should stay serializable and behavior-free.
- New compiler concepts should be added here only when they are part of public/shared output.
