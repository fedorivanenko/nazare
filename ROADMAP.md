# Roadmap

## Product map

User-facing capabilities. Status reflects product availability, not internal implementation progress.

```text
Nazare
│
├── Build
│   ├── Types / built
│   │   ├── .nz.liquid
│   │   ├── Typed props
│   │   ├── Explicit imports
│   │   ├── Composition
│   │   └── Liquid output
│   │
│   ├── Workspace / planned
│   │   ├── Multiple themes in one repository
│   │   ├── Shared packages
│   │   └── Theme-specific outputs
│   │
│   ├── Assets / planned
│   │   ├── CSS processing
│   │   ├── JavaScript processing
│   │   └── Asset transformations
│   │
│   ├── Extensions / built
│   │   └── Custom .mjs secondary outputs
│   │
│   ├── Plugin API / planned
│   │   ├── CSS hooks
│   │   ├── JavaScript hooks
│   │   └── Asset hooks
│   │
│   ├── Editor Tooling / planned
│   │   ├── Diagnostics
│   │   ├── Autocomplete
│   │   └── Theme Check integration
│   │
│   ├── Dev / planned
│   │   ├── Watch workspace and shared packages
│   │   ├── Run build incrementally
│   │   ├── Surface diagnostics
│   │   └── Integrate with Shopify CLI preview
│   │
│   └── Validate / planned
│       ├── Check templates
│       ├── Check component usage
│       └── Validate against storefront data
│
├── Registry
│   ├── Components / built
│   │   ├── Liquid
│   │   ├── .nz.liquid
│   │   ├── CSS
│   │   ├── JavaScript
│   │   └── Assets
│   │
│   ├── Private Registries / built
│   │   ├── Internal design systems
│   │   ├── Agency component libraries
│   │   └── Store-specific components
│   │
│   └── Browser / planned
│       ├── Browse components
│       ├── Preview states
│       ├── Test with mocked Shopify data
│       └── Read installation documentation
│
├── Runtime / partial
│   ├── Basic island runtime / built
│   ├── Runtime asset emission / built
│   ├── Load strategies / planned
│   ├── Rehydration + Shopify section events / planned
│   └── Framework adapters / planned
│
└── Inspect / partial
    ├── AST, IR, schema, artifact, and graph output / built
    ├── Theme structure / planned
    ├── Dependency graph / planned
    ├── Component and schema inventory / planned
    ├── Duplication and dead-code analysis / planned
    │
    ├── Migrate / planned
    │   ├── Consume Inspect output
    │   ├── Create a Nazare workspace
    │   └── Introduce Build and Types incrementally
    │
    ├── Intent / planned
    │   ├── Theme dependency graph
    │   ├── Storefront data model
    │   └── Explicit context for AI agents
    │
    └── Bridge / planned
        ├── Connect your own backend
        ├── A/B tests and feature rollouts
        └── Personalization and remote configuration
```

## Engineering phases

- **Phase 0 — Prerequisites & quick fixes**
  - Product: Build > Types, Build > Editor Tooling, Runtime > Runtime asset emission.
  - Emit explicit `defer` scripts instead of Shopify `script_tag`.
  - Audit issues #42-#46: regex block extraction, `emitOnError` default, overlap diagnostic, `url`/`string` assignability, dependency-check caching.
  - Add TextMate grammar + VS Code extension shell for highlighting only.

- **Phase 1 — Runtime: hydration + load strategy**
  - Product: Runtime > Load strategies, Runtime > Rehydration + Shopify section events, Runtime > Framework adapters.
  - Add island load strategies: `load`, `idle`, `visible`, `interaction`.
  - Emit preload hints based on strategy.
  - Support re-hydration with island registry, `MutationObserver`, `shopify:section:*` events, teardown disposers, and `data-nz-src` code-on-demand.
  - Support `data-nazare-use`-style module mounting for migration parity.
  - Support gradual global-JS-to-island migration: third-party globals, custom elements, and explicit `init()` / `destroy()` adapters.
  - Optionally inline tiny runtime in `theme.liquid` `<head>`.

- **Phase 2 — CSS/JS output**
  - Product: Build > Assets, Build > Plugin API, Runtime > Runtime asset emission.
  - Consolidate component CSS into Shopify `{% stylesheet %}` blocks.
  - Add optional built-in Tailwind mode as a global asset build step.
  - Make Tailwind mode scan Liquid, generated sources, arbitrary variants, and `@source inline()` escapes safely.
  - Add SCSS/global asset compatibility for legacy themes: `main`/`preload` entrypoints, stable preload ordering, and CSS minification without Gulp.
  - Add JS code splitting, deterministic chunk maps, and modulepreload snippet/tag generation.
  - Add public asset copy plus manifest-based generated asset cleanup/ownership.
  - Add opt-in post-emit minification with `cssnano` and `terser`.

