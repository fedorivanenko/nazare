---
schemaVersion: 1

id: F-000
title: Install Nazare CLI
status: done

dependencies: []

surfaces:
  cli:
    - nazare --help
    - nazare init

invariants:
  - Installer must not overwrite unrelated user files
  - Installer must be idempotent
  - nazare --help must exit with code 0 after successful install
  - Non-install CLI behavior must remain placeholder-only

nonGoals:
  - Implementing nazare init behavior
  - Implementing theme or component commands
  - Managing updates beyond replacing Nazare-owned install files

codebaseOwnership:
  owns:
    - install.sh
    - bin/nazare.js
    - README.md install instructions
    - ~/.nazare
    - ~/.local/bin/nazare when Nazare-owned

  mustNotModify:
    - unrelated files under ~/.local/bin
    - unrelated files outside ~/.nazare
    - non-install CLI command behavior
---

# 000 — Install Nazare CLI

## Goal

Make `nazare` CLI available in a local theme repo.

Users must be able to install Nazare from the registry repo and run `nazare --help` after install.

---

## Scope

Included:

- `install.sh`
- minimal CLI entrypoint needed for install verification
- `nazare --help` output
- clear placeholder errors for non-install CLI behavior
- README install instructions
- idempotent install behavior
- install conflict detection

---

## Success behavior

- User can install Nazare with:

  ```sh
  curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/install.sh | sh
  ```

- Installer creates or updates a Nazare-owned CLI install under `~/.nazare`.
- Installer creates `~/.local/bin/nazare` when missing.
- Installer replaces `~/.local/bin/nazare` only when it is Nazare-owned.
- `nazare --help` prints CLI help and exits with code `0`.
- Running install repeatedly leaves a working `nazare` command.
- Installer prints a clear warning when install succeeds but `~/.local/bin` is not on `PATH`.

---

## Failure behavior

- `curl` download failure exits non-zero with a clear error.
- Missing Node.js runtime exits non-zero with a clear error.
- Missing `curl` exits non-zero with a clear error.
- Unwritable install destination exits non-zero with a clear error.
- CLI bin creation failure exits non-zero with a clear error.
- Existing non-Nazare `~/.local/bin/nazare` exits non-zero and is not overwritten.
- Failed install must not mutate unrelated user files.

---

## Verification

Result: tested and passed.

- [x] curl `install.sh` installs Nazare using the documented curl command
  - Verified with raw branch installer download and branch CLI override.
- [x] install creates working `nazare --help`
  - Verified with `node bin/nazare.js --help` and installed shim in temp `HOME`.
- [x] repeated install remains working
  - Verified by running installer twice in temp `HOME`.
- [x] installer respects owned install path rules
  - Verified conflict test preserves unrelated `~/.local/bin/nazare`.
- [x] installer covers listed failure and warning cases
  - Verified with shell syntax check, missing-path warnings, and conflict failure.
- [x] `README.md` documents install command and Node.js requirement
  - Verified by review.

Commands run:

```sh
sh -n install.sh
biome check bin/nazare.js README.md install.sh
node bin/nazare.js --help
```

Additional checks used temp `HOME` installs, repeated install, conflict handling, and raw branch installer download.

---

## Architecture notes

Installer owns files under `~/.nazare` and a shim at `~/.local/bin/nazare` only when that shim is missing or already Nazare-owned.

The CLI entrypoint is intentionally minimal so install verification can work before broader CLI behavior is implemented.

`install.sh` supports `NAZARE_INSTALL_DIR`, `NAZARE_BIN_DIR`, and `NAZARE_CLI_URL` overrides for testing and non-default install locations.

---

## Open questions

- Should a future release provide npm, Homebrew, or other package manager install paths?
- Should installer support shell profile updates for `~/.local/bin`?
