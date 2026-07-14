# Examples

A self-contained walk through the whole Nazare loop — **author → publish →
install → build** — plus the compiler fixtures.

```
sources/  ──publish──▶  registry/  ──nazare add──▶  theme/  ──nazare build──▶  theme/theme
```

## `sources/` — publishable component source

The component source you publish into a registry. Each folder is one publishable
unit with a `nazare.json` and its files:

- `counter/` — a section with settings, a JS island (`counter.ts` + `format.ts`),
  and a scoped stylesheet.
- `cn/` — a tiny function `counter` depends on.

## `registry/` — a `file:` registry

`sources/` published into the on-disk registry format
(`<scope>/<name>/<version>.json`). It's what `theme/` installs from, and a
runnable demo of a serverless registry:

```sh
nazare registry add local file:examples/registry
nazare registry use local
nazare add @nazare/counter        # pulls its @nazare/cn dependency too
```

Regenerate it from the sources:

```sh
for name in cn counter; do
  NAZARE_REGISTRY=file:examples/registry nazare publish examples/sources/$name
done
```

## `theme/` — a minimal Nazare theme workspace

A small but complete workspace showcasing one component (`@nazare/counter`),
installed under `src/components/` alongside its own `src/layout/`,
`src/templates/`, `src/config/`, and `src/locales/`. Build paths are explicit in
`nazare.theme.json` (`build.sourceRoot` = `src`, `build.outDir` = `theme`).

Both the **source** (`src/`) and the **built theme** (`theme/`) are committed, so
you can read input and generated Shopify output side by side without building.
Rebuild in place — it reconciles cleanly against the committed output (the
ownership manifest travels with it):

```sh
cd examples/theme
nazare build            # → theme/ (a full Shopify theme)
shopify theme dev --path theme
```

Only the per-build reconciliation baselines (`nazare.schema-lock.json`,
`nazare.locales-base.json`) are gitignored. The end-to-end build is also covered
by `packages/theme/tests/example-theme.test.mjs`, which builds a temp copy.

## Compiler fixtures

Small, single-feature components used by the compiler tests live in
`packages/compiler/tests/fixtures/` (`valid/` must compile clean; `invalid/`
must error). Add a file to either folder to extend coverage — no test wiring
needed. See `packages/compiler/tests/fixtures.test.mjs`.
