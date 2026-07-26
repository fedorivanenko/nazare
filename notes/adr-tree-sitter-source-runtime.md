# ADR: Tree-sitter source runtime and Liquid grammar

Status: accepted for isolated Phase 0/1 source layer; not accepted for production cutover

## Decision

Use native `tree-sitter@0.21.1` for Node and a pinned, vendored copy of
`hankthetank27/tree-sitter-liquid` at
`e45dbac8c5fa95b1f0e00e7e0c04bc8855823391` (2025-05-23) in
`packages/tree-sitter-liquid`. `packages/tree-sitter-nazare-liquid` explicitly
extends that grammar and generates a separate `nazare_liquid` language.

The grammar is MIT licensed. Its `LICENSE` is retained. Nazare adds
`src/scanner.c` to `binding.gyp`; upstream's Node binding omitted its external
scanner and otherwise failed at load time with:

```text
symbol not found in flat namespace '_tree_sitter_liquid_external_scanner_create'
```

`@nazare/source` is isolated from compiler frontend selection. Its explicit
language IDs load separate Liquid and Nazare Liquid grammars. Nazare CST nodes
cover component, import, props, blocks, render, script, and bound stylesheet
syntax. Unknown tags remain `custom_unpaired_statement`; malformed payloads
produce explicit error nodes rather than invented facts.

## Why this runtime

- Node binding exposes `Tree.edit`, old-tree parsing, changed ranges, queries,
  missing/error nodes, and retained trees.
- The native runtime has low startup complexity for the CLI and future LSP
  process.
- Generated grammar C is pinned in-repository. Install does not depend on a
  mutable Git branch or an unpublished npm package.
- Node 24.13.0 builds successfully from source on macOS x64. CI must test every
  supported Node/OS/architecture before production selection.

The package currently requires a native compiler because no Nazare-owned
prebuilds are published. Production npm distribution must either publish N-API
prebuilds for supported targets or ship a WASM runtime. This is a cutover gate,
not deferred packaging trivia.

## Browser and VS Code

CLI/LSP: native `tree-sitter` in a Node process. VS Code extension should run
analysis in its Node extension host or language server and load the same pinned
grammar artifact.

Playground/browser: use `web-tree-sitter` plus a WASM build generated from the
same vendored grammar source. Do not bundle the native addon into browser code.
The source API intentionally keeps conversion, issues, regions, and lifecycle
runtime-neutral, but a WASM registry implementation is not part of this spike.

## Offset ownership

Tree-sitter's C and WASM APIs use UTF-8 bytes, but `node-tree-sitter@0.21.1`
converts JavaScript string node indices and point columns to UTF-16 code units.
Nazare source ranges are also JavaScript UTF-16; line/column positions are
one-based UTF-16. `SourceOffsetIndex` is the only runtime conversion owner. It
provides explicit native-tree and byte/WASM conversions, records code-point and
line boundaries once per source, and rejects offsets that split a surrogate pair
or UTF-8 sequence. Tests lock this runtime behavior so a binding upgrade cannot
silently corrupt edits. CRLF creates a new line at LF, matching existing Nazare
spans.

## Embedded languages

Node Tree-sitter does not automatically execute Neovim-style injection queries.
`@nazare/source` therefore exposes explicit script/style body boundaries.
Explicit `lang="ts"` selects TypeScript; `lang="js"` and omitted `lang` select
JavaScript. Closing tags inside strings, comments, regex literals, and template
literals are ignored by the boundary scanner. JavaScript/TypeScript/CSS semantic
parsing remains outside this source layer.

The dedicated Nazare grammar uses external scanner tokens for raw script and
stylesheet bodies. Closing tags inside strings, comments, regex literals, and
template literals remain embedded content instead of terminating parent nodes.
Phase 2 plain-Liquid adapter derives dependencies, settings reads, schema,
blocks, conditionals, local bindings, reads, guards, render arguments, asset and
locale references, and LiquidDoc parameters directly from CST. Corpus and
focused differential tests compare every family with `@nazare/scan`.

Phase 3 source adapter now exposes Nazare component/import/props/render/blocks,
script/stylesheet, prop/style reference, HTML ref/data/island/root facts. HTML
facts use `tree-sitter-html` over masked Liquid template regions, preserving
original UTF-16 offsets while preventing embedded syntax from becoming HTML.
Committed Nazare corpus files and focused legacy-parser comparisons pass.
Phase 4 has an explicit `sourceFrontend: "legacy" | "tree-sitter"` compiler
boundary. It defaults to `"legacy"`. Plain Liquid can opt into the Tree-sitter
bridge, which owns dependency/settings facts while the Shopify parser
temporarily remains the schema/compatibility oracle.

Nazare opt-in now projects CST facts through the existing `NazareAst` boundary;
the Shopify parser temporarily supplies only its opaque LiquidHTML tree,
authored schema/settings, compatibility diagnostics, and unsupported-syntax
notes. Corpus gates compare complete Nazare nodes, syntax, IR, graph,
diagnostics, notes, and emission. Invalid CSTs fail closed without partial
facts. Workspace selection, removal of the compatibility parse, malformed-source
parity, packaging, and performance remain cutover gates.

## Rejected alternatives

### Shopify/tree-sitter-liquid

Archived at commit `bbf1a82cce8b87810a9537bbe63f91eb9957d384` and no longer
maintained. The maintained fork includes newer LiquidDoc and injection work.

### Unpublished `tree-sitter-liquid` npm package

The old npm name was unpublished in 2021. Depending on an unversioned Git
checkout would make installs and npm packaging less reproducible than vendoring
generated grammar sources.

### `web-tree-sitter` as the only runtime

Portable and appropriate for browser use, but asynchronous WASM initialization
and artifact lookup add CLI/LSP startup and packaging cost. Keep it as browser
implementation, then compare measured startup before reconsidering one-runtime
packaging.

### Extending `@nazare/scan`

Rejected by assignment architecture. Scanner remains a differential oracle only
until Tree-sitter adapter parity permits deletion.

## Measurement

Run after `pnpm build`:

```sh
node packages/source/scripts/benchmark.mjs \
  $(find fixtures/theme-corpus -type f -name '*.liquid')
```

Harness reports cold wall time, one append edit per retained file, input bytes,
and retained heap delta.

Local smoke measurement on Node 24.13.0/macOS x64, 21 corpus files and 5,554
bytes: 46.37 ms cold, 13.89 ms total for 21 incremental append edits (0.66 ms
per file), and 1,029,368 bytes heap delta while retaining trees. This includes
JavaScript objects and is not isolated native-tree memory. Record CI and every
release target before production frontend selection; local development numbers
are not an accepted budget.

## Deletion gate

Do not remove `@nazare/scan`, Shopify parser paths, or existing raw block
extraction based on this ADR. Deletion requires dedicated Nazare grammar,
syntax-adapter parity, compiler switch comparisons, corpus replay, distribution
tests, and accepted performance numbers listed in
`notes/tree-sitter-frontend-handoff.md`.
