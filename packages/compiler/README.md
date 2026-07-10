# @nazare/compiler

Compiles Nazare Liquid components (`*.nz.liquid`) into a typed artifact IR,
a queryable graph, and a package contract. Entry point:
`compileNazareArtifact` / `compileNazareArtifactWithResolver` (async, pulls
imported packages' contracts through a `ContractResolver`).

## Pipeline

```
source ── parse ── syntax ── bind ── check ─┐
                              │             ├── issues
                              └── graph ── validate ─┘
```

Each pass lives in its own module and returns data plus diagnostics; nothing
mutates a previous pass's output.

**parse** (`parser.ts`) — wraps `@shopify/liquid-html-parser` and lifts the
Nazare tags (`import`, `props`, `render`) and `{{ output }}` expressions into
`NazareNode`s. Everything else stays in the underlying LiquidHTML AST
untouched — per the repo's core principle, unknown Liquid is preserved, not
rejected. Prop type expressions are parsed by `type-expression.ts`, a small
recursive-descent parser over the `string.setting({...})` DSL.

**syntax** (`syntax.ts`) — lowers the AST into flat `ArtifactSyntaxNode`s
(file, component, props-interface, prop-declaration, render-site,
prop-argument, expression, import) with stable IDs. All ID formats are owned
by `ids.ts`; IDs are opaque everywhere else — construct, never parse.

**bind** (`symbols.ts`) — produces the IR: symbols (components, aliases,
props, settings) and resolutions (import targets, render targets, prop
bindings, setting projections). Binding records facts only; it emits no
diagnostics. A prop binding is created whenever an argument names a contract
prop, even if the types disagree.

**check** (`check.ts`) — judges the IR against loaded `ArtifactContract`s:
missing required props, unknown arguments, type mismatches, unresolved
contracts. All constraint diagnostics originate here.

**graph** (`graph.ts`) — projects the IR into an `ArtifactGraph` of
syntax/symbol nodes and typed edges. Edge IDs derive from edge content, so
they are stable across emission order.

**validate** (`validate.ts`) — structural invariants over IR and graph
(exactly one render target per site, bindings point at contract props, edges
reference existing nodes). These guard the compiler against itself; user
errors belong to check.

Every diagnostic the compiler can emit is declared in `diagnostics.ts`.

## Tests

`tests/golden.test.mjs` compiles each `examples/components/*` and compares
against `tests/__snapshots__/`; regenerate with `UPDATE_SNAPSHOTS=1 pnpm
test`. `check.test.mjs` and `type-expression.test.mjs` cover the failure
paths the examples don't exercise.
