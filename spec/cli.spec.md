# Nazare CLI Spec

## Purpose

Nazare CLI manages relationship between a user theme repo and the Nazare registry origin.

Its job is limited to init, pull, add, and explicit overwrite choices for theme and component files that come from the registry.

The CLI copies registry theme files and components into the user repo. After copy, the user owns the files. The CLI tracks component origin and installed component versions, but build/runtime integration is derived from local theme files by Vite and the Nazare Vite plugin.

## Registry contents

Registry contains two main pieces:

- Registry theme
  Minimal Liquid theme scaffold and required infrastructure to run, build, and extend theme
- Registry components
  Installable snippets, sections, scripts, assets, and other component files

Theme config schema is defined in `spec/theme-config.spec.md`.

Theme scaffold requirements are defined in `spec/theme-scaffold.spec.md`.

Registry manifest schema is defined in `spec/registry-manifest.spec.md`.

Component package contents rules are defined in `spec/component-package.spec.md`.

Test plan is defined in `spec/test-plan.spec.md`.

## Actions

### CLI

- Update the CLI

### Theme

- Pull theme files from registry origin
- Explicitly overwrite theme files from origin

Theme files are user-owned after pull. The CLI does not silently synchronize theme files with origin changes.

### Components

- List components available in registry
- Add component to theme
- List installed theme and components
- Check for component version changes from origin
- Check component dependencies and install them in bulk
- Overwrite existing component files explicitly from origin

Dependency resolution is automatic during component add. File conflicts from both requested components and dependencies require explicit overwrite behavior.

For v1, `nazare list` outputs component names with origin versions only. `nazare installed` outputs installed item names with installed versions only, including theme when present. `nazare outdated` outputs installed item names with installed and origin versions, including theme when present.

Text output sort order:

- `list`: by `name` ascending
- `installed`: theme first when present, then components by `name` ascending
- `outdated`: theme first when present, then components by `name` ascending

## Validation ownership

CLI validates origin relation and install state:

- `nazare.config.yml` schema
- `nazare.lock.yml` schema
- `nazare.registry.yml` schema
- registry fetch and manifest resolution
- component existence
- dependency graph validity
- source file existence in registry
- destination path safety
- version field format in manifest
- theme block existence for `nazare theme pull`

CLI does not validate local theme build graph metadata.

That validation belongs to the Nazare Vite plugin.

## Component install model

Component install copies local source files into the theme.

When `nazare add` is called, the CLI resolves requested components plus transitive dependencies from the registry manifest before any files are copied.

Component files may include:

- `sections/*.liquid`
- `snippets/*.liquid`
- `scripts/sections/*.js`
- `scripts/snippets/*.js`
- `assets/*`

After install, copied files are user-owned. Registry updates are not auto-reconciled with local edits.

If target file exists, CLI requires explicit choice:

- skip
- overwrite
- all
- none

Default action is skip.

Conflict prompts are per file, not per component or per dependency.

Before writing files, CLI must preflight the full operation and collect file conflicts. This avoids partial writes when a later conflict cannot be resolved.

Interactive TTY behavior:

- prompt for each conflict unless a bulk choice has been selected
- `skip` leaves that file unchanged
- `overwrite` writes that file from origin
- `all` overwrites this and all remaining conflicts in the current command
- `none` skips this and all remaining conflicts in the current command

Non-interactive behavior:

- `--yes` resolves all conflicts as overwrite
- without `--yes`, any unresolved conflict fails before writing files
- unresolved conflict failure uses exit code `4`

Skipped conflicts are successful command outcomes unless the user cancels or a conflict is unresolved.

## Build boundary

CLI does not own build, runtime wiring, or generated build artifacts.

CLI does not generate:

- `scripts/theme.js`
- `styles/<section-name>.css`
- `snippets/section-css.liquid`
- `snippets/section-css-preloads.liquid`
- lazy JS chunk mappings

These are owned by Vite and the Nazare Vite plugin and are derived from local theme files, not from CLI install state.

## Ownership boundaries

CLI owns:

- theme initialization via config and lockfile creation
- registry fetch
- theme pull flows
- component add flows
- component copy
- dependency resolution
- install manifest / lockfile
- installed component version tracking
- explicit overwrite choices during file conflicts

Nazare Vite plugin owns:

- scanning local Liquid files
- following static `{% render %}` references
- extracting `data-nazare-use`
- extracting section `nazare:css` directives
- generating CSS entries
- generating `section-css` Liquid bridge snippets
- producing lazy JS chunks

Theme/user owns:

- copied Liquid files
- copied JS files
- copied assets
- local modifications after install

## Registry fetch model

CLI resolves configured registry origin from `nazare.config.yml` as snapshot of `repo` at `ref`, reads `manifest` from that snapshot, and uses that snapshot for theme and component operations.

`nazare.config.yml` is source of truth for future origin resolution. `nazare.lock.yml` stores installed provenance and may contain older registry values.

If config registry fields differ from lockfile registry fields, CLI must continue using config values and warn that installed provenance differs from current configured origin. This is not a validation error by itself.

V1 supports public GitHub registry repos. Accepted `repo` forms are defined in `spec/theme-config.spec.md`.

Supported `ref` forms in v1 are branch, tag, and commit sha.

CLI may use a local cache of resolved registry snapshots. Cache storage details are implementation details in v1.

Private registry authentication flow is not specified yet.

## Manifest / lockfile role

Theme config schema is defined separately in `spec/theme-config.spec.md`.

Registry manifest schema is defined separately in `spec/registry-manifest.spec.md`.

Theme lockfile schema is defined separately in `spec/theme-lockfile.spec.md`.

