---
schemaVersion: 1

id: dev-release-channels
title: Dev Release Channels
status: ready

dependencies:
  - cli-self-update
  - local-registry-dev-server
  - component-update
  - theme-update

surfaces:
  cli:
    - nazare update self --latest [--dev]
    - nazare update self --version <version>
    - nazare update self --source <ref>
    - nazare update theme [--latest] [--dev] [--version <version>] [--source <ref>]
    - nazare update <component> [--latest] [--dev] [--version <version>] [--source <ref>]
  devCli:
    - nazare-dev registry serve [--git-refs]

invariants:
  - packages/nazare/package.json.version remains the single CLI version source of truth
  - Stable releases use SemVer tags without prerelease identifiers
  - Dev releases use SemVer prerelease tags with the dev identifier
  - Stable update commands never select dev prerelease tags unless the user opts in
  - Dev channel selection must be explicit and reversible
  - Registry file updates keep existing checksum validation before mutation
  - Channel or version selection for theme/component updates is applied atomically with the file update
  - Failed update commands must leave registry metadata, lockfile metadata, and user files unchanged

nonGoals:
  - Publishing to npm or another package registry
  - Automatic background updates
  - Updating Shopify theme files without an explicit command
  - Replacing SemVer with a custom version format
  - Supporting multiple named channels beyond stable and dev
  - Keeping legacy `nazare self update`, `nazare theme update`, or `nazare registry use` commands
  - Public network hardening for the local dev server

codebaseOwnership:
  owns:
    repo:
      - packages/nazare/bin/nazare.js unified update command handling
      - packages/nazare-dev/bin/nazare-dev.js git-ref-aware file serving
      - docs/policies/release-policy.md
      - README.md update and local registry instructions
      - test/ CLI and dev CLI release-channel coverage
    install:
      - ~/.nazare install metadata
      - nazare.config.yml registry block when command runs in a consumer repo
      - nazare.lock.yml registry block when command runs in a consumer repo

  mustNotModify:
    - unrelated files under ~/.local/bin
    - unrelated files outside ~/.nazare
    - component or theme source content before the selected update plan is safe to apply
    - user theme files outside the selected update command ownership boundaries
    - component registry checksum semantics
---

# Dev Release Channels

## Goal

Let users move between stable and dev Nazare builds with one version source of truth.

Stable builds use normal SemVer tags, for example `v0.14.0`. Dev builds use SemVer prerelease tags, for example `v0.14.1-dev.3` or `v0.15.0-dev.0`. Users can opt into dev updates, then downgrade back to the latest stable tag through one unified `nazare update <target>` command without manually editing installed CLI or registry metadata.

---

## Scope

Included:

- release policy for stable and dev tags
- `nazare update self --latest` selects the latest stable tag and updates the CLI install
- `nazare update self --latest --dev` selects the latest dev prerelease tag and updates the CLI install
- `nazare update self --version <version>` updates the CLI install from tag `v<version>`
- `nazare update self --source <ref>` updates the CLI install from an explicit branch, tag, ref, or commit SHA
- `nazare update theme --latest` resolves the latest stable registry tag and updates theme files from that tag in one command
- `nazare update theme --latest --dev` resolves the latest dev registry tag and updates theme files from that tag in one command
- `nazare update theme --version <version>` updates theme files from tag `v<version>`
- `nazare update <component> --latest` resolves the latest stable registry tag and updates that component from that tag in one command
- `nazare update <component> --latest --dev` resolves the latest dev registry tag and updates that component from that tag in one command
- `nazare update <component> --version <version>` updates that component from tag `v<version>`
- `--source <ref>` for theme/component updates uses an explicit registry ref for local or branch testing
- local dev server support for serving files from requested Git refs when enabled
- README examples for stable, dev, downgrade, and local-tag testing flows
- Vitest coverage for tag selection, atomic config/lockfile mutation, and safe failure behavior

### Version contract

Allowed stable versions:

```text
0.14.0
14.1.0
```

Allowed dev versions:

```text
0.14.1-dev.0
0.14.1-dev.3
14.2.0-dev.12
```

Tag names must prefix the version with `v`:

```text
v0.14.0
v0.14.1-dev.3
```

`packages/nazare/package.json.version` remains the source for the CLI version embedded in an install. A dev tag must point to a commit whose package version exactly matches the tag without the leading `v`.

### Command contract

Stable CLI update:

```sh
nazare update self --latest
```

Dev CLI update:

```sh
nazare update self --latest --dev
```

Specific CLI version:

```sh
nazare update self --version 0.14.0
```

Stable theme update:

```sh
nazare update theme --latest --force
```

Dev theme update:

```sh
nazare update theme --latest --dev --force
```

Specific theme version:

```sh
nazare update theme --version 0.14.0 --force
```

Stable component update:

```sh
nazare update c-button --latest --force
```

Dev component update:

```sh
nazare update c-button --latest --dev --force
```

Specific component version:

```sh
nazare update c-button --version 0.14.0 --force
```

Explicit source escape hatch:

```sh
nazare update self --source refs/heads/main
nazare update theme --source v0.14.1-dev.3 --force
nazare update c-button --source v0.14.1-dev.3 --force
```

Theme/component commands resolve the selected registry tag or ref, validate checksums, apply file changes, then record registry metadata only after a successful update.

---

## Success behavior

