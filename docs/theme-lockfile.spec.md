# Nazare Theme Lockfile Spec

## Purpose

The theme lockfile is a CLI-owned file stored in the user theme repo.

It records registry origin and install history for theme and component files copied from the registry.

It exists to support:

- installed component listing
- installed theme version tracking
- theme and component version change checks
- explicit overwrite choices during file conflicts
- dependency provenance

It does not define build graph truth.

The Nazare Vite plugin does not read this file for build behavior. Build graph truth comes from local theme files.

## File name

`nazare.lock.yml`

## Top-level schema

Initial lockfile created by `nazare init`:

```yaml
schemaVersion: 1

registry:
  name: nazare
  repo: github.com/fedorivanenko/nazare
  ref: refs/heads/main
  manifest: nazare.registry.yml

components: {}
```

Example populated lockfile after theme and component pulls:

```yaml
schemaVersion: 1

registry:
  name: nazare
  repo: github.com/fedorivanenko/nazare
  ref: refs/heads/main
  manifest: nazare.registry.yml

theme:
  version: 1.0.0
  source: templates/default
  installedAt: 2026-05-23T12:00:00Z
  files:
    - path: package.json
      source: templates/default/package.json
    - path: layout/theme.liquid
      source: templates/default/layout/theme.liquid

components:
  core:
    kind: utility
    version: 1.0.0
    installedAt: 2026-05-23T12:01:00Z
    dependencies: []
    files:
      - path: snippets/icon.liquid
        source: components/core/snippets/icon.liquid

  c-button:
    kind: snippet
    version: 1.2.0
    installedAt: 2026-05-23T12:02:00Z
    dependencies:
      - core
    files:
      - path: snippets/c-button.liquid
        source: components/snippets/c-button.liquid
      - path: scripts/snippets/c-button.js
        source: components/scripts/snippets/c-button.js

  s-hero:
    kind: section
    version: 2.0.0
    installedAt: 2026-05-23T12:03:00Z
    dependencies:
      - core
      - c-button
      - c-video
    files:
      - path: sections/s-hero.liquid
        source: components/sections/s-hero.liquid
      - path: scripts/sections/s-hero.js
        source: components/scripts/sections/s-hero.js
      - path: assets/s-hero-poster.jpg
        source: components/assets/s-hero-poster.jpg
```

## Top-level fields

### `schemaVersion`

Required integer.

Purpose:

- lockfile format version
- CLI compatibility gate

CLI must fail on unsupported schema versions.

### `registry`

Required object.

```yaml
registry:
  name: nazare
  repo: github.com/fedorivanenko/nazare
  ref: refs/heads/main
  manifest: nazare.registry.yml
```

Fields:

- `name`: required string
- `repo`: required string identifying registry origin
- `ref`: required string for branch, full ref, tag, or commit used for resolution
- `manifest`: required string path to manifest inside registry repo

This block records installed provenance from the time files were copied.

`nazare.config.yml` remains source of truth for future registry origin resolution. If config registry fields later differ from this lockfile block, CLI commands use config values and warn that installed provenance differs from current configured origin.

### `theme`

Optional object.

Present when at least one theme file has been pulled from registry origin.

```yaml
theme:
  version: 1.0.0
  source: templates/default
  installedAt: 2026-05-23T12:00:00Z
  files:
    - path: package.json
      source: templates/default/package.json
```

Fields:

- `version`: required exact SemVer 2.0.0 string if `theme` is present
- `source`: required string if `theme` is present
- `installedAt`: required RFC 3339 timestamp if `theme` is present
- `files`: required non-empty array if `theme` is present

`theme.files` contains only theme files actually copied or overwritten by the CLI. It is cumulative across pulls.

Each theme file entry:

- `path`: required relative path in theme repo
- `source`: required path in registry repo

Rules:

- `path` must stay inside theme root
- `source` must be path inside registry repo
- duplicate `path` entries within `theme.files` are invalid

### `components`

Required map keyed by installed component name.

If no components are installed, `components` must still exist as an empty map.

## Component lock entry schema

