---
schemaVersion: 1

id: theme-build-pipeline
title: Theme Build Pipeline
status: planned

dependencies:
  - cli-install
  - cli-self-update
  - cli-init
  - theme-scaffold
  - theme-build-plugin

surfaces:
  storefront:
    - Nazare theme build entrypoints
    - Shopify asset hook points

invariants:
  - Build pipeline files must extend the minimal scaffold without adding demo storefront content
  - Build pipeline files must be declared in the registry manifest theme.files list
  - Generated Vite plugin output must not be committed as scaffold source
  - Layout hook points must support generated CSS and JS assets
  - The starter section must support the section CSS contract used by later components
  - Build pipeline files become user-owned after nazare theme pull copies them

nonGoals:
  - Implementing nazare theme pull
  - Implementing component install behavior
  - Implementing the full Nazare Vite plugin
  - Supporting operation without the Nazare Vite plugin
  - Defining a visual design system
  - Shipping generated build output as source
  - Shipping a full Shopify skeleton theme
  - Theme drift detection or reconciliation

codebaseOwnership:
  owns:
    repo:
      - theme/default/package.json
      - theme/default/vite.config.js
      - theme/default/styles/base.css
      - theme/default/.gitignore
      - Nazare build hook points in theme/default/layout/theme.liquid
      - section CSS hook point in theme/default/sections/s-main.liquid
      - nazare.registry.yml theme block entries for build pipeline files
      - README.md theme build pipeline notes
      - test/ theme build pipeline fixture tests

  mustNotModify:
    - bin/nazare.js command behavior
    - component registry behavior
    - generated Vite plugin output files
    - user theme files outside generated test fixtures
    - install metadata
---

# Theme Build Pipeline

## Goal

Add the minimal local build pipeline files and hook points to the default Nazare theme scaffold.

The pulled theme should be ready for Nazare-style CSS and JavaScript wiring from the start, while still avoiding generated output, demo content, and full starter-theme bulk.

---

## Scope

Included:

- `theme/default/package.json`
- `theme/default/vite.config.js`
- `theme/default/styles/base.css`
- `theme/default/.gitignore`
- Vite and Tailwind wiring required for the minimal Nazare build pipeline
- no required JavaScript UI framework in v1 scaffold
- manifest `theme.files` entries for build pipeline files
- layout hook points for generated CSS and JavaScript assets
- starter section hook point for section CSS contract
- README notes for local build commands
- tests that verify build pipeline fixture shape and hook points

### Added v1 scaffold files

This feature adds these files to the default registry `theme.files` list:

```yaml
theme:
  version: 1.0.0
  source: theme/default
  files:
    - from: theme/default/package.json
      to: package.json
    - from: theme/default/vite.config.js
      to: vite.config.js
    - from: theme/default/styles/base.css
      to: styles/base.css
    - from: theme/default/.gitignore
      to: .gitignore
```

These entries are additive to the Shopify-only files from `theme-scaffold`.

### Required file intent

- `package.json`: local `dev`, `build`, and `watch` scripts plus package metadata required by the scaffold.
- `vite.config.js`: Vite, Tailwind, and relative import wiring for the vendored Nazare Vite plugin.
- `styles/base.css`: Tailwind-powered base CSS entry imported by the build pipeline.
- `.gitignore`: ignores dependency folders and local-only tooling state, but does not ignore generated build outputs.

V1 includes Vite and Tailwind together as one build pipeline feature.

V1 does not require a JavaScript UI framework in the scaffold. Interactive section and snippet modules may use plain JavaScript. A framework choice, if any, belongs to a later feature or policy.

### Required hook points

`layout/theme.liquid` must include hook points for:

- base CSS asset generated from `styles/base.css`
- generated section CSS preload snippet in `<head>`
- generated runtime JS asset

The starter section must support the same section CSS contract later used by added sections.

### CSS and JavaScript bridge contract

Base CSS is loaded by `layout/theme.liquid`:

```liquid
{{ 'base.css' | asset_url | stylesheet_tag }}
```

Preloaded section CSS is loaded by `layout/theme.liquid` through a generated bridge snippet:

```liquid
{% render 'section-css-preloads' %}
```

Normal section CSS is loaded by each section through a generated bridge snippet:

```liquid
{% render 'section-css', section_name: '<section-name>' %}
```

For the starter section:

```liquid
{% render 'section-css', section_name: 's-main' %}
```

`snippets/section-css.liquid` is generated. It maps `section_name` to the matching compiled CSS asset for sections using normal CSS loading.

