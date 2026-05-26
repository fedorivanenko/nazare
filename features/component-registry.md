---
schemaVersion: 1

id: component-registry
title: Component Registry Contract
status: done

dependencies: []

surfaces: {}

invariants:
  - Defines component manifest metadata before component CLI commands consume it
  - Registry metadata is declarative and read-only at install/list time
  - Component file sources stay inside registry-owned component source paths
  - Component destinations stay inside allowed theme component paths
  - Checksums are required for every installable file
  - Does not install, update, remove, or list components

nonGoals:
  - CLI commands for listing, adding, updating, or removing components
  - Fetching component file contents at runtime beyond test fixture validation
  - Lockfile component metadata writes
  - Theme scaffold behavior changes
  - Interactive component selection
  - JSON output mode

codebaseOwnership:
  owns:
    repo:
      - nazare.registry.yml components metadata contract
      - component source files under components/
      - test fixtures for component manifest validation
      - README.md registry/component authoring notes
      - docs/policies/naming-policy.md component naming references when needed

  mustNotModify:
    - bin/nazare.js command behavior except shared parser helpers if implemented with tests
    - theme/default/ scaffold source content
    - user theme files
    - nazare.lock.yml contents in user repos
    - install metadata
---

# Component Registry Contract

## Goal

Define v1 registry manifest shape for installable components so `nazare list` and `nazare add <component>` can rely on one stable metadata contract.

This feature makes registry data authorable and testable, but does not expose new CLI behavior.

---

## Scope

Included:

- `nazare.registry.yml` `components` block contract
- component ID, type, dependency, file path, and checksum metadata rules
- allowed source and destination path rules
- at least one valid fixture/example component in registry metadata if component source files are added
- validation helper coverage or fixture tests for valid/invalid component metadata
- README authoring notes for registry component metadata

### Registry contract

```yaml
components:
  c-button:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-button/snippets/c-button.liquid
        to: snippets/c-button.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
```

Required component fields:

- `version`: SemVer string
- `type`: one of `section`, `snippet`, `package`
- `dependencies`: array of component IDs, empty when none
- `files`: non-empty array

Required file fields:

- `from`: safe relative registry source path under `components/<component-id>/`
- `to`: safe relative theme destination path under an allowed destination root
- `checksum.algorithm`: `sha256`
- `checksum.value`: lowercase 64-character SHA-256 hex digest

Allowed destination roots:

- `sections/`
- `snippets/`
- `templates/`
- `assets/`
- `styles/`
- `scripts/sections/`
- `scripts/snippets/`
- `scripts/behaviors/`

Disallowed destinations in v1:

- `layout/`
- `config/`
- `nazare/`
- package manager files
- root dotfiles
- absolute paths
- paths containing `..` or backslashes

### Naming rules

Use `docs/policies/naming-policy.md`:

- section component IDs use `s-<name>`
- snippet component IDs use `c-<name>`
- package component IDs may be unprefixed, for example `core`
- file stems should match component IDs where applicable

### Dependency rules

- Dependencies reference component IDs in same manifest.
- Component cannot depend on itself.
- Circular dependency graphs are invalid.
- Dependency arrays are sorted in registry files for stable diffs.
- Duplicate dependencies are invalid.

---

## Success behavior

- Registry manifest can contain a valid `components` object.
- Empty registry remains valid as `components: {}`.
- Non-empty registry entries follow required metadata contract.
- Component IDs sort alphabetically in examples and generated docs.
- Validation accepts valid snippet, section, and package component metadata.
- Validation rejects unsafe paths, invalid IDs, invalid SemVer, invalid types, duplicate files, duplicate dependencies, missing checksums, and checksum format errors.
- Feature does not mutate user repos or lockfiles.

---

## Failure behavior

Validation fails when:

- `components` is missing or not an object
- component ID violates naming policy
- `version`, `type`, `dependencies`, or `files` is missing or invalid
- dependency is missing, duplicated, self-referential, or circular
- file `from` path is unsafe or outside `components/<component-id>/`
- file `to` path is unsafe, duplicated, or outside allowed destination roots
- checksum metadata is missing or not SHA-256 lowercase hex

Failure must not mutate registry files, component source files, theme files, lockfile entries, or install metadata.

---

## Verification

Result: done.

- [x] valid empty `components: {}` manifest is accepted
- [x] valid snippet component metadata is accepted
- [x] valid section component metadata is accepted
- [x] valid package component metadata is accepted
- [x] invalid component ID fails validation
- [x] invalid SemVer fails validation
- [x] invalid type fails validation
- [x] missing/duplicate dependency fails validation
- [x] circular dependency graph fails validation
- [x] unsafe source path fails validation
- [x] unsafe/disallowed destination path fails validation
- [x] duplicate destination path fails validation
- [x] missing/invalid checksum fails validation
- [x] docs show canonical registry contract
- [x] no CLI command behavior changes

---

## Architecture notes

This feature should create reusable component metadata validation primitives for later `component-list` and `component-add` work.

Keep validation metadata-only. Do not read component source bytes unless fixture tests intentionally verify checksums for committed example files.

`component-list` should consume component ID, type, version, and dependency validation from this feature. `component-add` should extend same contract by verifying actual file bytes before mutation.

---

## Open questions

None. Real starter components and `description` metadata are deferred until a user-visible component feature needs them.