```yaml
components:
  s-hero:
    kind: section
    version: 2.0.0
    installedAt: 2026-05-23T12:03:00Z
    dependencies:
      - core
      - c-button
    files:
      - path: sections/s-hero.liquid
        source: components/sections/s-hero.liquid
```

### `kind`

Required enum.

Allowed values:

- `section`
- `snippet`
- `utility`

### `version`

Required string.

Must be an exact SemVer 2.0.0 version string: `MAJOR.MINOR.PATCH` with optional prerelease and build metadata. Ranges, tags, prefixes, and loose versions are invalid.

Component version copied into theme from registry origin.

This is tracked metadata, not an install selector. In v1, source selection comes from registry `ref`, not from `nazare add <component>@version`.

### `installedAt`

Required RFC 3339 timestamp.

Timestamp of last successful install or overwrite operation for that component.

### `dependencies`

Required array.

May be empty.

Contains component names resolved from manifest at install time.

This records dependency metadata for the component, even if some dependency files were skipped during a conflicting add operation.

### `files`

Required non-empty array.

Each item:

```yaml
- path: sections/s-hero.liquid
  source: components/sections/s-hero.liquid
```

Fields:

- `path`: required relative path in theme repo
- `source`: required path in registry repo

Rules:

- `path` must stay inside theme root
- `source` must be path inside registry repo
- duplicate `path` entries within one component are invalid

## Semantics

The lockfile tracks what the CLI copied from origin at install time.

At `init` time, the lockfile contains registry provenance and an empty `components` map. It does not contain `theme` metadata until `nazare theme pull` copies or overwrites at least one theme file.

`init` does not care whether target directory is empty. It only checks whether `nazare.lock.yml` already exists at target location.

Registry fields in the lockfile are provenance, not command input, after initialization.

It is used for:

- `nazare installed`
- `nazare outdated`
- explicit overwrite choices during file conflicts

For v1, `nazare outdated` lists installed `theme.version` and component `version` values from lockfile against current origin theme and component version values at configured registry `ref`. It does not resolve arbitrary historical component versions.

It is not used for:

- Vite entry generation
- runtime module discovery
- CSS load behavior
- render graph discovery

## Update rules

CLI updates lockfile when:

- `nazare init` creates initial lockfile scaffolding
- `nazare theme pull` copies or overwrites at least one theme file
- `nazare add` copies or overwrites at least one file for a component

CLI must not silently rewrite lockfile for unrelated local file edits.

For `nazare theme pull`, if all theme files are skipped, command succeeds and lockfile remains unchanged.

When `nazare theme pull` writes at least one file, CLI updates `theme.version`, `theme.source`, `theme.installedAt`, and merges newly written file entries into cumulative `theme.files`.

For `nazare add`, if all files for a component are skipped, that component entry remains unchanged.

When `nazare add` writes at least one file for a component, CLI updates that component entry with current `kind`, `version`, `installedAt`, manifest `dependencies`, and merges newly written file entries into cumulative component `files`.

CLI may refresh metadata fields such as `installedAt`, resolved `ref`, and component `version` when an install or overwrite operation succeeds.

## Drift policy

The lockfile is install history, not proof that local files remain unchanged.

User may edit copied files after install.

Lockfile does not attempt to merge or reconcile local drift automatically.

## Validation rules

CLI must fail validation for:

- missing `schemaVersion`
- unsupported `schemaVersion`
- missing `registry`
- missing `components`
- theme present but missing `version`, `source`, `installedAt`, or `files`
- invalid theme `version` format
- invalid theme `installedAt` timestamp format
- unsafe theme `source` path
- unsafe theme file `path`
- unsafe theme file `source`
- duplicate file path within `theme.files`
- component lock entry missing `kind`, `version`, `installedAt`, `dependencies`, or `files`
- invalid component `version` format
- invalid component `installedAt` timestamp format
- duplicate component key
- duplicate file path within one component
- unsafe component file `path`
- unsafe component file `source`

## Ownership boundary

Lockfile ownership:

- written and read by CLI
- not used by Nazare Vite plugin for build graph decisions

Build graph ownership:

- local theme Liquid files
- local static `{% render %}` graph
- local `data-nazare-use`
- local `nazare:css` section directives
- Nazare Vite plugin scanner and generators