Example generated shape:

```liquid
{% case section_name %}
  {% when 's-main' %}
    {{ 's-main.css' | asset_url | stylesheet_tag }}
{% endcase %}
```

`snippets/section-css-preloads.liquid` is generated. It emits preload stylesheet tags for sections using preload CSS loading.

Example generated shape:

```liquid
{{ 's-hero.css' | asset_url | stylesheet_tag: preload: true }}
```

Runtime JavaScript is loaded by `layout/theme.liquid` as a module script:

```liquid
<script type="module" src="{{ 'theme.js' | asset_url }}"></script>
```

`scripts/theme.js` is the generated runtime entry. Vite builds it to `assets/theme.js`.

The runtime discovers JavaScript mount nodes with `data-nazare-use`:

```liquid
<div data-nazare-use="sections/s-hero"></div>
<div data-nazare-use="snippets/c-video"></div>
<div data-nazare-use="behaviors/scroll-snap"></div>
```

One DOM node uses exactly one module key. Multiple behaviors should use nested/wrapper nodes or one composed module key.

The generated runtime lazy-loads matching source modules through Vite dynamic imports:

- `data-nazare-use="sections/s-hero"` -> `scripts/sections/s-hero.js` -> `assets/sections--s-hero.js`
- `data-nazare-use="snippets/c-video"` -> `scripts/snippets/c-video.js` -> `assets/snippets--c-video.js`
- `data-nazare-use="behaviors/scroll-snap"` -> `scripts/behaviors/scroll-snap.js` -> `assets/behaviors--scroll-snap.js`

Component JavaScript modules export:

- `init(node)`
- optional `destroy(node)`

V1 does not include a scaffold-owned `base.js`. Global runtime behavior belongs in generated `scripts/theme.js`; component behavior belongs in `scripts/sections/*.js` and `scripts/snippets/*.js`. A user-owned global JavaScript entry can be added by a later feature if a real use case appears.

### Build contract

This feature defines the local theme build contract for scaffold v1.

Source inputs owned by this feature:

- `styles/base.css`: global base CSS entry.
- `vite.config.js`: Vite build configuration.
- `package.json`: local build command surface.

Generated intermediate files owned by the future Nazare Vite plugin, not scaffold source:

- `styles/<section-name>.css`: per-section Tailwind CSS entry generated from local section/snippet Liquid scan sources.
- `scripts/theme.js`: runtime entry generated from discovered `data-nazare-use` module keys.
- `snippets/section-css.liquid`: generated Liquid bridge for normal section CSS loads.
- `snippets/section-css-preloads.liquid`: generated Liquid bridge for preloaded section CSS.

Vite build outputs into Shopify theme assets:

- `styles/base.css` -> `assets/base.css`
- `styles/<section-name>.css` -> `assets/<section-name>.css`
- `scripts/theme.js` -> `assets/theme.js`
- `scripts/sections/<section-name>.js` -> `assets/sections--<section-name>.js`
- `scripts/snippets/<snippet-name>.js` -> `assets/snippets--<snippet-name>.js`
- `scripts/behaviors/<behavior-name>.js` -> `assets/behaviors--<behavior-name>.js`

V1 asset output names must be stable and must not include content hashes.

Script contract:

- `dev`: runs Shopify theme development through global `shopify theme dev`.
- `build`: runs a one-shot Vite production build into `assets/`.
- `watch`: runs the Vite build pipeline in watch mode for use beside Shopify theme development.

`dev` relies on Shopify CLI being installed globally and available on `PATH`. If `shopify` is missing, the script should fail with the shell command-not-found error.

Git policy follows [`docs/policies/generated-files-policy.md`](../docs/policies/generated-files-policy.md):

- scaffold source files in `theme.files` are user-owned after `nazare theme pull`.
- generated intermediate files are not listed in `theme.files`.
- generated asset outputs are not listed in `theme.files`.
- generated intermediate files and generated asset outputs should be git tracked by default in user theme repos.

Generated files are not scaffold source and must not be listed in `theme.files` unless a later feature changes ownership:

- `assets/base.css`
- `assets/<section-name>.css`
- `assets/theme.js`
- `assets/sections--<section-name>.js`
- `assets/snippets--<snippet-name>.js`
- `scripts/theme.js`
- `styles/<section-name>.css`
- `snippets/section-css.liquid`
- `snippets/section-css-preloads.liquid`

---

## Success behavior

