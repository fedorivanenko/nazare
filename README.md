# Nazare

Liquid-first tooling for Shopify themes.

Nazare is two things in one ecosystem:

1. **shadcn/ui for Shopify** — a registry workflow for copying component source into your theme project. You install source, own it, edit it, and build it locally.
2. **A TS-ish upgrade for Liquid** — `.nz.liquid` adds type-safety, composability, diagnostics, safer imports, and less boilerplate.

Both parts work with normal Liquid files. `.nz.liquid` is optional: use plain `.liquid` when you want, upgrade to `.nz.liquid` when you want stronger checks and better authoring.

The theme builder and registry are independent products that share conventions. The registry copies source; it does not compile. The theme builder builds local source; it does not need a registry.

## Shape

```text
Nazare ecosystem

  theme builder product
    local Shopify theme source
      layout/ templates/ sections/ snippets/ assets/ config/ locales/
      -> nazare build
      -> .nazare-out/theme

    calls compiler for .nz.liquid files
    copies plain .liquid, .json, and assets
    no registry involved

  registry product
    local Liquid / .nz.liquid source
      -> nazare pack
      -> registry JSON

    local Liquid / .nz.liquid source
      -> nazare publish
      -> file: registry or HTTP registry

    registry
      -> nazare add @scope/name
      -> local source files copied into nazare/<name>/...

    no compile step involved
```

Typical source folder:

```text
nazare/layout/theme.liquid
nazare/templates/product.json
nazare/sections/main-product.nz.liquid
nazare/snippets/price.liquid
nazare/assets/theme.css
nazare/config/settings_schema.json
nazare/locales/en.default.json
```

Registry choices:

```text
file:.nazare-registry          local dev/team registry, no server
https://registry.example.com   self-hosted HTTP registry
```

## Install the CLI

Curl install from GitHub:

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/scripts/install.sh | sh
```

Install another branch/ref:

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/scripts/install.sh | NAZARE_REF=my-branch sh
```

From this repo during development:

```sh
pnpm install
pnpm -s tsc -b
pnpm --filter @nazare/cli-client link --global
```

Verify:

```sh
nazare help
```

Unlink:

```sh
pnpm --filter @nazare/cli-client unlink --global
```

## Daily workflow

### 1. Build local theme source

Put Shopify theme source under `nazare/`:

```text
nazare/layout/theme.liquid
nazare/templates/product.json
nazare/sections/main-product.nz.liquid
nazare/snippets/price.liquid
nazare/assets/theme.css
```

Build:

```sh
nazare build
```

Output goes to:

```text
.nazare-out/theme
```

This is theme-builder workflow. It reads local files only. Plain Shopify files are copied; `.nz.liquid` files are compiled.

### 2. Use a local registry while developing

A registry can be a folder. No server, no auth.

```sh
export NAZARE_REGISTRY=file:.nazare-registry
```

Publish source into it:

```sh
nazare publish ./nazare/button
```

Install source into another project:

```sh
nazare add @scope/button
```

Local registry layout:

```text
.nazare-registry/<scope>/<name>/<version>.json
```

This is registry workflow. It copies source files only.

### 3. Inspect before publishing

```sh
nazare pack ./nazare/button
```

Output:

```text
.nazare-out/pack/<scope>/<name>/<version>.json
```

That folder is also a valid `file:` registry.

### 4. Publish to an HTTP registry

```sh
export NAZARE_REGISTRY=https://registry.example.com
export NAZARE_TOKEN=long-random-token
nazare publish ./nazare/button
```

Versions are immutable. To publish new bytes, bump `version` in `nazare.json`.

## CLI reference

Compiler commands:

```sh
nazare build                         # build nazare/ into .nazare-out/theme
nazare validate <file>               # check one file
nazare artifact <file>               # print compiled artifact JSON
nazare ast <file>
nazare ir <file>
nazare graph <file>
nazare schema <file>
nazare dump <file>
```

Registry commands:

```sh
nazare add @scope/name               # copy component + deps from registry
nazare update [@scope/name]          # re-fetch latest source
nazare pack ./nazare/button          # write registry JSON to .nazare-out/pack
nazare publish ./nazare/button       # publish source to registry
```

## Set up an HTTP registry

Use the self-hostable server in `apps/registry-api`.

Required env:

```sh
DATABASE_URL=postgres://...
NAZARE_TOKENS=long-random-token
```

Run migration:

```sh
psql "$DATABASE_URL" -f apps/registry-api/migrations/001_components.sql
```

Run locally:

```sh
pnpm -s tsc -b
PORT=3000 pnpm --filter @nazare/registry-api start
```

Use it:

```sh
export NAZARE_REGISTRY=http://localhost:3000
export NAZARE_TOKEN=long-random-token
nazare publish ./nazare/button
nazare add @scope/button
```

Deploy notes:

- Vercel: set project root to `apps/registry-api`, set `DATABASE_URL` + `NAZARE_TOKENS`, run migration once, deploy.
- Any Node host: build with `pnpm -s tsc -b`, run `node apps/registry-api/dist/index.js` behind HTTPS.

More registry docs:

- [`packages/registry`](./packages/registry/README.md)
- [`apps/registry-api`](./apps/registry-api/README.md)

## Packages

- `packages/core` — shared types and compiler data model
- `packages/compiler` — parser, checks, IR, emit for `.nz.liquid`
- `packages/theme` — Shopify theme builder: copy plain files, compile `.nz.liquid`
- `packages/cli-client` — `nazare` CLI
- `packages/registry` — registry clients: HTTP and `file:`
- `apps/registry-api` — self-hostable HTTP registry server

## Development

```sh
pnpm install
pnpm -s test:all
```
