---
schemaVersion: 1

id: F-003
title: Minimal Theme Scaffold
status: planned

dependencies:
  - F-000
  - F-001
  - F-002

surfaces:
  storefront:
    - minimal Shopify Liquid theme scaffold
    - Nazare runtime integration points

invariants:
  - The scaffold must be thinner than Shopify skeleton theme
  - The scaffold must remain a valid minimal Shopify Liquid theme
  - Every scaffold file must be required for Shopify validity, initial render, local development, or Nazare integration
  - The scaffold must include exactly one starter section in v1
  - Scaffold files become user-owned after nazare theme pull copies them
  - Generated Vite plugin output must not be committed as scaffold source

nonGoals:
  - Implementing nazare theme pull
  - Implementing component install behavior
  - Shipping a full Shopify skeleton theme
  - Shipping demo sections or starter content beyond the minimum render path
  - Theme drift detection or reconciliation
  - Visual design system decisions
  - Production storefront feature completeness
  - Implementing the Nazare Vite plugin

codebaseOwnership:
  owns:
    repo:
      - templates/default/ minimal registry theme scaffold
      - nazare.registry.yml theme block and theme.files list
      - README.md minimal theme scaffold notes
      - test/ theme scaffold fixture tests

  mustNotModify:
    - bin/nazare.js command behavior
    - component registry behavior
    - generated Vite plugin output files
    - user theme files outside generated test fixtures
    - install metadata
---

# 003 — Minimal Theme Scaffold

## Goal

Define the initial Nazare registry theme scaffold copied later by `nazare theme pull`.

The scaffold should be the thinnest valid Shopify Liquid theme needed for Nazare usage: enough to render, run local development, and support later component adds, without shipping a full starter theme.

---

## Scope

Included:

- minimal registry theme scaffold under `templates/default/`
- exact v1 scaffold file list
- manifest `theme` block content for the default registry
- Shopify minimal theme validity expectations
- Nazare runtime and build integration points in scaffold files
- README notes for the minimal scaffold
- tests that verify scaffold fixture shape and required integration points

### V1 scaffold files

The default registry scaffold should declare these files in `nazare.registry.yml`:

```yaml
theme:
  version: 1.0.0
  source: templates/default
  files:
    - from: templates/default/layout/theme.liquid
      to: layout/theme.liquid
    - from: templates/default/templates/index.json
      to: templates/index.json
    - from: templates/default/sections/main.liquid
      to: sections/main.liquid
    - from: templates/default/config/settings_schema.json
      to: config/settings_schema.json
    - from: templates/default/styles/base.css
      to: styles/base.css
    - from: templates/default/package.json
      to: package.json
    - from: templates/default/vite.config.js
      to: vite.config.js
    - from: templates/default/.gitignore
      to: .gitignore
```

`theme.version` is the registry scaffold version. It is not the local user theme version.

### Required file intent

- `layout/theme.liquid`: baseline Shopify layout with Nazare asset and runtime hook points.
- `templates/index.json`: minimal JSON template that renders the starter section.
- `sections/main.liquid`: one minimal starter section and first render target.
- `config/settings_schema.json`: minimal Shopify theme settings schema required for theme validity.
- `styles/base.css`: baseline CSS entry imported by the build pipeline.
- `package.json`: local dev/build scripts and package metadata required by the scaffold.
- `vite.config.js`: Vite and Nazare plugin wiring for the local theme.
- `.gitignore`: ignores dependency folders and generated build output that should not be committed by default.

### Required integration points

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

- The repo contains `templates/default/` with exactly the v1 scaffold files listed in this feature.
- The default registry manifest contains a valid `theme` block for those files.
- `theme.version` is a valid SemVer 2.0.0 string.
- Every `theme.files[].from` path exists in the repo.
- Every `theme.files[].to` path is a safe relative theme path.
- The scaffold includes one starter section only.
- The scaffold has no broad Shopify skeleton demo content.
- The scaffold has no generated Vite plugin output committed as source.

---

## Failure behavior

- If a manifest theme file points at a missing scaffold source file, validation tests fail.
- If a manifest theme destination is unsafe, validation tests fail.
- If scaffold includes extra starter/demo sections beyond the one starter section, validation tests fail.
- If generated Vite plugin output is committed as scaffold source, validation tests fail.
- If required integration points are missing from layout or starter section files, validation tests fail.

---

## Verification

Result: planned.

- [ ] `templates/default/` contains the exact v1 scaffold file list
  - Verify with fixture file-list test.
- [ ] `nazare.registry.yml` contains a valid `theme` block
  - Verify manifest parse and schema test.
- [ ] every `theme.files[].from` exists
  - Verify manifest-to-filesystem test.
- [ ] every `theme.files[].to` is safe
  - Verify path safety test.
- [ ] scaffold includes exactly one section
  - Verify `templates/default/sections/*.liquid` count.
- [ ] layout has Nazare CSS preload and runtime hook points
  - Verify string/fixture assertions.
- [ ] starter section supports section CSS contract
  - Verify string/fixture assertions.
- [ ] generated Vite plugin output is not included as scaffold source
  - Verify generated paths are absent from `theme.files` and `templates/default/`.
- [ ] scaffold stays thinner than Shopify skeleton
  - Verify no demo section library, no sample content bulk, and only required files exist.

---

## Architecture notes

This feature owns scaffold source content, not copy behavior. `nazare theme pull` is implemented separately and should copy whatever the registry manifest declares.

The scaffold should use Shopify skeleton theme as an audit/reference source only. The shipped scaffold should be a reduced Nazare-specific subset.

The file list should be conservative. Add files only when required by Shopify validity, first render, local dev/build flow, or Nazare integration.

Generated Vite plugin output belongs to build/runtime features, not scaffold source.

---

## Open questions

- Should the starter section be named `main.liquid`, `s-main.liquid`, or another Nazare naming convention?
- Is `templates/index.json` the best minimum render path, or should v1 use a Liquid template?
