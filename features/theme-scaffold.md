---
schemaVersion: 1

id: theme-scaffold
title: Minimal Theme Scaffold
status: planned

dependencies:
  - cli-install
  - cli-self-update
  - cli-init

surfaces:
  storefront:
    - minimal Shopify Liquid theme scaffold

invariants:
  - The scaffold must be thinner than Shopify skeleton theme
  - The scaffold must remain a valid minimal Shopify Liquid theme
  - Every scaffold file must be required for Shopify validity or initial render
  - The scaffold must include exactly one starter section in v1
  - Product, collection, cart, and other storefront page implementations must be installable components or component packages, not initial scaffold files
  - Scaffold files become user-owned after nazare theme pull copies them
  - Build pipeline files must be owned by a later feature

nonGoals:
  - Implementing nazare theme pull
  - Implementing theme build pipeline files
  - Implementing component install behavior
  - Shipping a full Shopify skeleton theme
  - Shipping demo sections or starter content beyond the minimum render path
  - Shipping product, collection, cart, page, blog, or article templates in the initial scaffold
  - Defining product page behavior; product pages should be added later as component packages
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
    - theme/default/templates/product.json
    - theme/default/templates/collection.json
    - theme/default/templates/cart.json
    - theme/default/templates/page.json
    - theme/default/templates/blog.json
    - theme/default/templates/article.json
    - generated Vite plugin output files
    - user theme files outside generated test fixtures
    - install metadata
---

# Minimal Theme Scaffold

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
- The scaffold has no product, collection, cart, page, blog, or article template implementations.
- The scaffold has no broad Shopify skeleton demo content.
- The scaffold has no build pipeline files.
- The scaffold has no generated Vite plugin output committed as source.

---

## Failure behavior

- If a manifest theme file owned by this feature points at a missing scaffold source file, validation tests fail.
- If a manifest theme destination owned by this feature is unsafe, validation tests fail.
- If scaffold includes extra starter/demo sections beyond the one starter section, validation tests fail.
- If scaffold includes product, collection, cart, page, blog, or article template implementations, validation tests fail.
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
- [ ] scaffold includes no product, collection, cart, page, blog, or article template implementations
  - Verify those template files are absent until component package features add them.
- [ ] scaffold includes no build pipeline files
  - Verify `package.json`, `vite.config.js`, `styles/base.css`, and `.gitignore` are absent until theme-build-pipeline.
- [ ] generated Vite plugin output is not included as scaffold source
  - Verify generated paths are absent from `theme.files` and `theme/default/`.
- [ ] scaffold stays thinner than Shopify skeleton
  - Verify no demo section library, no sample content bulk, and only required files exist.

---

## Architecture notes

This feature owns Shopify scaffold source content, not copy behavior. `nazare theme pull` is implemented separately and should copy whatever the registry manifest declares.

The scaffold should use Shopify skeleton theme as an audit/reference source only. The shipped scaffold should be a reduced Nazare-specific subset.

The file list should be conservative. Add files only when required by Shopify validity or first render.

Product, collection, cart, and other storefront page implementations should be modeled as later component packages. Example: a future product page package may install `templates/product.json`, `sections/s-product-main.liquid`, supporting snippets, CSS, and JavaScript together.

Theme build pipeline files are intentionally separate so the roadmap stays linear and each feature has one reason to change.

---

## Naming

Follow [`docs/policies/naming-policy.md`](../docs/policies/naming-policy.md).

For v1 scaffold:

- starter section file is `sections/s-main.liquid`
- `templates/index.json` should reference section type `s-main`
- Shopify JSON template instance keys may remain local keys such as `main`

## Open questions

- Is `templates/index.json` the best minimum render path, or should v1 use a Liquid template?