- The repo contains the build pipeline files listed in this feature under `theme/default/`.
- The default registry manifest contains valid `theme.files` entries for those build pipeline files.
- Every build pipeline `theme.files[].from` path exists in the repo.
- Every build pipeline `theme.files[].to` path is a safe relative theme path.
- `package.json` exposes local `dev`, `build`, and `watch` scripts, where `dev` runs `shopify theme dev`.
- `vite.config.js` wires the Vite/Tailwind build pipeline and vendored Nazare Vite plugin for the local theme.
- `styles/base.css` is the base CSS entry.
- `layout/theme.liquid` contains CSS bridge and module runtime hook points.
- `sections/s-main.liquid` contains the section CSS contract hook point.
- build contract maps source inputs and generated intermediates to stable Shopify asset outputs.
- Generated Vite plugin output is not committed as registry scaffold source, but is intended to be git tracked after generation in user theme repos.
- The local build depends on the Nazare Vite plugin and fails if that plugin is unavailable or cannot generate required runtime and bridge files.

---

## Failure behavior

- If a manifest theme file owned by this feature points at a missing source file, validation tests fail.
- If a manifest theme destination owned by this feature is unsafe, validation tests fail.
- If required scripts are missing from `package.json`, validation tests fail.
- If required Vite/Tailwind wiring or Nazare Vite plugin integration is missing from `vite.config.js`, validation tests fail.
- If required layout or section hook points are missing, validation tests fail.
- If required build input/output mappings are missing from `vite.config.js`, validation tests fail.
- If generated Vite plugin output is committed as registry scaffold source before generation, validation tests fail.
- If the Nazare Vite plugin dependency is missing or not wired in `vite.config.js`, build-pipeline validation tests fail.

---

## Verification

Result: planned.

- [ ] `theme/default/` contains build pipeline files
  - Verify `package.json`, `vite.config.js`, `styles/base.css`, and `.gitignore` exist.
- [ ] `nazare.registry.yml` contains valid `theme.files` entries for build pipeline files
  - Verify manifest parse and schema test.
- [ ] every build pipeline `theme.files[].from` exists
  - Verify manifest-to-filesystem test.
- [ ] every build pipeline `theme.files[].to` is safe
  - Verify path safety test.
- [ ] `package.json` exposes local `dev`, `build`, and `watch` scripts
  - Verify package fixture assertions.
- [ ] `vite.config.js` wires Nazare theme build behavior
  - Verify config fixture assertions, including real Nazare Vite plugin import/use.
- [ ] `styles/base.css` exists as base CSS entry
  - Verify file existence and basic content.
- [ ] layout has Nazare CSS preload and module runtime hook points
  - Verify string/fixture assertions.
- [ ] CSS and JavaScript bridge contracts are documented and asserted
  - Verify generated snippet shapes, one-key `data-nazare-use` lazy-load mapping, and module script usage.
- [ ] starter section supports section CSS contract
  - Verify string/fixture assertions.
- [ ] build contract maps source inputs and generated intermediates to stable Shopify asset outputs
  - Verify `vite.config.js` fixture assertions for stable asset names and output root.
- [ ] generated Vite plugin output is not included as registry scaffold source before generation
  - Verify generated paths are absent from `theme.files` and `theme/default/`.
- [ ] `.gitignore` does not ignore generated build outputs
  - Verify generated `assets/`, `styles/<section-name>.css`, `scripts/theme.js`, and generated Liquid bridge snippets remain trackable in user theme repos.

---

## Architecture notes

This feature owns scaffold build files and hook points, not CLI copy behavior. `nazare theme pull` is implemented separately and should copy whatever the registry manifest declares.

The build pipeline should be minimal. It exists so the first pulled theme is not a dead end for later component CSS and JavaScript.

Vite and Tailwind belong in the same feature because they jointly define the local asset pipeline contract for Nazare themes.

A JavaScript UI framework does not belong in this feature. The scaffold runtime contract should remain framework-agnostic in v1.

The Nazare Vite plugin is owned by `theme-build-plugin`. This feature depends on that plugin and should not attempt to provide placeholder behavior without it.

`vite.config.js` should import and use the vendored plugin by relative path, such as `./nazare/vite-plugin.js`. A pulled theme with this build pipeline is not expected to build or render correctly if the plugin is missing, because generated runtime files and bridge snippets come from the plugin.

Generated files must remain generated. They should be absent from registry scaffold source and `theme.files`, but trackable in user theme repos after generation.

---

## Open questions

None.
