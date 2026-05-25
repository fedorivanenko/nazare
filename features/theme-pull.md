---
schemaVersion: 1

id: theme-pull
title: Pull Theme
status: planned

dependencies:
  - cli-install
  - cli-self-update
  - cli-init
  - theme-scaffold
  - theme-build-plugin
  - theme-build-pipeline

surfaces:
  cli:
    - nazare theme pull
    - nazare theme pull --yes

invariants:
  - Theme pull must require an initialized Nazare theme repo
  - Theme pull must read the registry origin from nazare.config.yml
  - Theme pull must copy only files declared by the registry manifest theme block
  - Theme pull must never silently overwrite existing user files
  - Theme files are user-owned after copy
  - Manifest theme.version is required and identifies the registry scaffold version, not the user theme version
  - Lockfile theme metadata must change only when at least one theme file is written
  - Failed theme pull must not partially mutate lockfile metadata when avoidable

nonGoals:
  - Defining the minimal theme scaffold file contents
  - Adding or updating components
  - Implementing nazare add <component>
  - Implementing nazare pull <component>
  - Implementing a generic nazare pull command
  - Implementing nazare theme version
  - Implementing nazare theme update
  - Component dependency resolution
  - Theme drift detection or reconciliation
  - Removing old theme files
  - Adopting existing Shopify themes
  - Implementing the Nazare Vite plugin
  - JSON output mode

codebaseOwnership:
  owns:
    repo:
      - bin/nazare.js theme pull command handling
      - README.md theme pull instructions
      - test/ CLI theme pull tests
      - nazare.lock.yml theme metadata in user theme repo

  mustNotModify:
    - theme/default/ scaffold source content
    - component registry behavior
    - component files not declared by manifest theme.files
    - existing user theme files unless explicitly overwritten by user choice or --yes
    - Vite plugin generated files
    - install metadata
---

# Pull Theme

## Goal

Add `nazare theme pull` so an initialized theme repo can pull the Nazare theme scaffold from the configured registry origin.

This feature owns CLI copy, conflict, validation, and lockfile behavior. The scaffold source files and default manifest file list are owned by theme-scaffold and theme-build-pipeline.

---

## Scope

Included:

- `nazare theme pull`
- `nazare theme pull --yes`
- registry origin resolution from `nazare.config.yml`
- registry manifest read from the resolved origin snapshot
- manifest `theme` block validation
- file copy from registry paths to local theme paths
- interactive conflict handling for existing target files
- lockfile `theme` metadata updates
- README theme pull instructions
- Vitest coverage for theme pull success and failure behavior

### Registry manifest theme block

The command consumes a registry manifest `theme` block:

```yaml
theme:
  version: 1.0.0
  source: theme/default
  files:
    - from: theme/default/layout/theme.liquid
      to: layout/theme.liquid
```

Required fields:

- `theme.version`: exact SemVer 2.0.0 string identifying the registry scaffold version
- `theme.source`: non-empty registry-side scaffold root path
- `theme.files`: non-empty array of file mappings

`theme.version` is provenance and update-visibility metadata for the scaffold copied from the registry. It is not the local user theme version and does not imply that user-owned files still match the registry after edits.

Each `theme.files` entry requires:

- `from`: relative path inside registry repo
- `to`: relative path inside target theme repo

Path rules:

- `from` and `to` must use forward slashes
- `from` and `to` must not be absolute paths
- `from` and `to` must not contain `..`
- `from` must exist in the resolved registry snapshot
- `to` must remain inside the target theme root after normalization
- duplicate `to` paths are invalid

### Conflict choices

When a target file already exists, the command must require explicit conflict resolution.

Interactive choices:

- `skip`: skip the current file
- `overwrite`: overwrite the current file
- `all`: overwrite this and all remaining conflicts
- `none`: skip this and all remaining conflicts

`--yes` must behave like choosing `all` for file conflicts.

---

## Success behavior

- Running `nazare theme pull` in an initialized repo resolves the configured registry origin and reads the configured manifest.
- If the manifest has a valid `theme` block, missing target files are copied from registry `from` paths to local `to` paths.
- Copied files preserve text content exactly as stored in the registry snapshot.
- Existing target files are not overwritten unless the user chooses `overwrite`, chooses `all`, or passes `--yes`.
- Skipped files produce warnings and do not cause command failure.
- A command with all conflicts explicitly skipped exits with code `0`.
- If at least one theme file is copied or overwritten, `nazare.lock.yml` is updated with theme metadata.
- If all theme files are skipped, `nazare.lock.yml` remains unchanged.
- Successful theme pull prints written file paths and exits with code `0`.

Expected lockfile theme metadata after at least one written file:

```yaml
theme:
  version: 1.0.0
  source: theme/default
  installedAt: "2026-05-25T00:00:00.000Z"
  files:
    - path: layout/theme.liquid
      source: theme/default/layout/theme.liquid
      checksum:
        algorithm: sha256
        value: 3b7b7f1f4c8c0d36c9d6f2f3d1b2a1a0c9e8d7f6a5b4c3d2e1f0a9b8c7d6e5f4
```

Lockfile rules:

