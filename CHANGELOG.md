# Changelog

## v0.1.0-rc.4 — 2026-07-27

- Add the parser-only `nazare-source` CLI and release artifacts.
- Add a dedicated checksum-verifying parser installer.
- Share one schema-versioned analysis implementation between full and
  parser-only CLIs.

## v0.1.0-rc.3 — 2026-07-27

- Build release-native addons on the minimum supported Node.js 20 ABI, fixing
  Linux ARM64 artifact startup under Node.js 20.

## v0.1.0-rc.2 — 2026-07-27

- Compile the pinned Tree-sitter Node runtime as C++20 when no prebuilt binary
  exists, fixing Node.js 24 builds on Linux ARM64.
- Include dependency patches in self-contained release staging.
- Resolve the newest published release candidate in the curl installer.

## v0.1.0-rc.1 — 2026-07-27

First release candidate of Nazare's canonical Tree-sitter source frontend and
distributable CLI.

### Added

- Tree-sitter grammars for Shopify Liquid and Nazare Liquid.
- Fail-closed source documents, Liquid/Nazare facts, embedded regions, exact
  UTF-16 ranges, and incremental edits.
- `nazare source analyze` with file/stdin input and schema-versioned JSON.
- Native Linux x64/ARM64 and macOS x64/ARM64 release artifacts.
- SHA-256 verified curl installer with immutable version directories.
- Production-corpus, package-isolation, installer, and JSON golden tests.

### Changed

- Tree-sitter is the sole authored-source frontend.
- Legacy Shopify parser and scanner compatibility paths were removed.
- Source fact caches now include grammar-aware revision fingerprints.

### Compatibility

- CLI requires Node.js 20 or newer.
- JSON source-analysis schema starts at version `1`.
- This is a release candidate; compiler and non-versioned APIs remain subject
  to change before `v0.1.0`.
