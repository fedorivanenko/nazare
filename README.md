# Nazare

Components for Shopify themes, authored as local source files.

Nazare compiles `.nz.liquid` components into theme files. Registry support is optional and copy-based: `nazare add` copies component source into your project; builds never talk to a registry.

## Shape

```text
author component source
  nazare/<name>/nazare.json
  nazare/<name>/<entry>.nz.liquid | <entry>.ts
        │
        ├─ nazare build
        │    local source -> .nazare-out/theme
        │    registry is not involved
        │
        ├─ nazare pack
        │    local source -> .nazare-out/pack/<scope>/<name>/<version>.json
        │
        └─ nazare publish
             local source -> registry

consume component source
  registry -> nazare add @scope/name -> nazare/<name>/...
           -> nazare build -> .nazare-out/theme
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

### 1. Build local components

Put source under `nazare/`:

```text
nazare/button/nazare.json
nazare/button/button.nz.liquid
```

Build:

```sh
nazare build
```

Output goes to:

```text
.nazare-out/theme
```

### 2. Use a local registry while developing

A registry can be a folder. No server, no auth.

```sh
export NAZARE_REGISTRY=file:.nazare-registry
```

Publish a component into it:

```sh
nazare publish ./nazare/button
```

Install it into another project:

```sh
nazare add @scope/button
```

Local registry layout:

```text
.nazare-registry/<scope>/<name>/<version>.json
```

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

```sh
nazare build                         # compile nazare/ into .nazare-out/theme
nazare add @scope/name               # copy component + deps from registry
nazare update [@scope/name]          # re-fetch latest source
nazare pack ./nazare/button          # write registry JSON to .nazare-out/pack
nazare publish ./nazare/button       # publish component to registry
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
- `packages/compiler` — parser, checks, IR, emit
- `packages/cli-client` — `nazare` CLI
- `packages/registry` — registry clients: HTTP and `file:`
- `apps/registry-api` — self-hostable HTTP registry server

## Development

```sh
pnpm install
pnpm -s test:all
```
