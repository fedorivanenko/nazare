---
schemaVersion: 1

id: component-list
title: List Components
status: done

dependencies:
  - cli-install
  - cli-init
  - component-registry

surfaces:
  cli:
    - nazare list
    - nazare list --installed

invariants:
  - Requires initialized repo
  - Reads registry origin from nazare.config.yml
  - Lists current registry components by default
  - Does not mutate files or lockfile
  - Does not require theme scaffold

nonGoals:
  - Installing, updating, or removing components
  - Validating component file checksums
  - Fetching component file contents
  - Interactive selection
  - JSON output mode

codebaseOwnership:
  owns:
    repo:
      - bin/nazare.js list command handling
      - README.md list instructions
      - test/ CLI list tests
      - nazare.registry.yml component metadata display contract

  mustNotModify:
    - theme/default/ scaffold source content
    - component files
    - theme files
    - nazare.lock.yml contents
    - install metadata
---

# List Components

## Goal

Add read-only component discovery before `nazare add <component>`.

---

## Scope

Included:

- `nazare list`
- `nazare list --installed`
- registry resolution from `nazare.config.yml`
- metadata-only validation of manifest `components`
- installed state read from `nazare.lock.yml`
- stable human table output
- README instructions and Vitest coverage

Follow `docs/policies/cli-command-policy.md`: flat registry verbs operate on components; theme and CLI lifecycle commands stay namespaced.

Default output:

```txt
Available components:

ID          Type     Version  Status
c-button    snippet  1.0.0    not installed
s-hero      section  1.0.0    installed
```

Empty output:

```txt
No components available in registry.
```

Installed output:

```txt
Installed components:

ID          Type     Version
s-hero      section  1.0.0
```

Empty installed output:

```txt
No components installed.
```

---

## Success behavior

- Resolves registry, reads manifest, validates `components` as object, and exits `0`.
- Sorts component IDs alphabetically.
- Prints `ID`, `Type`, `Version`, and `Status` for available components.
- Status is `installed` when ID exists in lockfile; otherwise `not installed`.
- `--installed` prints lockfile components only and does not require current registry match.
- Empty available/installed lists print clear no-op messages.

---

## Failure behavior

Exit non-zero before output when:

- repo lacks `nazare.config.yml` or `nazare.lock.yml`
- config, lockfile, registry origin, manifest, or `components` block is invalid
- component ID, version, type, or dependencies metadata is invalid
- args include unknown flags or extra operands
- registry cannot be fetched or read

Failure must not mutate files, lockfile entries, or install metadata.

---

## Verification

Result: done.

- [x] `nazare list` prints registry components in stable table order
- [x] installed IDs show `installed` status
- [x] empty registry prints no-components message and exits `0`
- [x] `nazare list --installed` lists only lockfile components
- [x] empty installed list prints no-installed message and exits `0`
- [x] invalid metadata fails before output
- [x] missing/invalid init state fails
- [x] unknown args fail clearly
- [x] command is read-only

---

## Architecture notes

Reuse registry/config/lockfile read primitives from `theme-pull` and component commands.

Validate discovery metadata only. Do not read or checksum component files; install integrity belongs to `component-add`.

---

## Open questions

None. Descriptions and `nazare list --available` are out of scope for v1.
