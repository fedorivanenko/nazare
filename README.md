# Nazare

A typed, dependency-aware, single-file component system for Shopify themes.
Components own their markup, typed props, behavior, styles, schema, and
dependencies in one place, and compile to plain Liquid, scoped CSS, and
island JS (`nazare build`).

## Core principle

Every valid Shopify theme should be at least partially readable by Nazare without rewrite.

## The rules

Every restriction below buys a compile-time guarantee. The compiler enforces
all of them with a diagnostic that says what to do instead.

**Props**
- Markup reads `{{ props.x }}`; the compiler lowers each read to its
  declared provenance — `section.settings.x` for `.setting()` props, the
  bare render-argument name otherwise.
- Section components receive no render arguments, so every section prop must
  be a `.setting()` (otherwise it would render silently blank).
- A setting-prop argument you leave unfilled at a render site hoists into
  the consuming section's schema. Filling the argument is the opt-out.
- The same import alias rendered twice with unfilled setting-props is an
  error — import the package again under a second alias to give each
  instance its own settings.
- Types are strict: a plain string is not a `url`, `color`, `richtext`, or
  `handle`. Widen explicitly with `.or(string)` when you mean it.

**Refs and data**
- `ref="name"` values must be static, unique identifiers; dynamic values are
  ignored with a warning.
- Deleting or renaming a ref'd element that a script still reads is a
  compile error; declared-but-unread refs warn.
- The typed data channel is `data-*` attributes on ref'd elements whose
  value is a single `{{ props.x }}` output; scripts read
  `data.<ref>.<property>` (kebab-case maps to camelCase). Primitives only.

**Behavior scripts**
- The entry point is `export default island(({ root, refs, data }) => …)`.
  Islands attach behavior to server-rendered HTML; they do not render or
  hydrate, and props do not reach JS — data crosses in the markup.
- Multiple behaviors per component are fine; declaration order is mount
  order.
- Relative imports (`./utils.ts` inside the component directory) and
  function packages (`import { cn } from "@nazare/cn"` — manifest kind
  `"function"`) are bundled into the emitted asset, and types flow across
  them. Function packages must be self-contained (no relative files of
  their own). Other bare imports fail at build. Don't shadow `refs`/`data`
  with local variables — the scanner does not scope-analyze.

**Files**
- `{% import X from "@pkg/name" %}` declares a package dependency;
  `{% import "./file.ts|.js|.css" %}` declares a sidecar, which must live
  inside the component's directory.
- `{% stylesheet %}` blocks are extracted and scoped under the component
  (this is stricter than vanilla Shopify); `{% style %}` passes through
  untouched. Scoping expects a single top-level root element — the first one
  is stamped, and multiple roots warn.
- Liquid control flow is preserved but not modeled: render-site
  reachability is approximate, and hoisting ignores branches.

## Repository layout

```txt
apps/
  registry-api/          Vercel-hosted package registry API

packages/
  cli-client/            `nazare` package manager / publisher / installer
  cli-dev/               `nazare-dev` local component dev + Shopify CLI glue
  compiler/              Nazare Liquid import/render compiler
  core/                  schemas, validators, package ID parsing, integrity helpers

examples/
  components/            demo component package sources
  themes/                demo Shopify themes
```
