# Nazare Component Package Spec

## Purpose

A registry component package defines the files a component may contribute to a local theme repo when installed by the CLI.

This spec defines allowed file categories, path rules, and forbidden destinations for v1.

## Allowed file categories

A component may include:

- `sections/*.liquid`
- `snippets/*.liquid`
- `scripts/sections/*.js`
- `scripts/snippets/*.js`
- `assets/*`

V1 does not include component docs or examples as package file categories.

## Manifest declaration

Every installed file must be declared explicitly in `nazare.registry.yml` under `components.<name>.files`.

V1 does not support implicit file discovery or glob-based component file declarations.

## Path rules

### `from`

Rules:

- must be relative path inside registry repo
- must use forward slashes
- must exist
- must not be absolute path
- must not contain `..`

### `to`

Rules:

- must be relative path inside target theme repo
- must use forward slashes
- must not be absolute path
- must not contain `..`
- must remain within theme root after normalization

## Allowed destinations

For v1, component file destinations are restricted to:

- `sections/`
- `snippets/`
- `scripts/sections/`
- `scripts/snippets/`
- `assets/`

## Forbidden destinations

For v1, component installs must not write into:

- `layout/`
- `config/`
- `templates/`
- `locales/`
- `styles/`
- `snippets/section-css.liquid`
- `snippets/section-css-preloads.liquid`
- `scripts/theme.js`
- hidden paths such as `.git/` or `.github/`

This prevents component installs from mutating scaffold-owned or plugin-generated files.

## File types

For v1, supported installable file types are:

- Liquid source files
- JavaScript source files
- opaque static asset files

The CLI does not need to hardcode an exhaustive asset extension allowlist in v1.

## Ownership

After copy into the theme repo, component files are user-owned.

Plugin-generated files remain outside component ownership.

## Validation rules

CLI must fail validation for:

- missing declared source file
- unsafe `from` path
- unsafe `to` path
- destination outside allowed directories
- destination in forbidden path
- duplicate destination path within one component

## Relationship to other specs

- registry manifest schema: `docs/registry-manifest.spec.md`
- CLI behavior and install flows: `docs/cli.spec.md`
- local build/runtime behavior: `docs/theme.spec.md`
