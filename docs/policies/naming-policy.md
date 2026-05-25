# Naming Policy

## Purpose

This policy defines canonical v1 naming for Nazare scaffold files, component files, component IDs, and runtime module keys.

Features should consume this policy instead of redefining naming rules locally.

## General rules

Use lowercase kebab-case for file stems and component IDs.

Allowed characters:

- `a-z`
- `0-9`
- `-`

Regex for file stems and component name bodies:

```txt
^[a-z0-9]+(?:-[a-z0-9]+)*$
```

Do not use:

- spaces
- underscores
- uppercase letters
- path separators inside names

## Prefixes

Reserved prefixes:

- `s-`: section
- `c-`: snippet component

These prefixes are part of the canonical file stem and component ID.

## Sections

Section names use `s-<name>`.

Paths:

- `sections/s-<name>.liquid`
- `scripts/sections/s-<name>.js`

Examples:

- `sections/s-hero.liquid`
- `scripts/sections/s-hero.js`

Runtime module key:

- `sections/s-<name>`

Generated CSS uses the raw section name:

- `styles/s-<name>.css`
- `assets/s-<name>.css`

## Snippets

Installable snippet component names use `c-<name>`.

Paths:

- `snippets/c-<name>.liquid`
- `scripts/snippets/c-<name>.js`

Examples:

- `snippets/c-button.liquid`
- `scripts/snippets/c-button.js`

Runtime module key:

- `snippets/c-<name>`

## Utilities

Registry utility package names may be unprefixed when they are package-level metadata names such as `core`.

That does not change destination path rules. Utility package files must still use normal destination paths such as:

- `snippets/<name>.liquid`
- `assets/<name>`

## Scaffold starter section

The v1 scaffold starter section name is `s-main`.

Required scaffold path:

- `sections/s-main.liquid`

## Shopify JSON templates

In Shopify JSON templates, section instance keys and section types are different.

Use a stable local instance key such as `main`, and reference the Nazare section by type `s-main`.

Example:

```json
{
  "sections": {
    "main": {
      "type": "s-main",
      "settings": {}
    }
  },
  "order": ["main"]
}
```

Rules:

- template instance keys do not need to match section file stems
- template `type` must match the section file stem without `.liquid`
- for scaffold v1, `templates/index.json` should reference section type `s-main`

## Scope

This policy applies to:

- scaffold-owned section and snippet names
- component package names when they map to installable sections or snippets
- generated CSS entry naming derived from section names
- runtime module keys derived from section and snippet paths

## Notes

This policy does not require every registry package name to use a prefix. Utility/meta package names such as `core` may remain unprefixed.
