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

**Kind**
- A file declares what it becomes with `{% component section %}` or
  `{% component block %}`; no tag (or `{% component snippet %}`) means a
  snippet. Kind is stated in the source, never in a sidecar — it decides the
  output directory, provenance, and schema, and it travels on the contract,
  so importing and `{% render %}`-ing a section or block is a compile error
  (the theme editor places those; you don't render them). At most one
  `{% component %}` per file.

**Props**
- Markup reads `{{ props.x }}`; the compiler lowers each read to its
  declared provenance — `section.settings.x` for `.setting()` props, the
  bare render-argument name otherwise.
- Section and block components receive no render arguments, so every prop
  must be a `.setting()` (otherwise it would render silently blank).
- Blocks (`kind: "block"`) compile to theme blocks with their own schema
  and a default preset; a section offers the slot with
  `{% blocks "notice" %}` (theme-block type names; bare `{% blocks %}`
  accepts any theme block). One slot per section; blocks cannot nest in v1.
- A setting-prop argument you leave unfilled at a render site hoists into
  the consuming section's schema. Filling the argument is the opt-out.
- The same import alias rendered twice with unfilled setting-props is an
  error — import the file again under a second alias to give each
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
- A behavior imported by name mounts on the component root by default, or on
  a chosen subtree when an element carries `island="<name>"` — then `root`
  and `refs` are scoped to that element. `island` must name an imported
  behavior, and a behavior can be placed at most once (refs are
  component-global in v1).
- Relative imports (`./utils.ts`, `../cn/cn.ts` — anywhere inside the
  project) are bundled into the emitted asset, and types flow across them.
  Bare imports (`import { x } from "pkg"`) fail at build: Nazare has no
  packages at build time — installing a component copies its source into
  the project. Don't shadow `refs`/`data` with local variables — the
  scanner does not scope-analyze.

**Files**
- Every import binds a name to a relative path:
  `{% import Link from "../link/link.nz.liquid" %}` (component —
  capitalized), `{% import counter from "./counter.ts" %}` (behavior) and
  `{% import styles from "./counter.css" %}` (style) — lowercase. Wrong
  case, bare specifiers, side-effect imports, and paths escaping the
  project root are all errors.
- Importing a component compiles that file on the spot to derive its
  props contract — there is no registry lookup at compile time.
- Styles are css modules, opt-in by binding: `{% stylesheet styles %}` and
  `{% import styles from "./x.css" %}` expose the sheet's classes as a map.
  `{{ styles.wrapper }}` (or `{{ styles["hero-image"] }}`) lowers at compile
  time to `nz-<component>__<class>`, and the sheet's selectors are rewritten
  to match — scoping is the class rewrite, no wrapper attribute involved.
  Referencing an undefined class is an error; a defined class the markup
  never reads warns. A bare `{% stylesheet %}` (and `{% style %}`) passes
  through untouched, exactly as vanilla Shopify.
- `data-nz-component` on the root element exists only to mount islands;
  components with a script expect a single top-level root — the first one
  is stamped, and multiple roots warn.
- Liquid control flow is preserved but not modeled: render-site
  reachability is approximate, and hoisting ignores branches.
- Plain Shopify sections are checked too: files with an authored
  `{% schema %}` get every `section.settings.x` / `block.settings.x` read
  validated against the declared setting ids — no Nazare syntax required.

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
