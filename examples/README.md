# Examples

Working artifacts that exercise Nazare end to end and double as reference.

## `theme/` — a real Nazare theme workspace

A complete source workspace that compiles to a standard Shopify theme. Source
lives under `src/` (components installed from the example registry below, plus
its own `layout/`, `templates/`, `config/`, and `locales/`); build paths are set
explicitly in `nazare.theme.json` (`build.sourceRoot` = `src`, `build.outDir` =
`theme`).

```sh
cd examples/theme
nazare build            # → theme/ (a full Shopify theme)
shopify theme dev --path theme
```

Build output (`theme/`) and reconciliation baselines
(`nazare.schema-lock.json`, `nazare.locales-base.json`) are gitignored — the repo
keeps only source. The end-to-end build is covered by
`packages/theme/tests/example-theme.test.mjs`, which builds a temp copy so the
committed workspace stays clean.

## `registry/` — a `file:` example registry

The curated catalog (`registry/components/`) published into the on-disk registry
format (`<scope>/<name>/<version>.json`). It's what `theme/` installs from, and a
runnable demo of a serverless registry:

```sh
nazare registry add local file:examples/registry
nazare registry use local
nazare add @nazare/announcement-bar
```

Regenerate it by re-publishing the catalog:

```sh
for name in cn link notice price disclosure counter notice-board announcement-bar; do
  NAZARE_REGISTRY=file:examples/registry nazare publish registry/components/$name
done
```

## Compiler fixtures

Small, single-feature components used by the compiler tests live in
`packages/compiler/tests/fixtures/` (`valid/` must compile clean; `invalid/`
must error). Add a file to either folder to extend coverage — no test wiring
needed. See `packages/compiler/tests/fixtures.test.mjs`.
