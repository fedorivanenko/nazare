# Contributing to Nazare

By participating, you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

Requires Node.js 20+ and pnpm 10.

```sh
pnpm install
pnpm build
pnpm test
pnpm lint
```

## Conventions

- Keep theme intelligence analysis-only.
- Preserve exact source evidence and explicit uncertainty for semantic claims.
- Do not guess dynamic references.
- Keep registry wire contracts in `@nazare/registry`.
- Do not commit `dist/` or native build output.
- Add focused tests for behavior changes.

For security reports, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
