# 🌊 Nazare

Ship Shopify faster and easier

Nazare is a toolset that lets Shopify developers maintaining long-lived themes cut the time and breakage cost of each change

> **Project status:** Nazare is in heavy active development. APIs, file formats, compiler behavior, registry behavior, and generated output may change. Do not treat it as blindly production-ready yet; test generated themes with Theme Check and Shopify CLI before using them on a live storefront.

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
nazare graph-server [dir]
```

`dir` defaults to `build.sourceRoot` in `nazare.theme.json`. Theme intelligence analyzes Nazare Liquid, plain Liquid, Shopify JSON, CSS, and JavaScript.


## Other stable features

- **Nazare Liquid compiler:** Compiles `.nz.liquid` components with explicit props, imports, settings, CSS modules, and JavaScript islands into standard Shopify Liquid and assets.
- **Plain Liquid support:** Parses, validates, analyzes, and carries existing Shopify `.liquid` files into generated themes, enabling incremental adoption.
- **Theme build system:** Builds an explicit source root into a standard Shopify theme directory and aborts atomically when compilation fails.

  Initialize and build a theme:

  ```sh
  nazare init
  nazare build
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