- **Phase 3 — Shared analysis host**
  - Internal enabler for Build > Editor Tooling, Build > Dev, Build > Validate, and Inspect.
  - Build VFS overlay on the `ReadFile` seam.
  - Add reverse-dependency index, contract cache, contract-diff invalidation, and positional index.
  - Add diagnostic phases: `lint`, `store-schema`, `render`.
  - Emit source maps back to `.nz.liquid`.

- **Phase 4 — Dev server**
  - Product: Build > Dev, Build > Validate.
  - Add `nazare dev`: watcher, incremental rebuild, dev-mode baseline handling, and `shopify theme dev` feed.
  - Support coexistence mode: mix `.nz.liquid` components with existing `.liquid`, SCSS, global JS, and current theme layouts.
  - Add output diff reports so migrations can review generated Liquid/schema/layout changes.
  - Run Theme Check on emitted output in `dev` and `build --check`.

- **Phase 5 — LSP**
  - Product: Build > Editor Tooling.
  - Reuse Phase 3 host for diagnostics.
  - Add hover, go-to-definition, document symbols.
  - Add completion, signature help, code actions, and inlay hints.
  - Add find-references, then rename.

- **Phase 6 — Shopify-hosted data checks**
  - Product: Build > Validate.
  - Add `nazare pull-schema` snapshots.
  - Scan metafields/global settings and report store-schema diagnostics.
  - Add live dev-theme render checks with golden HTML for CI/pre-release.
  - Add visual-regression hooks for migrated high-risk templates: product, cart, collection, account.

## Parallel product tracks

- **Track R — Registry into shadcn-like catalog**
  - Product: Registry > Components, Registry > Browser.
  - **R0** Stand up `registry.nazare.engineering` and publish curated catalog.
  - **R1** Add `GET /components` index/search and `listComponents()`.
  - **R2** Add rich metadata: `description`, `category`, `type`, `preview`, `docs`.
  - **R3** Add theming foundation item type and token stylesheet.
  - **R4** Build curated `@nazare/*` component library with docs and AJAX examples.
  - **R5** Add provenance/content-digest lock.
  - **R6** Add composed blocks and governance/contribution flow.

- **Track O — OSS & website**
  - Project operations; not a product-map capability except the registry browser.
  - **O1** Finish OSS basics: `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`.
  - **O2** Build landing/docs site with Astro/Starlight.
  - **O3** Build in-browser compiler playground.
  - **O4** Publish CLI to npm with Changesets.
  - **O5** Build registry browser after R1.
  - **O6** Add issue/PR templates, Discussions, showcase, starter theme.

- **Track M — Migration parity for real Shopify repos**
  - Cross-cutting product capabilities: Build > Types, Build > Assets, Runtime, Inspect > Migrate, Build > Validate.
  - **M0** Document staged adoption playbooks from `notes/alkamind-migration-audit.md` and `notes/climatic-health-migration-audit.md`.
  - **M1** Ship low-blast-radius coexistence: keep existing Liquid/SCSS/global JS while adding `.nz.liquid` components.
  - **M2** Provide contracts-first migration tooling for implicit snippet locals and static `{% render %}` calls.
  - **M3** Preserve legacy asset patterns: Tailwind v4 app builds, SCSS entrypoints, committed/global JS replacement path, public assets, preload order.
  - **M4** Support island migration adapters for selector-driven JS, custom elements, third-party globals, cart/product flows, and teardown.
  - **M5** Add migration safety reports: output diffs, schema drift, Theme Check, render/visual regression gates.

- **Track W — Multi-theme workspaces**
  - Product: Build > Workspace.
  - **W0** Document recommended monorepo layout for several Shopify themes sharing Nazare source.
  - **W1** Support multiple named theme build configs in one repository, each with explicit `sourceRoot` and `outDir`.
  - **W2** Support shared source packages/components across theme roots with safe import boundaries and diagnostics.
  - **W3** Add workspace commands to build, check, and diff one theme or all themes.
  - **W4** Add registry/version policy controls for keeping shared components consistent across themes.

## Dependency notes

- Phase 4 and Phase 5 require Phase 3.
- Source maps improve Theme Check attribution and LSP diagnostics.
- Reverse-dep index powers incremental dev builds and cross-file rename.
- Phase 1 strategy-aware mount is reused by re-hydration.
- Phases 0, 1, and 2 can proceed in parallel with Phase 3.
- Playground shares the pure compiler + `ReadFile` seam with LSP.
- Registry browser needs R1.
- Curated AJAX components exercise Phase 1 hydration.
- Track M pulls from both real-theme audits and should shape Phase 1, Phase 2, Phase 4, and Phase 6 acceptance criteria.
