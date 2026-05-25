# Nazare Registry Manifest Spec

## Purpose

The registry manifest is a CLI-only contract.

It defines:

- which theme files exist in the registry
- which components exist in the registry
- which files belong to each component
- component dependency metadata
- component versions

It does not define build graph truth.

The Nazare Vite plugin does not depend on the registry manifest for build behavior. Build graph truth comes from local theme files, including static `{% render %}` references, `data-nazare-use`, and section `nazare:css` directives.

## File name

`nazare.registry.yml`

## Top-level schema

```yaml
schemaVersion: 1

registry:
  name: nazare

theme:
  version: 1.0.0
  source: templates/default
  files:
    - from: templates/default/package.json
      to: package.json
    - from: templates/default/layout/theme.liquid
      to: layout/theme.liquid

components:
  core:
    kind: utility
    version: 1.0.0
    files:
      - from: components/core/snippets/icon.liquid
        to: snippets/icon.liquid

  c-button:
    kind: snippet
    version: 1.2.0
    dependencies:
      - core
    files:
      - from: components/snippets/c-button.liquid
        to: snippets/c-button.liquid
      - from: components/scripts/snippets/c-button.js
        to: scripts/snippets/c-button.js

  s-hero:
    kind: section
    version: 2.0.0
    dependencies:
      - core
      - c-button
      - c-video
    files:
      - from: components/sections/s-hero.liquid
        to: sections/s-hero.liquid
      - from: components/scripts/sections/s-hero.js
        to: scripts/sections/s-hero.js
      - from: components/assets/s-hero-poster.jpg
        to: assets/s-hero-poster.jpg
```

## Top-level fields

### `schemaVersion`

Required integer.

Purpose:

- manifest format version
- CLI compatibility gate

CLI must fail on unsupported schema versions.

### `registry`

Required object.

```yaml
registry:
  name: nazare
```

Fields:

- `name`: required string

This metadata is used by the CLI for provenance, display, and lockfile tracking.

### `theme`

Optional object.

```yaml
theme:
  version: 1.0.0
  source: templates/default
  files:
    - from: templates/default/layout/theme.liquid
      to: layout/theme.liquid
```

Fields:

- `version`: required exact SemVer 2.0.0 string if `theme` is present
- `source`: required string if `theme` is present; registry-side scaffold root, such as `templates/default`
- `files`: required array if `theme` is present

`theme.source` is provenance metadata and must be copied into `nazare.lock.yml` when theme files are written.

This metadata is used by `nazare theme pull` and explicit overwrite choices during file conflicts.

A registry may omit `theme` and still be valid for component operations, but `nazare theme pull` requires `theme` to exist.

Theme scaffold requirements are defined separately in `spec/theme-scaffold.spec.md`.

Theme file path rules:

- `from` must be relative path inside registry repo
- `from` must use forward slashes
- `from` must exist in registry
- `from` must not be absolute path
- `from` must not contain `..`
- `to` must be relative path inside target theme repo
- `to` must use forward slashes
- `to` must not be absolute path
- `to` must not contain `..`
- `to` must remain within theme root after normalization
- duplicate `to` paths within `theme.files` are invalid

### `components`

Required map keyed by component name.

An empty map is valid for registries that only provide a theme scaffold:

```yaml
components: {}
```

Key rules:

- keys must be unique
- kebab-case is recommended
- names such as `core`, `c-button`, and `s-hero` are valid

## Component schema

```yaml
components:
  s-hero:
    kind: section
    version: 2.0.0
    dependencies:
      - core
      - c-button
    files:
      - from: components/sections/s-hero.liquid
        to: sections/s-hero.liquid
```

### `kind`

Required enum.

Allowed values:

- `section`
- `snippet`
- `utility`

### `version`

Required string.

Must be an exact SemVer 2.0.0 version string: `MAJOR.MINOR.PATCH` with optional prerelease and build metadata.

Valid examples:

- `1.0.0`
- `0.1.2`
- `2.3.4-beta.1`
- `2.3.4+build.5`
- `2.3.4-beta.1+build.5`

Invalid examples:

- `1`
- `1.0`
- `v1.0.0`
- `^1.0.0`
- `~1.0.0`
- `>=1.0.0`
- `1.x`
- `latest`
- `main`

This is tracked by the CLI as component version for install history, display, diff context, and outdated checks.

It does not act as a version selector. In v1, registry `ref` selects the source snapshot. The CLI does not support `nazare add <component>@version`.

### `dependencies`

Optional array of component names.

Rules:

- each dependency must exist in `components`
- self-dependency is invalid
- dependency cycles are invalid

### `files`

Required non-empty array.

Each item:

```yaml
- from: components/sections/s-hero.liquid
  to: sections/s-hero.liquid
```

Fields:

- `from`: required path inside registry repo
- `to`: required relative path inside target theme repo

Rules:

- paths use forward slashes
- `from` must exist in registry
- `to` must be relative to theme root
- absolute paths are invalid
- path traversal outside theme root is invalid
- duplicate `to` paths within one component are invalid

## Optional component metadata

Optional metadata may be included for registry UX.

```yaml
displayName: Hero
description: Large hero section with CTA
tags:
  - video
  - conversion
```

These fields are optional and do not affect build graph behavior.

V1 does not define registry-side component docs or examples fields.

Component package contents and destination rules are defined separately in `spec/component-package.spec.md`.

## Explicit non-fields

The registry manifest must not define build graph or generated asset behavior.

Do not include fields such as:

- `js`
- `css`
- `entry`
- `output`
- `load`
- `sources`

Those concerns belong to local theme files and the Nazare Vite plugin.

## Validation rules

The CLI must fail validation for:

- missing `schemaVersion`
- unsupported `schemaVersion`
- missing `registry`
- missing `components`
- theme present but missing `version`, `source`, or `files`
- invalid theme `version` format
- unsafe theme `source` path
- missing theme `from` file
- unsafe theme `from` path
- unsafe theme `to` path
- duplicate destination path within `theme.files`
- component missing `kind`, `version`, or `files`
- invalid component `version` format
- unknown dependency reference
- dependency cycle
- missing `from` file
- unsafe `to` path
- duplicate component key
- duplicate destination path within one component

The CLI may also fail when two requested components in one install operation map different origin files to the same destination path, unless that conflict is resolved through explicit conflict choices.

## Versioning model

In v1, version selection and source selection are separate concerns.

- registry `ref` selects registry snapshot
- component `version` identifies component state inside that snapshot

CLI install behavior:

- `nazare add <component>` installs from configured registry `ref`
- component `version` is recorded in lockfile after install
- `nazare outdated` compares installed component `version` in lockfile against current component `version` at configured registry `ref`

V1 does not support:

- `nazare add <component>@version`
- semver ranges
- independent historical resolution of component versions outside registry `ref`

## Ownership boundary

Registry manifest ownership:

- read by CLI
- not read by Nazare Vite plugin for build graph decisions

Build graph ownership:

- local theme Liquid files
- local static `{% render %}` graph
- local `data-nazare-use`
- local `nazare:css` section directives
- Nazare Vite plugin scanner and generators
