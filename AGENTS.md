# Agent Instructions

## Versioning

Follow `docs/policies/release-policy.md` for CLI versioning and releases.

- `package.json.version` is the source of truth for Nazare CLI version.
- Use SemVer for all CLI versions.
- Stable release tags are required and must use `vMAJOR.MINOR.PATCH`.
- Stable release tags must match `package.json.version` without the leading `v`.
- Do not add rollback behavior unless a feature explicitly defines it.
