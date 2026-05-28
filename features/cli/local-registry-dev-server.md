---
schemaVersion: 1

id: local-registry-dev-server
title: Local Registry Dev Server
status: done

dependencies:
  - cli-init
  - component-registry
  - component-list
  - component-add
  - theme-pull

surfaces:
  devCli:
    - nazare-dev registry serve [--host <host>] [--port <port>] [--root <path>]
  cli:
    - nazare init --repo <http-url> --ref <ref>

invariants:
  - Serves registry files from a local checkout without requiring GitHub
  - Uses localhost-only binding by default
  - Reads files only; never writes registry, theme, component, config, or lockfile content
  - Rejects unsafe file paths before reading from disk
  - Keeps registry checksum verification in existing consumer commands
  - Existing GitHub registry resolution remains compatible

nonGoals:
  - Full Git smart HTTP protocol support
  - Git object, commit, branch, or tag emulation in the initial local-server version
  - Publishing, pushing, or mutating a registry
  - Authentication, TLS termination, or public network hardening
  - Watch mode, live reload, or browser UI
  - Component install/update behavior changes beyond local registry fetching
  - JSON output mode

codebaseOwnership:
  owns:
    repo:
      - packages/nazare-dev/ registry serve package and binary
      - packages/nazare/ HTTP registry repo parsing and raw-file resolution
      - package.json, package-lock.json, and workspace release metadata
      - README.md local registry development instructions
      - test/ CLI local registry server tests

  mustNotModify:
    - component registry metadata contract except fixtures needed for tests
    - theme/default/ scaffold source content
    - component source content under components/
    - user theme files
    - nazare.lock.yml component or theme metadata semantics
    - install metadata
---

# Local Registry Dev Server

## Goal

Let registry authors test local Nazare registry changes from real consumer projects before pushing to GitHub.

The dev server exposes a local HTTP endpoint that existing consumer commands can use as a registry source. Consumers download the manifest and referenced registry files from the local checkout instead of `raw.githubusercontent.com`.

---

## Scope

Included:

- `nazare-dev registry serve [--host <host>] [--port <port>] [--root <path>]`
- HTTP registry origins in `nazare.config.yml` and `nazare.lock.yml`
- raw-file download support for local HTTP registry origins
- safe file serving for registry manifest, theme scaffold sources, and component sources
- README instructions for serving a registry checkout and initializing a separate consumer project against it
- Vitest coverage for server behavior and consumer registry reads

### Command contract

```sh
nazare-dev registry serve
nazare-dev registry serve --port 0
nazare-dev registry serve --host 127.0.0.1 --port 7331 --root /path/to/nazare
```

Defaults:

- `--host`: `127.0.0.1`
- `--port`: `7331`
- `--root`: current working directory

On start, command prints:

```text
Serving Nazare registry from <root>
Registry URL: http://127.0.0.1:<chosen-port>
Consumer init: nazare init --repo http://127.0.0.1:<chosen-port> --ref refs/heads/main
```

### HTTP contract

Local HTTP registry origins use the existing registry fields:

```yaml
registry:
  name: nazare
  repo: http://127.0.0.1:<chosen-port>
  ref: refs/heads/main
  manifest: nazare.registry.yml
```

Consumer raw-file resolution:

- GitHub origin stays unchanged: `https://raw.githubusercontent.com/<owner>/<repo>/<ref>/<path>`
- HTTP origin resolves to: `<repo>/raw/<path>?ref=<encoded-ref>`

Required server routes:

- `GET /healthz` returns `200 OK` with plain text `ok`
- `GET /raw/<path>?ref=<encoded-ref>` returns the file bytes from `<root>/<path>`

`ref` is accepted for compatibility with the existing registry contract, but v1 serves the working tree at `--root`; it does not check out or emulate Git refs.

Path rules:

- paths must be relative after the `/raw/` prefix
- absolute paths, `..`, empty paths, backslashes, and directory requests are rejected
- missing files return `404`
- unsafe paths return `400`
- unsupported methods return `405`

---

## Success behavior

- `nazare-dev registry serve` starts a read-only HTTP server from the chosen root.
- Server validates that `<root>/<manifest>` exists before listening.
- Server prints the registry URL and exact `nazare init --repo ... --ref ...` command for consumers.
- `nazare init --repo http://127.0.0.1:<chosen-port> --ref refs/heads/main` writes HTTP registry metadata.
- `nazare list`, `nazare add <component>`, `nazare update <component>`, `nazare theme pull`, and `nazare update theme` fetch registry files from the local server when config uses an HTTP origin.
- Existing GitHub-backed registries keep existing behavior.
- Consumer commands continue to validate registry metadata and SHA-256 checksums before mutation.
- Server exits `0` on clean `SIGINT` or `SIGTERM` shutdown.

---

## Failure behavior

Exit non-zero before listening when:

- `--host` is missing a value
- `--port` is missing, non-numeric, less than `0`, or greater than `65535`
- `--root` is missing, absent, or not a directory
- manifest file is missing under `--root`
- port bind fails

Consumer commands exit non-zero before mutation when:

- HTTP registry URL is invalid
- local registry request fails or times out
- server returns non-2xx for a required file
- fetched manifest, component metadata, theme metadata, or file checksum is invalid

Failure must not mutate served registry files, component sources, theme scaffold sources, user theme files, lockfiles, or install metadata.

---

## Verification

Result: done.

- [x] `nazare-dev registry serve --port <free-port>` serves `/healthz`
- [x] server refuses missing manifest root before listening
- [x] server returns manifest bytes for `GET /raw/nazare.registry.yml?ref=refs%2Fheads%2Fmain`
- [x] server returns component/theme source bytes for safe paths referenced by the manifest
- [x] server rejects `..`, absolute, empty, backslash, and directory paths
- [x] server returns `404` for missing safe files
- [x] server returns `405` for unsupported methods
- [x] `nazare init --repo http://127.0.0.1:<port> --ref refs/heads/main` writes HTTP registry metadata
- [x] `nazare list` reads registry manifest from the local server
- [x] `nazare add <component>` reads component source files from the local server and preserves checksum validation
- [x] `nazare theme pull` reads theme source files from the local server and preserves checksum validation
- [x] existing GitHub registry tests still pass
- [x] clean shutdown returns exit code `0`

---

## Architecture notes

Add a small Node `http` server in a separate dev-tool package, exposed as `nazare-dev`. Keep consumer workflows in `packages/nazare/bin/nazare.js` and do not add dev-server commands to the `nazare` binary.

Keep raw-file resolution centralized so existing registry consumers call one helper. The helper should branch on registry origin type:

- GitHub repo origin: existing GitHub raw URL behavior
- HTTP(S) origin: fetch `${repo}/raw/${filePath}?ref=${encodeURIComponent(ref)}`

`nazare init --repo` validation must accept `http://127.0.0.1:<port>`, `http://localhost:<port>`, and `https://...` HTTP registry origins while preserving existing GitHub repo validation.

The server intentionally serves working tree files and ignores the semantic meaning of `ref` in v1. This keeps v1 useful for local authoring and avoids implementing Git protocol behavior. Git-ref-aware local serving is scoped in `update`.

This adds a separate dev-tool package plus HTTP registry consumer support. The `nazare` consumer CLI change should be a minor release per `docs/policies/release-policy.md`.

---

## Open questions

None.
