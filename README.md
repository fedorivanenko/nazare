# Nazare

Opinionated Shopify Liquid theme and component registry built for speed.

## Versioning

Nazare CLI version source of truth is `package.json.version`.

Versions use SemVer. Stable release tags must use `vMAJOR.MINOR.PATCH` and match `package.json.version` without the leading `v`.

See [`docs/policies/release-policy.md`](docs/policies/release-policy.md), [`docs/policies/naming-policy.md`](docs/policies/naming-policy.md), and [`docs/policies/generated-files-policy.md`](docs/policies/generated-files-policy.md).

## Install

Nazare CLI requires Node.js and `curl`.

Install latest CLI:

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/refs/heads/main/install.sh | sh
```

Verify install:

```sh
nazare --help
nazare --version
```

## Init

Initialize Nazare files in a theme repo:

```sh
nazare init
```

Create a new theme directory and initialize it:

```sh
nazare init my-theme
```

Use a custom registry origin or ref:

```sh
nazare init --repo github.com/fedorivanenko/nazare --ref refs/heads/main
```

## Theme scaffold

Default registry includes minimal Shopify-only theme scaffold source for future `nazare theme pull`.

Current v1 scaffold source files:

- `theme/default/layout/theme.liquid`
- `theme/default/templates/index.json`
- `theme/default/sections/s-main.liquid`
- `theme/default/config/settings_schema.json`

The scaffold is intentionally thin:

- one layout
- one JSON template
- one starter section
- minimal Shopify settings schema
- no build pipeline files yet

## Update

Update a Nazare-owned CLI install from its originally installed source:

```sh
nazare self update
```

Update to the latest stable release:

```sh
nazare self update latest
```

Update from a specific branch, tag, full ref, or commit SHA:

```sh
nazare self update --source feat/my-branch
```

Verify update:

```sh
nazare --help
nazare --version
```
