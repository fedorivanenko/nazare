# Roadmap

## Engineering phases

- **Phase 0 — Prerequisites & quick fixes**
  - Emit explicit `defer` scripts instead of Shopify `script_tag`.
  - Audit issues #42-#46: regex block extraction, `emitOnError` default, overlap diagnostic, `url`/`string` assignability, dependency-check caching.
  - Add TextMate grammar + VS Code extension shell for highlighting only.

- **Phase 1 — Runtime: hydration + load strategy**
  - Add island load strategies: `load`, `idle`, `visible`, `interaction`.
  - Emit preload hints based on strategy.
  - Support re-hydration with island registry, `MutationObserver`, `shopify:section:*` events, teardown disposers, and `data-nz-src` code-on-demand.
  - Optionally inline tiny runtime in `theme.liquid` `<head>`.

- **Phase 2 — CSS/JS output**
  - Consolidate component CSS into Shopify `{% stylesheet %}` blocks.
  - Add opt-in post-emit minification with `cssnano` and `terser`.

- **Phase 3 — Shared analysis host**
  - Build VFS overlay on the `ReadFile` seam.
  - Add reverse-dependency index, contract cache, contract-diff invalidation, and positional index.
  - Add diagnostic phases: `lint`, `store-schema`, `render`.
  - Emit source maps back to `.nz.liquid`.

- **Phase 4 — Dev server**
  - Add `nazare dev`: watcher, incremental rebuild, dev-mode baseline handling, and `shopify theme dev` feed.
  - Run Theme Check on emitted output in `dev` and `build --check`.

- **Phase 5 — LSP**
  - Reuse Phase 3 host for diagnostics.
  - Add hover, go-to-definition, document symbols.
  - Add completion, signature help, code actions, and inlay hints.
  - Add find-references, then rename.

- **Phase 6 — Shopify-hosted data checks**
  - Add `nazare pull-schema` snapshots.
  - Scan metafields/global settings and report store-schema diagnostics.
  - Add live dev-theme render checks with golden HTML for CI/pre-release.

## Parallel product tracks

- **Track R — Registry into shadcn-like catalog**
  - **R0** Stand up `registry.nazare.engineering` and publish curated catalog.
  - **R1** Add `GET /components` index/search and `listComponents()`.
  - **R2** Add rich metadata: `description`, `category`, `type`, `preview`, `docs`.
  - **R3** Add theming foundation item type and token stylesheet.
  - **R4** Build curated `@nazare/*` component library with docs and AJAX examples.
  - **R5** Add provenance/content-digest lock.
  - **R6** Add composed blocks and governance/contribution flow.

- **Track O — OSS & website**
  - **O1** Finish OSS basics: `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`.
  - **O2** Build landing/docs site with Astro/Starlight.
  - **O3** Build in-browser compiler playground.
  - **O4** Publish CLI to npm with Changesets.
  - **O5** Build registry browser after R1.
  - **O6** Add issue/PR templates, Discussions, showcase, starter theme.

## Dependency notes

- Phase 4 and Phase 5 require Phase 3.
- Source maps improve Theme Check attribution and LSP diagnostics.
- Reverse-dep index powers incremental dev builds and cross-file rename.
- Phase 1 strategy-aware mount is reused by re-hydration.
- Phases 0, 1, and 2 can proceed in parallel with Phase 3.
- Playground shares the pure compiler + `ReadFile` seam with LSP.
- Registry browser needs R1.
- Curated AJAX components exercise Phase 1 hydration.
