# 🌊 Nazare

> **Project status:** Nazare is in heavy active development. APIs, file formats, compiler behavior, registry behavior, and generated output may change. Do not treat it as blindly production-ready yet; test generated themes with Theme Check and Shopify CLI before using them on a live storefront.

Shopify themes become difficult to maintain because the relationships between their parts are mostly implicit. As themes grow, developers spend more time tracing dependencies, checking parameters, duplicating patterns, testing manually, and avoiding unintended breakage.

The ecosystem offers many excellent tools, but each addresses only part of the problem:

- Dawn provides a strong starting point, but large customizations eventually inherit the same maintenance challenges as any other theme.

- Theme Check validates Shopify theme conventions; Inspect adds the missing whole-theme relationship graph and change-impact queries.

- Shopify CLI improves local development and deployment, but it doesn't change how themes are structured or how developers reason about them.

- Liquid snippets and sections encourage reuse, yet their interfaces remain implicit, making dependencies difficult to discover and changes difficult to evaluate safely.

- Component libraries and starter themes reduce the effort of starting a project, but once installed they become another codebase that must be understood, modified, and maintained.

- Hydrogen solves many of these challenges by replacing the Shopify theme architecture with a React application and modern frontend tooling. This is a powerful option, but it requires adopting a different storefront architecture, hosting model, and technology stack, making it unsuitable for teams that want to continue building native Shopify themes

**Introducing Nazare.**

**Nazare** is shadcn/ui for Shopify with a TypeScript-inspired upgrade for Liquid. It helps developers build native Shopify themes that are easier to understand, compose, and maintain, while remaining fully compatible with Shopify.

## Quickstart

Install the CLI first. The installer requires Node.js and `pnpm` (or Corepack, which can activate `pnpm`) and downloads the latest GitHub release artifact:

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/scripts/install.sh | sh
```

Scaffold a project. `nazare init` prompts for the source and output directories
(defaults `src` and `theme`) and writes them into `nazare.theme.json`:

```sh
nazare init
```

Choose and save a registry, then add components:

```sh
nazare registry add main https://registry.nazare.engineering
nazare registry use main