- `theme.version` is copied from manifest `theme.version` and represents the installed registry scaffold version.
- `theme.version` does not assert that local user-owned files are unchanged from that registry version.
- `theme.source` is copied from manifest `theme.source`.
- `theme.installedAt` is the pull time as an RFC 3339 timestamp.
- `theme.files` records only files actually copied or overwritten by the CLI.
- `theme.files[].checksum.algorithm` is `sha256`.
- `theme.files[].checksum.value` is the SHA-256 checksum of the copied registry file content.
- `theme.files` is cumulative across pulls.
- Existing tracked file entries are updated when that same path is overwritten.
- Previously tracked files are not removed when later pulls skip them.

---

## Failure behavior

- If current directory is not initialized with `nazare.config.yml` and `nazare.lock.yml`, theme pull exits non-zero with a clear error.
- If `nazare.config.yml` is invalid, theme pull exits non-zero with a clear error before writing theme files.
- If `nazare.lock.yml` is invalid, theme pull exits non-zero with a clear error before writing theme files.
- If registry origin cannot be resolved, theme pull exits non-zero with a clear error before writing theme files.
- If registry manifest is missing or invalid, theme pull exits non-zero with a clear error before writing theme files.
- If manifest has no `theme` block, theme pull exits non-zero with a clear error.
- If `theme.version`, `theme.source`, or `theme.files` is invalid, theme pull exits non-zero with a clear error before writing theme files.
- If any theme file path is unsafe, theme pull exits non-zero with a clear error before writing theme files.
- If any declared `from` file is missing in the registry snapshot, theme pull exits non-zero with a clear error before writing theme files.
- In non-interactive mode, if conflicts exist and `--yes` is not provided, theme pull exits non-zero before writing files.
- Failed theme pull must not mutate component lockfile entries.
- Failed theme pull must not mutate files outside declared `theme.files` destinations.

---

## Verification

Result: planned.

- [ ] `nazare theme pull` copies missing manifest-declared theme files
  - Verify with a temp initialized repo and registry fixture.
- [ ] missing `nazare.config.yml` fails before writing files
  - Verify target directory remains unchanged.
- [ ] missing `nazare.lock.yml` fails before writing files
  - Verify target directory remains unchanged.
- [ ] invalid config fails before writing files
  - Verify no theme files are created.
- [ ] invalid lockfile fails before writing files
  - Verify no theme files are created.
- [ ] missing manifest fails before writing files
  - Verify clear error and unchanged target files.
- [ ] missing manifest `theme` block fails before writing files
  - Verify clear error and unchanged target files.
- [ ] invalid `theme.version` fails before writing files
  - Verify SemVer validation.
- [ ] valid `theme.version` is stored in lockfile as scaffold provenance
  - Verify lockfile `theme.version` equals manifest `theme.version` after a write.
- [ ] copied files are stored with SHA-256 checksum metadata
  - Verify lockfile checksum values equal copied file content checksums.
- [ ] unsafe `from` and `to` paths fail before writing files
  - Verify absolute paths, `..`, backslashes, and escaping target root are rejected.
- [ ] duplicate `to` paths fail before writing files
  - Verify clear validation error.
- [ ] existing target file can be skipped
  - Verify local file content remains unchanged and warning is printed.
- [ ] existing target file can be overwritten
  - Verify local file content is replaced and lockfile records the path.
- [ ] conflict choice `all` overwrites remaining conflicts
  - Verify all conflicted files are replaced.
- [ ] conflict choice `none` skips remaining conflicts
  - Verify all remaining conflicted files are unchanged.
- [ ] `--yes` overwrites all conflicts
  - Verify no prompt is required.
- [ ] all skipped conflicts leave lockfile unchanged
  - Verify exact lockfile content before and after.
- [ ] partial writes update lockfile with only written files
  - Verify skipped files are not added to `theme.files`.
- [ ] repeated pulls keep `theme.files` cumulative
  - Verify previously tracked files are not removed after later skips.

---

## Architecture notes

`nazare.theme.pull` is the first command that reads the remote registry origin. It should establish shared internal primitives for future component commands without implementing component behavior in this feature.

Useful shared primitives may include:

- config parsing and validation
- lockfile parsing and validation
- GitHub registry repo normalization
- registry snapshot fetch/read
- manifest parsing and validation
- safe path normalization
- conflict planning and prompt handling
- atomic-ish lockfile write after file copy plan execution

The command should plan and validate all manifest paths before writing any theme file. This avoids partial scaffold writes caused by invalid later entries.

File writes and lockfile writes should be separated. Theme files are copied first according to explicit conflict choices. Lockfile metadata is updated only after the set of actually written files is known.

The registry scaffold lives in this repo for the default registry but is owned by `theme-scaffold` and `theme-build-pipeline`. This feature should treat registry theme files as data declared by the manifest.

Theme files become user-owned immediately after copy. Later pulls can offer overwrite, but must not silently synchronize or reconcile drift.

`nazare theme` is the theme command namespace. This feature implements only `nazare theme pull`. Future features may add `nazare theme version`; `nazare theme update` is defined separately by `theme-update`.

`nazare theme pull` is canonical for theme scaffold install. Bare `nazare pull` remains out of scope to avoid ambiguity with future component install behavior.

