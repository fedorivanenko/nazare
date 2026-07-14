# Contributing to Nazare

Thanks for your interest. Nazare is in heavy active development — APIs, file formats, and generated output may still change. Contributions, issues, and discussion are welcome.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- Node.js (recent LTS)
- pnpm 10 (`corepack enable`, then pnpm is activated automatically — the repo pins `packageManager`)

## Setup

```sh
pnpm install
pnpm -s build      # tsc -b across the workspace
```

## Build, test, lint

```sh
pnpm -s build          # typecheck + build all packages
pnpm -s test:all       # every test suite (Node's test runner)
pnpm lint              # biome check
pnpm format            # biome format --write
```

Scoped test scripts exist for faster loops — see `package.json` (`test:compiler`, `test:emit`, `test:registry`, `test:server`, …).

## Project conventions

These keep the codebase auditable; please match them:

- **Pass pipeline.** The compiler runs a fixed sequence (parse → resolve → bind → graph → check → validate → emit). Each pass has one responsibility, stated in its file header. Bind records *facts*; check makes *judgments*; validate guards the compiler against itself. Don't blur these.
- **`@nazare/core` is types-only.** Shared vocabulary, no runtime logic.
- **IDs are opaque.** Construct them in `ids.ts`; never parse data back out.
- **No committed `dist/`.** Build artifacts are produced in CI / at release time.
- **Registry concerns stay out of the compiler.** Resolution and catalog policy live in the CLI / registry layer.

See `docs/` for design notes and the roadmap.

## Pull requests

1. Branch from `main`.
2. Keep changes focused; add or update tests (`pnpm -s test:all` must pass).
3. Run `pnpm lint` and `pnpm -s build`.
4. Use clear commit messages ([Conventional Commits](https://www.conventionalcommits.org/) preferred).
5. Fill out the PR template.

## Reporting bugs / requesting features

Use the issue templates. For security problems, do **not** open a public issue — see [SECURITY.md](SECURITY.md).