nazare add @nazare/button
nazare add @nazare/hero
```

The selected registry is stored in project-level `nazare.theme.json`, which also
holds the explicit build paths:

```json
{
  "build": { "sourceRoot": "nazare", "outDir": "/theme" }
}
```

Build a Shopify-compatible theme output:

```sh
nazare build
```

Run it with Shopify CLI:

```sh
shopify theme dev --path /theme
```

Nazare is designed for incremental adoption: start with existing Shopify Liquid files, add `.nz.liquid` components where stronger contracts help, then build everything into one normal Shopify theme.

Nazare has three main parts:

## 1. Compiler

Write Shopify components with explicit props, imports, and reusable composition and forget about prop drilling.

The compiler introduces the `.nz.liquid` file format — a TypeScript-inspired superset of Liquid. Like TypeScript compiles to JavaScript, `.nz.liquid` compiles to standard Liquid, adding stronger contracts, better diagnostics, and a modern authoring experience without changing the Shopify runtime.

Example input:

```liquid
{# components/button.nz.liquid #}
{% props {
  href: url.required(),
  label: string.required(),
  variant: string.enum("primary", "secondary").default("primary"),
} %}

<a class="button button--{{ props.variant }}" href="{{ props.href }}">
  {{ props.label }}
</a>
```

```css
/* components/hero.css */
.root {
  display: grid;
  min-height: 70vh;
  place-items: center;
}

.content {
  max-width: 56rem;
}
```

```ts
// components/hero.ts
export default island(({ root, refs }) => {
  refs.cta?.addEventListener("click", () => {
    root.dispatchEvent(new CustomEvent("nazare:hero-cta"));
  });
});
```

```liquid
{# components/hero.nz.liquid #}
{% component section %}
{% import Button from "./button.nz.liquid" %}
{% import styles from "./hero.css" %}
{% import hero from "./hero.ts" %}

{% props {
  heading: string.setting({ label: "Heading", default: "New arrivals" }),
  body: richtext.setting({ label: "Body" }),
  cta_url: url.setting({ label: "Button link" }),
  cta_label: string.setting({ label: "Button label", default: "Shop now" }),
} %}

<section nz-root island="hero" class="{{ styles.root }}">
  <div class="{{ styles.content }}">
    <h1>{{ props.heading }}</h1>
    {{ props.body }}

    <div ref="cta">
      {% render Button {
        href: props.cta_url,
        label: props.cta_label,
        variant: "primary",
      } %}
    </div>
  </div>
</section>
```

Example output:

```liquid
{# snippets/button.liquid #}
<a class="button button--{{ variant | default: "primary" }}" href="{{ href }}">
  {{ label }}
</a>
```

```liquid
{# sections/hero.liquid #}
{{ "hero.css" | asset_url | stylesheet_tag }}
<script src="{{ "nazare-runtime.js" | asset_url }}" defer></script>
<script src="{{ "hero.js" | asset_url }}" defer></script>

<section data-nz-island="hero" class="hero_root__a1b2c">
  <div class="hero_content__a1b2c">
    <h1>{{ section.settings.heading }}</h1>
    {{ section.settings.body }}

    <div data-nz-ref="cta">
      {% render "button",
        href: section.settings.cta_url,
        label: section.settings.cta_label,
        variant: "primary"
      %}
    </div>
  </div>
</section>

{% schema %}
{
  "name": "Hero",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "New arrivals" },
    { "type": "richtext", "id": "body", "label": "Body" },
    { "type": "url", "id": "cta_url", "label": "Button link" },
    { "type": "text", "id": "cta_label", "label": "Button label", "default": "Shop now" }
  ],
  "presets": [{ "name": "Hero" }]
}
{% endschema %}
```

```css
/* assets/hero.css */
.hero_root__a1b2c {
  display: grid;
  min-height: 70vh;
  place-items: center;
}

.hero_content__a1b2c {
  max-width: 56rem;
}
```

```js
// assets/hero.js
Nazare.registerIsland("hero", ({ root, refs }) => {
  refs.cta?.addEventListener("click", () => {
    root.dispatchEvent(new CustomEvent("nazare:hero-cta"));
  });
});
```

Because `Hero` imports `Button`, `styles`, and `hero`, the compiler knows the exact component, CSS module, and JavaScript island contracts. Missing `href`, unknown props, invalid `variant` values, unknown `styles.*` classes, invalid `ref` reads, and wrong section setting types are reported before Shopify sees the theme.

Nazare can also work with plain Liquid. Existing `.liquid` snippets, sections, blocks, layouts, and templates can stay valid Shopify files while Nazare parses and validates them, checks schema and Liquid structure, reports diagnostics, tracks dependencies, and emits them into the final theme alongside `.nz.liquid` components.

Internally, the compiler uses an explicit frontend boundary. The built-in frontend accepts `.nz.liquid` and lowers it into shared compiler facts; future frontends can target the same syntax/IR model without bypassing shared graph, check, validate, and contract projection. Unsupported inputs return diagnostics rather than fabricated contracts.

Example diagnostic:

```liquid
{% render Button {
  href: props.cta_url,
  label: props.cta_label,
  variant: "ghost",
} %}
```

`Button` only accepts `"primary"` or `"secondary"`, so Nazare reports the invalid `variant` before the theme is pushed to Shopify.

Useful compiler commands:

```sh
nazare validate nazare/components/hero.nz.liquid
nazare schema nazare/components/hero.nz.liquid
nazare graph nazare/components/hero.nz.liquid
nazare dump nazare/components/hero.nz.liquid
```

## 2. Registry

Build from reusable components instead of starting from scratch.

The Registry brings the shadcn/ui model to Shopify. Components are distributed as editable source code that becomes part of your project, giving you complete ownership with no runtime dependencies. The registry is fully open source and can be self-hosted.

Example usage:

```sh
# save and select a registry for this project
nazare registry add main https://registry.nazare.engineering
nazare registry use main
nazare registry list

# copy component source into your project
nazare add @acme/button
nazare add @acme/hero
```

This writes project registry settings to `nazare.theme.json`:

```json
{
  "registry": "main",
  "registries": {
    "main": "https://registry.nazare.engineering"
  },
  "installed": {
    "@acme/button": "1.0.0"
  }
}
```

A registry component is source, not a package dependency. Installing a component writes editable files into your workspace, for example:

```txt
components/button.nz.liquid
components/button.css
components/button.ts
components/hero.nz.liquid
```

Publish your own component:

```json
// components/button/nazare.json
{
  "id": "@acme/button",
  "version": "1.0.0",
  "entry": "button.nz.liquid",
  "files": ["button.nz.liquid", "button.css", "button.ts"],
  "dependencies": {}
}
```

```sh
nazare registry add company https://registry.your-website.com
nazare registry use company
export NAZARE_TOKEN=your-publish-token

nazare pack ./components/button
nazare publish ./components/button
```

Update installed components:

```sh
nazare update @acme/button
nazare update
```

You can also run a registry from a local folder, with no server:

```sh
nazare registry add local file:.nazare-registry
nazare registry use local

nazare publish ./components/button
nazare add @acme/button
```

Spin up your own HTTP registry:

```sh
# 1. create Postgres database and export its URL
export DATABASE_URL=postgres://user:password@localhost:5432/nazare_registry

# 2. install, build, and migrate
pnpm install
pnpm -s tsc -b
psql "$DATABASE_URL" -f apps/registry-api/migrations/001_components.sql

# 3. start registry server
NAZARE_TOKENS="dev-token" pnpm --filter @nazare/registry-api start
```

Then point the CLI at it:

```sh
nazare registry add local-http http://localhost:3000
nazare registry use local-http
export NAZARE_TOKEN=dev-token

nazare publish ./components/button
nazare add @acme/button
```

For production, deploy `apps/registry-api` to any Node host or Vercel, set `DATABASE_URL` and `NAZARE_TOKENS`, run the migration, then save the deployed URL with `nazare registry add`.

Registry operational model:

- installs copy source into your repo;
- project registry settings and installed versions live in `nazare.theme.json`;
- reads are public for HTTP registries;
- publishing requires `NAZARE_TOKEN`;
- `NAZARE_REGISTRY` can override project registry selection for one command;
- versions are immutable, so changing files requires bumping `nazare.json.version`.

## 3. Build System

Separate your source files from the deployed theme

The Build System separates your development workspace from the final Shopify theme. Think of it as a monorepo-style workspace for Shopify themes: source files can be organized however your team prefers, while the build output is assembled into the standard Shopify theme structure expected by Shopify.

Example source workspace:

```txt
src/
  components/
    button.nz.liquid
    hero.nz.liquid
    hero.css
    hero.ts
  layout/
    theme.liquid
  templates/
    index.json
  config/
    settings_schema.json
  locales/
    en.default.json
```

Build paths are explicit — set them once in `nazare.theme.json` (there is no
hardcoded default output or source directory):

```json
{
  "build": { "sourceRoot": "nazare", "outDir": ".nazare-out/theme" }
}
```

Optional secondary-output extensions live under `nazare.extensions/` and are
listed in the same JSON config:

```json
{
  "build": { "sourceRoot": "nazare", "outDir": ".nazare-out/theme" },
  "extensions": [
    {
      "module": "./nazare.extensions/manifest.mjs",
      "options": { "format": "json" }
    }
  ]
}
```

An extension default-exports `{ name, emit }`; `emit` runs once per successful
theme build, after every component compiles without errors, and returns
additional Shopify theme files.
Extensions are trusted local code: they run in Node with the same permissions as
the build process, so only enable extensions from code you trust. Each entry in
`components` is a serializable view of one compiled component —
`{ file, source, schema?, ir, contract, importedContracts, canEmit }` — facts only, no parser AST:

```js
export default {
  name: "manifest",
  emit({ components, options }) {
    return {
      files: [
        {
          path: "assets/nazare-components.json",
          contents: JSON.stringify({ options, components: components.map((component) => component.file) })
        }
      ],
      issues: []
    };
  }
};
```

For a whole-repo view — dependency graphs, dead-component checks, a site map —
merge the per-component IRs into one graph. Cross-file edges (a component's
imports and render targets) connect only after the merge:

```js
import { artifactGraphFromIR, mergeArtifactIR } from "@nazare/compiler";

export default {
  name: "component-graph",
  emit({ components }) {
    const graph = artifactGraphFromIR(mergeArtifactIR(components.map((c) => c.ir)));
    const imports = graph.edges.filter((edge) => edge.kind === "imports");
    return {
      files: [
        {
          path: "assets/nazare-graph.json",
          contents: JSON.stringify({
            nodes: graph.nodes.length,
            imports: imports.map((edge) => ({ from: edge.from, to: edge.to }))
          })
        }
      ],
      issues: []
    };
  }
};
```

The merged graph is derived facts, not judgments: an import whose target never
compiled stays a dangling node, and cycles are allowed. If any component has an
error, the theme build aborts before extensions run.

Build it:

```sh
# reads build.sourceRoot / build.outDir from nazare.theme.json
nazare build

# or pass them explicitly (a flag/arg overrides the config)
nazare build storefront --out-dir theme

# use loose mode while migrating existing themes
nazare build --strictness loose
```

Example output:

```txt
theme/
  assets/
    hero.css
    hero.js
    nazare-runtime.js
  config/
    settings_schema.json
  layout/
    theme.liquid
  locales/
    en.default.json
  sections/
    hero.liquid
  snippets/
    button.liquid
  templates/
    index.json
```

What the build does:

- compiles every `.nz.liquid` component into Shopify `sections/`, `blocks/`, `snippets/`, and `assets/`;
- aborts atomically on errors before writing output, running extensions, cleaning stale files, or updating schema/locale/migration metadata;
- carries plain Shopify code files from `layout/`, `templates/*.liquid`, `sections/`, `snippets/`, and `assets/` straight through;
- reconciles merchant-owned state — settings, section and block instances, and translations — instead of overwriting it (see [Reconciliation](#reconciliation) below);
- validates plain `.liquid` files and JSON files;
- resolves local imports so CSS, JavaScript islands, and component dependencies land in the final theme;
- reports conflicts when two source files try to write the same Shopify output path.

Use the generated `.nazare-out/theme` directory with existing Shopify tooling, or choose your own output directory with `--out-dir`:

```sh
shopify theme dev --path .nazare-out/theme
shopify theme push --path .nazare-out/theme

nazare build --out-dir theme
shopify theme dev --path theme
```

### Reconciliation

Nazare source compiles one way, but a live Shopify theme is edited from both sides: merchants change settings, add and reorder sections and blocks, and translate content in the admin, and Shopify writes all of that back into the theme. A naive rebuild would overwrite those edits. Nazare instead treats the theme filesystem as three ownership zones and reconciles each on every build:

- **Code** — `sections/`, `blocks/`, `snippets/`, `assets/`: regenerated from source.
- **Merchant data** — `config/settings_data.json`, `templates/**/*.json`, and section-group `sections/*.json`: carried forward from the existing target. Your source versions are only *seeds*, used when a theme has no value yet; once a theme exists, its live data wins.
- **Storefront locales** — `locales/*.json` (excluding developer-owned `*.schema.json`): merged field by field, so a translation a merchant edited and one a developer updated each win where the other side is untouched.

To reconcile against a real live theme, pull its merchant-owned data first (requires the Shopify CLI):

```sh
nazare build --pull --store your-store.myshopify.com --theme 123456789
shopify theme push --path .nazare-out/theme
```

**Schema drift.** Each build fingerprints every generated section and block schema into `nazare.schema-lock.json` and diffs it against the committed baseline. Removing or retyping a setting, or removing a section or block — the changes that strand saved merchant values — surface as warnings:

```txt
⚠ setting "heading" removed from "hero" — saved merchant values are orphaned
```

**Migrations.** When a rename is intentional, describe it in `nazare.migrations.json`. Each op rewrites the saved merchant data so values survive the rename, and silences the corresponding drift warning:

```json
{
  "migrations": [
    { "id": "2026-07-rename-hero", "op": "renameSection", "from": "hero", "to": "banner" },
    { "id": "2026-07-rename-heading", "op": "renameSetting", "section": "banner", "from": "heading", "to": "title" }
  ]
}
```

Each migration runs exactly once per target theme (tracked in `nazare.migrations-applied.json`), so a later setting that reuses a retired name is never clobbered by a stale rename.

Commit the reconciliation baselines — `nazare.schema-lock.json`, `nazare.migrations.json`, `nazare.migrations-applied.json`, and `nazare.locales-base.json` — so your whole team and CI reconcile against the same history.

`nazare build` prints a summary of what it reconciled; pass `--json` for the machine-readable result:

```txt
Built 1 component → 2 files in .nazare-out/theme
  data: 3 preserved, 0 seeded  ·  migrations applied: 2026-07-rename-hero  ·  locales: 1 file merged
Build OK
```

Also, Nazare includes JS island architecture, supports any JavaScript framework you want, can check and validate plain Liquid, compile and minimize CSS and JS, and many more.

## CLI reference

```txt
nazare init                         scaffold build config in nazare.theme.json
nazare build [source-root|file]     build a complete Shopify theme output
nazare build --pull                 reconcile against a live theme before building
nazare add <@scope/name>            install a registry component and dependencies
nazare update [@scope/name]         update one component, or all installed components
nazare registry add <name> <url>    save a project registry in `nazare.theme.json`
nazare registry use <name>          select a saved project registry
nazare registry list                list saved registries
nazare pack [dir]                   create a publishable registry payload
nazare publish [dir]                publish a component folder
nazare validate <file>              check one `.nz.liquid` file
nazare schema <file>                print generated Shopify schema
nazare graph <file>                 print component dependency graph
nazare ast <file>                   print parsed AST
nazare ir <file>                    print compiler IR
nazare artifact <file>              print full compiler artifact
nazare dump <file>                  write debug JSON files into `.nazare-out`
```

Common options and environment variables:

```txt
--strictness loose|strict           default strict; loose helps migration
--version x.y.z                     add/update exact registry version
--source-root <dir>                 add/update/build source root (else `nazare.theme.json` build.sourceRoot)
--out-dir <dir>                     build output directory (else `nazare.theme.json` build.outDir)
--pull                              build: fetch live theme data before building
--store <domain>                    build --pull: Shopify store to pull from
--theme <id|name>                   build --pull: theme to pull from
--json                              build: print the raw result as JSON
NAZARE_REGISTRY                     one-command registry override, or `file:<dir>`
NAZARE_TOKEN                        publish token
```

## JavaScript islands

Nazare does not require React, Vue, Svelte, or any other framework. A component can import a small TypeScript or JavaScript island, and that island mounts only where the component is rendered. If you want a framework, mount it inside the island.

```ts
export default island(({ root }) => {
  // mount vanilla JavaScript, React, Vue, Svelte, or anything else here
});
```

## Known gaps

Nazare reconciles merchant-editable state and exposes cross-component impact, but it does not replace Shopify validation. Keep Shopify CLI and Theme Check in your workflow before pushing.

- **Shopify schema-rule validation.** Generated `{% schema %}` is checked as JSON and for Nazare contracts, but not against Shopify's editor and upload limits (max settings and blocks per section, block-type character rules, preset shape, section-group compatibility). An over-large or malformed schema fails at push time, not at build.
- **Liquid dialect validation.** Emitted Liquid targets a known Shopify subset through span-based lowering, but there is no post-codegen dialect validator and no Theme Check or `shopify theme push --dry-run` hook in the build. Run Theme Check yourself before pushing.
- **Registry integrity lock.** Installed components are pinned by version and local file hashes in `nazare.theme.json`, but there is no registry provenance/content-digest lock for the originally fetched package. This does not make a malicious first install safe; it would mainly detect later registry drift for the same `id@version`.
- **Migration coverage.** Migrations handle section, setting, and block renames and removals. Block-scoped setting renames and value type-conversion are not supported, and the schema-lock and locale-base baselines assume you build immediately before pushing.
- **Internal modularity.** Several compiler internals are still large files (`parser`, diagnostics, checks, emit). Public boundaries are stable, but more splitting is planned to keep concerns easier to audit.
- **Release packaging.** The source repository does not commit generated `dist/` files. GitHub releases package built CLI artifacts for the curl installer.

## Repository layout

```txt
packages/core          shared data model, diagnostics, contracts, schema types
packages/compiler      frontend-based compile pipeline, `.nz.liquid` parser, checker, emitter, runtime output
packages/theme         source-root walker and Shopify theme builder
packages/registry      file and HTTP registry clients
packages/cli-client    `nazare` CLI
apps/registry-api      self-hostable HTTP registry server
```

## License

[MIT](LICENSE) — every part of Nazare. Registry components are distributed as
source you own and edit, with no runtime dependency on Nazare.
