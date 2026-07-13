# Nazare

Components for Shopify themes, authored as local source files.

Nazare compiles `.nz.liquid` components into theme files. Registry support is optional and copy-based: `nazare add` copies component source into your project; builds never talk to a registry.

## Install the CLI

From this repo during development:

```sh
pnpm install
pnpm -s tsc -b
pnpm --filter @nazare/cli-client link --global
```

Then verify:

```sh
nazare help
```

Unlink:

```sh
pnpm --filter @nazare/cli-client unlink --global
```

## CLI

```sh
nazare build                         # compile nazare/ into .nazare-out/theme
nazare add @scope/name               # copy component + deps from registry
nazare update [@scope/name]          # re-fetch latest source
nazare pack ./nazare/button          # write registry JSON to .nazare-out/pack
nazare publish ./nazare/button       # publish component to registry
```

## Set up a local registry

A registry can be a folder. No server, no auth.

```sh
export NAZARE_REGISTRY=file:.nazare-registry
```

Publish into it:

```sh
nazare publish ./nazare/button
```

Install from it:

```sh
nazare add @scope/button
```

The folder layout is:

```text
.nazare-registry/<scope>/<name>/<version>.json
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
