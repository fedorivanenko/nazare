---
schemaVersion: 1

id: F-004
title: Theme Build Pipeline
status: planned

dependencies:
  - F-000
  - F-001
  - F-002
  - F-003

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
      - section CSS hook point in theme/default/sections/main.liquid
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

# 004 — Theme Build Pipeline

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

These entries are additive to the Shopify-only files from F-003.

### Required file intent

- `package.json`: local dev/build scripts and package metadata required by the scaffold.
- `vite.config.js`: Vite and Nazare plugin wiring for the local theme.
- `styles/base.css`: baseline CSS entry imported by the build pipeline.
- `.gitignore`: ignores dependency folders and generated build output that should not be committed by default.

### Required hook points

`layout/theme.liquid` must include hook points for:

- base CSS asset generated from `styles/base.css`
- generated section CSS preload snippet in `<head>`
- generated runtime JS asset

The starter section must support the same section CSS contract later used by added sections.

Generated files are not scaffold source and must not be listed in `theme.files` unless a later feature changes ownership:

- `assets/theme.js`
- `scripts/theme.js`
- `snippets/section-css.liquid`
- `snippets/section-css-preloads.liquid`

---

## Success behavior

- The repo contains the build pipeline files listed in this feature under `theme/default/`.
- The default registry manifest contains valid `theme.files` entries for those build pipeline files.
- Every build pipeline `theme.files[].from` path exists in the repo.
- Every build pipeline `theme.files[].to` path is a safe relative theme path.
- `package.json` exposes minimal local dev and build scripts.
- `vite.config.js` wires the Nazare build pipeline for the local theme.
- `styles/base.css` is the base CSS entry.
- `layout/theme.liquid` contains generated CSS and JS hook points.
- `sections/main.liquid` contains the section CSS contract hook point.
- Generated Vite plugin output is not committed as scaffold source.

---

## Failure behavior

- If a manifest theme file owned by this feature points at a missing source file, validation tests fail.
- If a manifest theme destination owned by this feature is unsafe, validation tests fail.
- If required scripts are missing from `package.json`, validation tests fail.
- If required Vite/Nazare wiring is missing from `vite.config.js`, validation tests fail.
- If required layout or section hook points are missing, validation tests fail.
- If generated Vite plugin output is committed as scaffold source, validation tests fail.

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
- [ ] `package.json` exposes local dev and build scripts
  - Verify package fixture assertions.
- [ ] `vite.config.js` wires Nazare theme build behavior
  - Verify config fixture assertions.
- [ ] `styles/base.css` exists as base CSS entry
  - Verify file existence and basic content.
- [ ] layout has Nazare CSS preload and runtime hook points
  - Verify string/fixture assertions.
- [ ] starter section supports section CSS contract
  - Verify string/fixture assertions.
- [ ] generated Vite plugin output is not included as scaffold source
  - Verify generated paths are absent from `theme.files` and `theme/default/`.

---

## Architecture notes

This feature owns scaffold build files and hook points, not CLI copy behavior. `nazare theme pull` is implemented separately and should copy whatever the registry manifest declares.

The build pipeline should be minimal. It exists so the first pulled theme is not a dead end for later component CSS and JavaScript.

The Nazare Vite plugin can be stubbed or referenced as a dependency contract here, but full plugin implementation belongs to later build/runtime feature work.

Generated files must remain generated. They should be ignored or absent from source, not tracked as scaffold files.

---

## Open questions

- What exact npm scripts should v1 expose: `dev`, `build`, or both plus `shopify` helpers?
- Should `vite.config.js` import a real Nazare plugin immediately, or use placeholder wiring until the plugin feature lands?
