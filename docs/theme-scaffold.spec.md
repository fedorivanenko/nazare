# Nazare Theme Scaffold Spec

## Purpose

The registry theme is the minimal Shopify theme scaffold pulled into a local theme repo by `nazare theme pull`.

For v1, it should be a minimal Shopify theme based on the Shopify skeleton theme, reduced to the minimum required structure and containing only one section.

This scaffold provides the baseline files and tooling needed for Nazare component adds and Nazare Vite plugin integration.

## Scope

The scaffold defines:

- minimal required Shopify theme file structure
- minimal required build tooling integration
- minimal required Nazare integration points

It does not define:

- visual design system
- full production storefront feature set
- large starter section library
- component registry contents

## Shape

The pulled theme should be a minimal Shopify theme with:

- one layout
- one section
- minimal supporting config/templates required for a valid Shopify theme
- Vite and Tailwind integration
- Nazare Vite plugin integration

For v1, the scaffold should contain only one section in `sections/`.

## Baseline source

The scaffold should be based on the Shopify skeleton theme.

Nazare may simplify and reduce that baseline, but the result must remain a valid minimal Shopify theme scaffold.

## Required capabilities

After `nazare theme pull`, the scaffold must support:

- local development with Vite
- build output into Shopify `assets/`
- Nazare-generated `styles/<section-name>.css`
- Nazare-generated `scripts/theme.js`
- Nazare-generated `snippets/section-css.liquid`
- Nazare-generated `snippets/section-css-preloads.liquid`
- component adds into `sections/`, `snippets/`, `scripts/`, and `assets/`

## Required integration points

The scaffold must provide:

- `layout/theme.liquid`
- `styles/base.css`
- Vite config file
- Tailwind config and wiring required by the Nazare Vite plugin contract
- package metadata and scripts needed to run dev and build flows

`layout/theme.liquid` must include integration points for:

- base CSS asset
- generated section CSS preload snippet in `<head>`
- generated runtime JS asset

The scaffold starter section must render generated normal CSS loads through `snippets/section-css.liquid` using:

```liquid
{% render 'section-css', section_name: '<section-name>' %}
```

The scaffold must also allow added section templates to use the same render contract.

## Minimal content expectations

The scaffold should be intentionally small.

For v1, it should avoid:

- extra demo sections beyond the single starter section
- large sample content sets
- unnecessary theme app extensions or advanced integrations
- extra runtime frameworks

## Ownership

After `nazare theme pull`, scaffold theme files are user-owned.

Generated files created later by the Nazare Vite plugin are not user-owned.

## Relationship to other specs

- registry manifest describes how theme files are declared: `docs/registry-manifest.spec.md`
- local theme build/runtime behavior is defined in: `docs/theme.spec.md`
- local theme config is defined in: `docs/theme-config.spec.md`
- local lockfile behavior is defined in: `docs/theme-lockfile.spec.md`
