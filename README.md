# 🌊 Nazare

Ship Shopify faster and easier

Nazare is a toolset that lets Shopify developers maintaining long-lived themes cut the time and breakage cost of each change

> **Project status:** Nazare is pre-release, with stability declared per feature by `nazare features`. Stable machine contracts follow their documented compatibility policies; experimental and internal surfaces may change without migration support. Cache formats and generated theme output are not public compatibility contracts. Theme publication requires `--enable-experimental theme-publication`; keep source control and backups enabled, and test generated themes with Theme Check and Shopify CLI before using them on a live storefront.

## Installation

The installer requires Node.js 20 or newer. It selects the release artifact for the current OS and architecture and verifies its SHA-256 checksum. Release artifacts include production dependencies; pnpm, Python, node-gyp, and compiler tools are not required.

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/scripts/install.sh | sh
```

For parser-only installation:

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/scripts/install-source.sh | sh
nazare-source analyze sections/header.liquid
```

## Theme intelligence

Theme intelligence builds a semantic graph of a whole Shopify theme. It connects Liquid renders, templates, sections, assets, CSS selectors, JavaScript behavior, metafields, and other cross-file relationships so developers can see how the theme fits together before changing it.

Use it to inspect the whole graph, find a file's dependencies and dependents, identify affected storefront pages, or trace where a metafield is read. Results distinguish proven relationships from uncertainty caused by dynamic Liquid or JavaScript instead of presenting incomplete analysis as fact.

```sh
# Inspect the whole theme as JSON, readable text, or Graphviz DOT
nazare inspect theme [dir] --format json|text|dot

# Show one file's dependencies, dependents, usage, and affected pages
nazare inspect impact <theme-relative-file> [dir] --format text|json

# Find a metafield's definition, readers, and affected pages
nazare inspect metafield <owner.namespace.key> [dir] --format text|json

# Serve graph queries to editor and agent integrations over JSONL stdio
nazare graph-server [dir] --enable-experimental graph-server
```

`dir` defaults to `build.sourceRoot` in `nazare.theme.json`. Theme intelligence analyzes Nazare Liquid, plain Liquid, Shopify JSON, CSS, and JavaScript.

Theme, impact, and metafield JSON outputs are stable, independently versioned machine contracts. Their committed schemas, golden examples, and compatibility policy live in [`packages/cli-client/contracts`](packages/cli-client/contracts). Text and DOT rendering remain human-facing and may change presentation without a contract-version bump.

## Feature stability gateway

Every public CLI surface declares a feature ID in one code-owned registry. Stable features run automatically. Experimental features require explicit flags and are rejected before protected side effects. Internal features never appear through the public CLI.

```sh
# Discover stability, effects, consent policy, and tracking issues
nazare features
nazare features --json

# Enable a read-only experimental feature for one invocation
nazare graph-server . --enable-experimental graph-server

# Low-level AST/IR/compiler projections are debugging interfaces
nazare inspect ir component.nz.liquid --enable-experimental compiler-inspection

# Watch uses a separate experimental revision-event protocol
nazare inspect theme . --watch --enable-experimental inspection-watch

# Publication always requires per-invocation CLI consent
nazare build --enable-experimental theme-publication
```

`NAZARE_EXPERIMENTAL_FEATURES` can enable read-only experimental features for development and CI. It cannot grant per-invocation publication consent. `--experimental-publish` remains an alias for `--enable-experimental theme-publication`.

Feature definitions are static and versioned with Nazare; remote flags cannot change compiler behavior. Adding or removing a feature updates the central registry, while command declarations and side-effect permits are checked by TypeScript and tests.

## Other stable features

- **Nazare Liquid compiler:** Compiles `.nz.liquid` components with explicit props, imports, settings, CSS modules, and JavaScript islands into standard Shopify Liquid and assets.
- **Plain Liquid support:** Parses, validates, analyzes, and carries existing Shopify `.liquid` files into generated themes, enabling incremental adoption.
- **Theme build system:** Builds an explicit source root into a standard Shopify theme directory and aborts atomically when compilation fails.

  Initialize and build a theme:

  ```sh
  nazare init
  nazare build --enable-experimental theme-publication
  shopify theme dev --path theme
  ```

- **Merchant-data reconciliation:** Preserves settings, templates, section groups, and storefront locale changes across builds; schema locks and migrations help manage intentional changes.
- **Component registry:** Installs versioned components as editable source rather than runtime dependencies. Supports hosted, self-hosted, and local-file registries.

  Connect a component registry and install editable component source:

  ```sh
  nazare registry connect main https://registry.nazare.engineering
  nazare registry use main
  nazare add @nazare/button
  ```

- **Source analysis CLI:** Emits versioned JSON parser facts for Shopify Liquid and Nazare Liquid, with fail-closed behavior for invalid syntax.
- **Component previews:** Scaffolds, builds, and checks story-based component workbenches for Nazare and plain Liquid components.
- **Build extensions:** Runs trusted local extensions after successful compilation to emit additional Shopify theme files.
- **Framework-agnostic JavaScript islands:** Loads component behavior only where rendered and can host vanilla JavaScript or any framework.

## Architecture

Nazare computes typed products on demand:

```text
revisioned project inputs
→ ProjectSession
→ ComputationGraph
→ target-neutral source products
→ Shopify semantic/query/build products
→ owned output plan
→ revision-guarded atomic publication
```

Build, inspect, and preview share revisioned source products but request different projections. `build --watch`, `check --watch`, experimental `inspect theme --watch`, and Preview serve publish only current revision `result` or `update-failed` events; superseded work is aborted. Dependency reads automatically create invalidation edges. Pure computations may be cached; filesystem publication and other side effects are never cached.

Stable semantic identity uses project-relative `ProjectFileId` values. Dynamic references and opaque runtime behavior remain explicit uncertainty rather than guessed dependencies.

### Package direction

```text
@nazare/core
├─ @nazare/source
└─ @nazare/compiler
   ├─ @nazare/target-shopify
   └─ @nazare/preview
```

`@nazare/compiler` exposes intentional modules:

```text
@nazare/compiler/compile
@nazare/compiler/computation
@nazare/compiler/extensions
@nazare/compiler/output
@nazare/compiler/portable
@nazare/compiler/project
@nazare/compiler/source-products
```

The compiler cannot import targets, Preview, or CLI packages. Architecture tests enforce this direction. Compiler root exposes direct compile APIs only; architecture consumers use intentional submodules.

## Development

```sh
pnpm install
pnpm build
biome check .
node --test packages/compiler/tests/*.test.mjs
node --test packages/target-shopify/tests/*.test.mjs
node --test packages/preview/tests/*.test.mjs
```

Detailed refactor architecture and remaining work live in:

- [`notes/optimized-refactor.ts`](notes/optimized-refactor.ts)
- [`notes/optimized-refactor-plan.md`](notes/optimized-refactor-plan.md)
