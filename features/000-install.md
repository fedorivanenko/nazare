# 000 — Install Nazare CLI

Status: ready

## Goal

Make `nazare` CLI available in a local theme repo

## Scope

Install Nazare CLI by downloading and running `install.sh` from the registry repo, so users can run:

```sh
nazare --help
nazare init
```

## Codebase ownership

This feature owns:

- `install.sh`
- CLI entrypoint needed for install verification
- README install instructions

This feature may create minimal support files needed to make `nazare --help` work.

This feature must not implement non-install CLI behavior beyond help output and clear placeholder errors.

## Success behavior

User installs Nazare with:

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/install.sh | sh
```

Installer creates or updates a Nazare-owned CLI install.

After install:

```sh
nazare --help
```

prints CLI help and exits with code `0`.

The install is idempotent: running the same install command again leaves a working `nazare` command.

### Owned install paths

Default install paths:

- install directory: `~/.nazare`
- executable shim: `~/.local/bin/nazare`

Installer may create or update files under `~/.nazare`.

Installer may create or replace `~/.local/bin/nazare` only when that file is missing or already points to a Nazare-owned install.

Installer must not overwrite unrelated user files.

## Failure behavior

Installer exits non-zero and prints a clear error when:

- `curl` cannot download `install.sh`
- shell cannot execute installer
- required runtime is missing
- CLI bin cannot be created
- install destination is not writable
- `~/.local/bin/nazare` exists but is not owned by Nazare

Installer prints a clear warning when install succeeds but `~/.local/bin` is not on `PATH`.

## Acceptance criteria

- curl `install.sh` installs Nazare using the documented curl command
- install creates working `nazare --help`
- repeated install remains working
- installer respects owned install path rules
- installer covers listed failure and warning cases
- `README.md` documents install command and Node.js requirement

## Test plan

Manual checks:

1. Remove existing install:

   ```sh
   rm -rf ~/.nazare ~/.local/bin/nazare
   ```

2. Run documented install command:

   ```sh
   curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/install.sh | sh
   ```

3. Verify help works:

   ```sh
   nazare --help
   echo $?
   ```

   Expected: help prints and exit code is `0`.

4. Run documented install command again.

   Expected: install completes and `nazare --help` still works.

5. Verify conflict handling:

   ```sh
   rm -rf ~/.nazare ~/.local/bin/nazare
   mkdir -p ~/.local/bin
   printf '#!/bin/sh\necho other\n' > ~/.local/bin/nazare
   chmod +x ~/.local/bin/nazare
   ```

   Run documented install command.

   Expected: installer exits non-zero and does not overwrite `~/.local/bin/nazare`.

6. Verify unwritable destination handling with a temporary home or install destination.

   Expected: installer exits non-zero and prints a clear error.

7. Cleanup:

   ```sh
   rm -rf ~/.nazare ~/.local/bin/nazare
   ```
