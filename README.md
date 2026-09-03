# Nazare

Focused workspace for Shopify theme intelligence and source-component distribution.

## Projects

- [`@nazare/theme-intelligence`](packages/theme-intelligence): analysis-only semantic compiler for Liquid, Shopify JSON, CSS/SCSS, and JavaScript. Emits evidence-backed relationships, coverage, and explicit uncertainty. It never builds or mutates themes.
- [`@nazare/registry`](packages/registry): registry wire contracts plus HTTP and filesystem clients.
- [`@nazare/registry-api`](apps/registry-api): self-hostable Postgres-backed registry service.

The registry API is an application supporting `@nazare/registry`; no other product surface remains in this repository.

## Development

Requires Node.js 20+ and pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

Scoped commands:

```sh
pnpm test:theme-intelligence
pnpm test:registry
```

## Principles

- Theme intelligence is analysis-only.
- Every semantic claim preserves source evidence and epistemic status.
- Dynamic references remain unresolved or runtime-dependent; they are never guessed.
- Registry publication is immutable by component ID and version.
- Build artifacts are not committed.

MIT licensed.