- `nazare update self --latest` resolves the newest stable `vMAJOR.MINOR.PATCH` tag and ignores tags containing prerelease identifiers.
- `nazare update self --latest --dev` resolves the newest `vMAJOR.MINOR.PATCH-dev.N` tag.
- `nazare update self --version <version>` resolves tag `v<version>`.
- CLI update verifies the installed version after update matches the selected tag version.
- `nazare update theme` without channel flags uses the currently configured registry ref.
- `nazare update theme --latest`, `--latest --dev`, `--version <version>`, or `--source <ref>` updates theme files from the selected registry ref and writes registry metadata only after successful file operations.
- `nazare update <component>` without channel flags uses the currently configured registry ref.
- `nazare update <component> --latest`, `--latest --dev`, `--version <version>`, or `--source <ref>` updates the component from the selected registry ref and writes registry metadata only after successful file operations.
- Theme/component update failure leaves `nazare.config.yml`, `nazare.lock.yml`, and local files unchanged, except for existing explicit manual conflict-marker behavior in component update.
- `--check` and `--dry-run` print the selected registry ref and planned operations without mutating files or registry metadata.
- `nazare-dev registry serve --git-refs` serves `GET /raw/<path>?ref=<tag-or-commit>` from the requested Git ref when it exists locally.
- Local server keeps existing working-tree behavior when Git ref serving is not enabled.

---

## Failure behavior

- Invalid version strings or tags exit non-zero with a clear error.
- `--latest` stable resolution exits non-zero when no stable tag exists.
- `--latest --dev` exits non-zero when no dev prerelease tag exists.
- `--version <version>` exits non-zero when the version is not valid SemVer.
- `--dev` without `--latest` exits non-zero.
- `--latest`, `--version`, and `--source` are mutually exclusive.
- Tag/package version mismatch exits non-zero before installing or recording metadata.
- Theme/component update exits non-zero when `nazare.config.yml` or `nazare.lock.yml` is missing or invalid.
- Theme/component update failure must leave config, lockfile, and files unchanged unless the user explicitly chose component manual conflict markers.
- Local server `--git-refs` returns `404` for missing refs or paths and must not fall back to working tree content for that request.
- Local server rejects unsafe paths before invoking Git.

---

## Verification

Result: ready for implementation.

- [x] Stable tag resolver ignores `v0.14.1-dev.3` when `v0.14.0` is the newest stable tag.
- [x] Dev tag resolver selects the highest valid `*-dev.N` prerelease tag.
- [ ] `nazare update self --latest` stores a stable resolved tag in install metadata.
- [ ] `nazare update self --latest --dev` stores a dev resolved tag in install metadata.
- [ ] `nazare update self --version <version>` updates from tag `v<version>`.
- [ ] CLI update rejects a tag whose `packages/nazare/package.json.version` differs from the tag version.
- [ ] `nazare update theme --latest` applies stable-tag theme changes and records registry metadata only after success.
- [ ] `nazare update theme --latest --dev` applies dev-tag theme changes and records registry metadata only after success.
- [ ] `nazare update theme --version <version>` applies version-tag theme changes and records registry metadata only after success.
- [ ] Failed theme update leaves config and lockfile bytes unchanged.
- [ ] `nazare update <component> --latest` applies stable-tag component changes and records registry metadata only after success.
- [ ] `nazare update <component> --latest --dev` applies dev-tag component changes and records registry metadata only after success.
- [ ] `nazare update <component> --version <version>` applies version-tag component changes and records registry metadata only after success.
- [ ] Failed component update leaves config and lockfile bytes unchanged unless manual conflict markers are explicitly chosen.
- [ ] `--check` and `--dry-run` do not mutate registry metadata.
- [ ] Legacy commands are removed from help and command dispatch.
- [ ] `nazare-dev registry serve --git-refs` serves manifest and source files from a local stable tag.
- [ ] `nazare-dev registry serve --git-refs` serves manifest and source files from a local dev tag.
- [ ] README documents upgrade to dev and downgrade to stable flows.

---

## Architecture notes

Use SemVer prerelease syntax instead of custom version strings. `0.14.1-dev.3` is valid SemVer; `0.14-dev-3` is not.

Keep target update ownership explicit inside one command:

- `nazare update self ...` updates the CLI install under `~/.nazare` and never touches theme/component files.
- `nazare update theme ...` resolves the selected registry ref, validates theme files, applies theme mutations, then records registry and theme lockfile metadata after success.
- `nazare update <component> ...` resolves the selected registry ref, validates component files and dependencies, applies component mutations, then records registry and component lockfile metadata after success.

Tag resolution should use one helper that returns ordered stable or dev tags. Stable filtering must exclude any version with a prerelease segment. Dev filtering must require prerelease identifier `dev` and numeric prerelease counter.

For local dev server Git-ref reads, prefer `git show <ref>:<path>` from the registry root after validating that `<path>` is safe. Do not shell-concatenate user input. Use argument arrays. Preserve existing read-only server behavior.

Config and lockfile updates should be atomic with file updates: compute the target registry, operation plan, file writes/deletes, and final config/lockfile bytes first. If validation or safety checks fail, write nothing. If file writes fail, do not advance registry or lockfile metadata.

---

## Open questions

None. Dev tag resolution selects the latest dev tag globally. `--latest` and `--latest --dev` use the default GitHub registry repo when updating theme/component targets.
