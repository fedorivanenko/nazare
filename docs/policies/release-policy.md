# Release Policy

## Versioning

`package.json.version` is the CLI version source of truth.

Use SemVer: `MAJOR.MINOR.PATCH`. Prerelease syntax is allowed when needed.

Only CLI/install behavior changes require a new package version and Git tag.

Registry content changes do not require a CLI release by default, including changes under:

- `theme/default/`
- `nazare.registry.yml`
- feature docs
- policies
- tests

Create a CLI release for registry content only if the installed CLI or installer must change to consume that content correctly.

## Release source

Development installs use `refs/heads/main`.

Stable releases use Git tags.

`nazare self update` updates from the originally installed ref/source recorded in install metadata.

## Tags

Stable release tags are required.

Tag format: `vMAJOR.MINOR.PATCH`.

The tag version must match `package.json.version` without the leading `v`.

## GitHub release workflow

Always write release notes to a temporary Markdown file and pass it with `gh release create --notes-file <path>`. Do not pass Markdown notes inline with `--notes "..."`; backticks in inline notes can be evaluated by the shell.

Example:

```sh
cat > /tmp/nazare-vX.Y.Z-notes.md <<'EOF'
## Fixes
- Release note with `inline code` safely preserved.
EOF

gh release create vX.Y.Z \
  --target main \
  --title "vX.Y.Z" \
  --notes-file /tmp/nazare-vX.Y.Z-notes.md
```

After creation, verify the release body with:

```sh
gh release view vX.Y.Z --json url,tagName,name,publishedAt
```

## Compatibility

Patch: CLI or installer bug fixes only.

Minor: additive CLI commands or flags.

Major: breaking CLI behavior.
