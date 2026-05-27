# Release Workflow

Policies: `docs/policies/release-policy.md`, `docs/policies/testing-strategy.md`.

Release only for CLI/installer behavior changes, or registry changes that require new installed CLI support. Registry content/docs/tests alone usually need no release.

Version: patch = bug fix, minor = additive command/flag, major = breaking behavior. Tag format: `vMAJOR.MINOR.PATCH`.

```sh
# verify
git status --short
pnpm exec vitest run test/features/**/*.test.js --testTimeout=300000
pnpm exec vitest run test/e2e/*.test.js --testTimeout=300000
biome check bin/nazare.js test README.md install.sh docs theme components

# bump
npm version <new-version> --no-git-tag-version
git diff -- package.json package-lock.json

# commit + tag + push
git add package.json package-lock.json
git commit -m "chore: release v<new-version>"
git tag v<new-version>
git push origin main
git push origin v<new-version>

# create GitHub Release notes file first; required to preserve Markdown safely
cat > /tmp/nazare-v<new-version>-notes.md <<'EOF'
## Fixes
- <short release note with `inline code` safely preserved>
EOF

# create GitHub Release; required by `nazare self update latest`
gh release create v<new-version> \
  --title "v<new-version>" \
  --notes-file /tmp/nazare-v<new-version>-notes.md

# verify latest release API
curl -fsSL \
  -H 'Accept: application/vnd.github+json' \
  -H 'Cache-Control: no-cache' \
  "https://api.github.com/repos/fedorivanenko/nazare/releases/latest?x=$(date +%s)" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("tag_name"))'

# smoke test
nazare self update latest
nazare --version
```

Expected API output: `v<new-version>`. Expected CLI output: `<new-version>`.

Note: pushing Git tag alone is not enough. `latest` uses GitHub Releases API. If stale, check `gh release list --limit 5`.