The lockfile stores install history and registry origin provenance at install time.

It tracks:

- installed component name
- source registry component
- installed component version
- copied file list
- dependencies installed by CLI

It does not define build graph truth. Build graph truth comes from local files and Nazare Vite plugin scanning.

## Versioning behavior

In v1, source selection and version tracking are separate concerns.

- registry `ref` selects source snapshot
- `theme.version` and component `version` are metadata read from manifest and stored in lockfile
- `nazare add <component>` installs from configured registry `ref`
- `nazare outdated` lists installed theme and component versions against current origin theme and component versions at configured registry `ref`
- `nazare add <component>@version` is not supported

## Commands

Suggested v1 commands:

```bash
nazare init [name]
nazare theme pull
nazare list
nazare add <component>
nazare outdated
nazare installed
nazare self update
```

Aliases may exist for compatibility:

```bash
nazare pull <component>
nazare registry list
nazare registry pull <component>
```

## `init` behavior

`nazare init [name]` initializes Nazare relationship in a theme repo.

It creates project directory when `name` is provided, writes `nazare.config.yml` and `nazare.lock.yml`, and does not pull theme files automatically.

`init` does not care whether target directory is empty. It only checks whether `nazare.lock.yml` already exists at target location.

After `init`, user must explicitly run `nazare theme pull` to copy theme files from origin.

## `theme pull` behavior

`nazare theme pull` copies theme files from configured registry origin into current theme repo and updates lockfile theme metadata.

Theme file conflicts require explicit overwrite behavior.

For v1, conflict prompt choices should include per-file `skip` and `overwrite`, plus bulk `all` and `none` behavior for remaining conflicts.

Lockfile theme metadata updates only when at least one theme file is actually copied or overwritten. If all files are skipped, command succeeds and lockfile remains unchanged.

`lockfile.theme.files` records only theme files actually copied or overwritten by the CLI. It is cumulative across pulls and does not remove previously tracked files when later pulls skip them.

## `add` behavior

`nazare add <component>` resolves requested component plus transitive dependencies from configured registry origin.

For each file in requested components and dependencies:

- missing target path is copied
- existing target path requires explicit prompt

For v1, conflict prompt choices should include per-file `skip` and `overwrite`, plus bulk `all` and `none` behavior for remaining conflicts.

Lockfile component metadata updates only for components where at least one file is actually copied or overwritten. If all files for a component are skipped, that component entry remains unchanged.

Component file tracking is cumulative across adds and overwrites and records only files actually written by the CLI.

If requested component or dependency has skipped files, CLI should warn that resulting local theme state may be incomplete relative to origin.

## Flags

V1 standard flags:

- `--yes`
- `--json`

`--yes` auto-accepts overwrite for all file conflicts in the current command.

In non-interactive contexts, `--yes` is required for commands that would otherwise prompt for conflicts. Without `--yes`, those commands fail before writing files.

`--json` requests machine-readable output for `nazare list`, `nazare installed`, and `nazare outdated`.

V1 JSON success output shape:

```json
{
  "items": []
}
```

V1 JSON item shapes:

- `list`: `{ "name": string, "version": string }`
- `installed`: `{ "kind": "theme" | "section" | "snippet" | "utility", "name": string, "version": string }`
- `outdated`: `{ "kind": "theme" | "section" | "snippet" | "utility", "name": string, "installedVersion": string, "originVersion": string }`

Sort order:

- `list`: sort by `name` ascending
- `installed`: theme first when present, then components by `name` ascending
- `outdated`: theme first when present, then components by `name` ascending

When `--json` is used and a command fails, CLI writes JSON error output:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid nazare.config.yml"
  }
}
```

Error `code` values should be stable uppercase snake case strings. `message` should be human-readable.

## Exit codes

V1 exit codes:

- `0` success
- `1` general command failure
- `2` validation, config, lockfile, or manifest error
- `3` registry fetch or origin resolution error
- `4` user-canceled or unresolved conflict error

A command with skipped conflicts still exits `0` if all conflicts were resolved by explicit `skip`, `none`, or default interactive skip selection.

Version differences reported by `nazare outdated` do not change success exit code.

For v1, `nazare outdated` lists all installed tracked items, not only changed items.

## Remove / update scope

V1 does not include a `remove` command.

V1 does not include a generic `update` command for themes or components.

V1 update behavior is limited to:

- `nazare theme pull`
- `nazare add <component>`
- explicit overwrite choices during file conflicts
- `nazare outdated` for version visibility

V1 does not include separate overwrite commands. Overwrite only happens through conflict choices during `nazare theme pull`, `nazare add <component>`, or `--yes` on those commands.

## CLI error and warning behavior

CLI command errors:

- missing `nazare.config.yml` when command requires initialized theme
- missing `nazare.lock.yml` when command requires initialized theme
- invalid config schema
- invalid lockfile schema
- registry fetch failure
- unresolved registry `ref`
- missing registry manifest
- invalid registry manifest
- missing requested component
- dependency cycle in manifest
- missing component source file in registry
- unsafe destination path
- invalid component version format
- missing theme block for `nazare theme pull`
- invalid theme version format
- target already initialized when `nazare.lock.yml` exists on `init`

CLI warnings:

- skipped conflicting theme file
- skipped conflicting component file
- config registry differs from lockfile registry provenance
- requested component had skipped files, resulting local theme may be incomplete
- dependency had skipped files, resulting local theme may be incomplete

## Non-goals

CLI does not provide automatic reconciliation of drifted user files.

CLI avoids words like:

- sync
- reconcile
- update safely
- merge origin

Preferred words:

- add
- copy
- overwrite
