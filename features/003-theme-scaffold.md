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

invariants:
  - The scaffold must be thinner than Shopify skeleton theme
  - The scaffold must remain a valid minimal Shopify Liquid theme
  - Every scaffold file must be required for Shopify validity or initial render
  - The scaffold must include exactly one starter section in v1
  - Scaffold files become user-owned after nazare theme pull copies them
  - Build pipeline files must be owned by a later feature

nonGoals:
  - Implementing nazare theme pull
  - Implementing theme build pipeline files
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
      - theme/default/layout/theme.liquid
      - theme/default/templates/index.json
      - theme/default/sections/main.liquid
      - theme/default/config/settings_schema.json
      - nazare.registry.yml theme block entries for minimal scaffold files
      - README.md minimal theme scaffold notes
      - test/ theme scaffold fixture tests

  mustNotModify:
    - bin/nazare.js command behavior
    - theme/default/package.json
    - theme/default/vite.config.js
    - theme/default/styles/base.css
    - theme/default/.gitignore
    - component registry behavior
    - generated Vite plugin output files
    - user theme files outside generated test fixtures
    - install metadata
---

# 003 — Minimal Theme Scaffold

## Goal

Define the initial Shopify-only Nazare registry theme scaffold copied later by `nazare theme pull`.

The scaffold should be the thinnest valid Shopify Liquid theme needed for first render, without build tooling, component install behavior, or full starter-theme content.

---

## Scope

Included:

- minimal registry theme scaffold under `theme/default/`
- exact v1 Shopify-only scaffold file list
- manifest `theme` block entries for the minimal scaffold files
- Shopify minimal theme validity expectations
- README notes for the minimal scaffold
- tests that verify scaffold fixture shape and required Shopify files

### V1 scaffold files

The default registry scaffold starts with these Shopify-only files in `nazare.registry.yml`:

```yaml
theme:
  version: 1.0.0
  source: theme/default
  files:
    - from: theme/default/layout/theme.liquid
      to: layout/theme.liquid
    - from: theme/default/templates/index.json
      to: templates/index.json
    - from: theme/default/sections/main.liquid
      to: sections/main.liquid
    - from: theme/default/config/settings_schema.json
      to: config/settings_schema.json
```

`theme.version` is the registry scaffold version. It is not the local user theme version.

### Required file intent

- `layout/theme.liquid`: baseline Shopify layout that can render the initial template and section.
- `templates/index.json`: minimal JSON template that renders the starter section.
- `sections/main.liquid`: one minimal starter section and first render target.
- `config/settings_schema.json`: minimal Shopify theme settings schema required for theme validity.

---

## Success behavior

- The repo contains `theme/default/` with the v1 Shopify-only scaffold files listed in this feature.
- The default registry manifest contains valid `theme.files` entries for those files.
- `theme.version` is a valid SemVer 2.0.0 string.
- Every `theme.files[].from` path owned by this feature exists in the repo.
- Every `theme.files[].to` path owned by this feature is a safe relative theme path.
- The scaffold includes one starter section only.
- The scaffold has no broad Shopify skeleton demo content.
- The scaffold has no build pipeline files.
- The scaffold has no generated Vite plugin output committed as source.

---

## Failure behavior

- If a manifest theme file owned by this feature points at a missing scaffold source file, validation tests fail.
- If a manifest theme destination owned by this feature is unsafe, validation tests fail.
- If scaffold includes extra starter/demo sections beyond the one starter section, validation tests fail.
- If build pipeline files are added by this feature, validation tests fail.
- If generated Vite plugin output is committed as scaffold source, validation tests fail.

---

## Verification

Result: planned.

- [ ] `theme/default/` contains the exact Shopify-only v1 scaffold file list
  - Verify with fixture file-list test.
- [ ] `nazare.registry.yml` contains valid `theme.files` entries for scaffold files
  - Verify manifest parse and schema test.
- [ ] every owned `theme.files[].from` exists
  - Verify manifest-to-filesystem test.
- [ ] every owned `theme.files[].to` is safe
  - Verify path safety test.
- [ ] scaffold includes exactly one section
  - Verify `theme/default/sections/*.liquid` count.
- [ ] layout renders the minimal Shopify document structure
  - Verify layout fixture assertions.
- [ ] starter section can render from `templates/index.json`
  - Verify template references the starter section.
- [ ] scaffold includes no build pipeline files
  - Verify `package.json`, `vite.config.js`, `styles/base.css`, and `.gitignore` are absent until F-004.
- [ ] generated Vite plugin output is not included as scaffold source
  - Verify generated paths are absent from `theme.files` and `theme/default/`.
- [ ] scaffold stays thinner than Shopify skeleton
  - Verify no demo section library, no sample content bulk, and only required files exist.

---

## Architecture notes

This feature owns Shopify scaffold source content, not copy behavior. `nazare theme pull` is implemented separately and should copy whatever the registry manifest declares.

The scaffold should use Shopify skeleton theme as an audit/reference source only. The shipped scaffold should be a reduced Nazare-specific subset.

The file list should be conservative. Add files only when required by Shopify validity or first render.

Theme build pipeline files are intentionally separate so the roadmap stays linear and each feature has one reason to change.

---

## Open questions

- Should the starter section be named `main.liquid`, `s-main.liquid`, or another Nazare naming convention?
- Is `templates/index.json` the best minimum render path, or should v1 use a Liquid template?
