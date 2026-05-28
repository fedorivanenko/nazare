---
schemaVersion: 1

id: component-add
title: Add Component
status: done

dependencies:
  - cli-install
  - cli-init
  - theme-scaffold
  - theme-build-plugin
  - theme-build-pipeline
  - theme-pull
  - component-registry
  - component-list

surfaces:
  cli:
    - nazare add <component>

invariants:
  - Requires initialized repo
  - Reads registry origin from nazare.config.yml
  - Uses current registry manifest components block
  - Validates requested component and dependencies before mutation
  - Verifies component file checksums before mutation
  - Never overwrites untracked local files
  - Never overwrites modified installed component files
  - Writes lockfile component metadata only after successful file writes
  - Leaves theme lockfile metadata unchanged

nonGoals:
  - Updating or removing components
  - Adding or updating theme scaffold files
  - Merging user modifications
  - Adopting pre-existing local component files
  - Interactive conflict prompts
  - JSON output mode

codebaseOwnership:
  owns:
    repo:
      - bin/nazare.js add command handling
      - README.md add instructions
      - test/ CLI add tests
      - nazare.registry.yml components metadata
      - nazare.lock.yml components metadata in user theme repo

  mustNotModify:
    - theme/default/ scaffold source content unless adding registry component source under a later component source path
    - nazare.lock.yml theme metadata
    - existing modified user theme files
    - untracked local files at component target paths
    - install metadata
---

# Add Component

## Goal

Add `nazare add <component>` to install a registry component discovered by `nazare list`.

Install must be safe: validate registry metadata, verify checksums, plan all writes, refuse ambiguous paths, install dependencies, then record ownership in `nazare.lock.yml`.

---

## Scope

Included:

- `nazare add <component>`
- registry resolution from `nazare.config.yml`
- current manifest `components` block validation
- component ID validation via `docs/policies/naming-policy.md`
- dependency planning
- checksum verification for every component file
- safe copy only when target paths are absent or already owned and unchanged
- idempotent no-op for unchanged installed component graphs
- component lockfile metadata after successful install
- README instructions and Vitest coverage

Follow `docs/policies/cli-command-policy.md`: flat registry verbs operate on components; theme and CLI lifecycle commands stay namespaced.

### Registry contract

```yaml
components:
  c-button:
    version: 1.0.0
    type: snippet
    dependencies: []
    files:
      - from: components/c-button/c-button.liquid
        to: snippets/c-button.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
```

Required component fields: SemVer `version`, `type` (`section`, `snippet`, `package`), `dependencies` array, non-empty `files` array, safe `from`/`to` paths, and SHA-256 checksum metadata.

Allowed destination roots:

- `sections/`
- `snippets/`
- `templates/`
- `assets/`
- `styles/`
- `scripts/sections/`
- `scripts/snippets/`
- `scripts/behaviors/`

Disallowed in v1: `layout/`, `config/`, `nazare/`, package manager files, and root dotfiles.

### Lockfile contract

```yaml
components:
  c-button:
    version: 1.0.0
    type: snippet
    installedAt: "2026-05-26T00:00:00.000Z"
    updatedAt: "2026-05-26T00:00:00.000Z"
    dependencies: []
    files:
      - path: snippets/c-button.liquid
        source: components/c-button/c-button.liquid
        checksum:
          algorithm: sha256
          value: <sha256>
```

Local file state uses lockfile checksum as authority: matching = unmodified; differing = modified; absent = missing; absent from component lockfile = untracked.

### Operation rules

- Missing requested component/dependency, circular dependency, invalid metadata, unsafe path, duplicate path, missing file, or checksum mismatch -> fail before mutation.
- New target absent locally -> copy and track.
- New target exists untracked -> fail.
- Target owned by another component with incompatible source/checksum -> fail.
- Requested component already installed and unchanged -> no-op.
- Requested component already installed but registry version/checksum changed -> fail; update is separate feature.
- Installed planned file modified or missing -> fail.
- Installed unchanged dependency -> reuse.
- Missing dependency -> install in same transaction.

---

## Success behavior

- Resolves registry, validates component graph, verifies registry bytes, and plans all operations before mutation.
- Copies planned files and creates parent directories.
- Installs dependencies before requested component in lockfile order.
- Prints installed component IDs and written paths.
- Exits `0` on install or unchanged no-op.

After mutation:

- `components.<id>.version`, `type`, and `dependencies` come from manifest.
- `installedAt` and `updatedAt` are RFC 3339 timestamps.
- file `path`, `source`, and `checksum` come from verified manifest entries.
- `registry` and `theme` lockfile metadata are unchanged.

---

## Failure behavior

Exit non-zero before mutation when:

- repo lacks `nazare.config.yml` or `nazare.lock.yml`
- config, lockfile, registry origin, manifest, or `components` block is invalid
- requested component ID is missing, invalid, or absent from registry
- dependency graph is invalid or circular
- component metadata, paths, files, or checksums are invalid
- target path exists untracked
- target path has incompatible component ownership
- planned installed file is modified or missing
- installed component differs from current registry and would require update

Failure must not mutate component files, theme files, lockfile entries, or files outside planned component destinations.

---

## Verification

Result: done.

- [x] valid component installs files and lockfile metadata
- [x] dependency installs with requested component
- [x] unchanged installed component is no-op
- [x] missing component fails before mutation
- [x] invalid component ID fails before mutation
- [x] invalid registry metadata fails before mutation
- [x] checksum mismatch fails before mutation
- [x] unsafe/disallowed destination fails before mutation
- [x] duplicate destinations fail before mutation
- [x] existing untracked target fails before mutation
- [x] modified installed dependency fails before mutation
- [x] missing installed dependency file fails before mutation
- [x] installed component needing update fails before mutation
- [x] circular dependencies fail before mutation
- [x] standard validation failures mutate nothing

---

## Architecture notes

Reuse `theme-pull` primitives for config, lockfile, registry fetch, manifest parsing, safe paths, file copy, checksum calculation, and lockfile writes.

Plan: validate args/init -> resolve registry -> validate component graph -> topologically sort dependencies -> verify checksums -> check local/lockfile ownership -> build write plan -> write files -> write lockfile.

Do not compare local files to current registry to detect edits; lockfile checksum is modification authority.

`nazare add` is install-only. Future `nazare update <component>` handles installed component version changes.

This additive CLI command should be a minor release per `docs/policies/release-policy.md`.

---

## Open questions

None. v1 has no `--force`; untracked targets fail. Dependency components are first-class lockfile entries.
