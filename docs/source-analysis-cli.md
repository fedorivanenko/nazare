# Source analysis CLI

`nazare source analyze` exposes the Tree-sitter source frontend without running
the compiler. It is intended for Shopify CLI wrappers, CI checks, editors, and
other tools that need stable JSON instead of native Tree-sitter objects.

## Install

The installer requires Node.js 20 or newer. Native release artifacts are built
and smoke-tested on Node.js 20, while normal compiler CI also runs on Node.js 24. By default it
selects the newest published release, including release candidates. It downloads
the release artifact for the current operating system and architecture and
verifies the published
SHA-256 sidecar before replacing the active installation.

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/scripts/install.sh | sh
nazare --version
```

Pin a version or installation root:

```sh
curl -fsSL https://raw.githubusercontent.com/fedorivanenko/nazare/main/scripts/install.sh \
  | NAZARE_VERSION=v0.1.0 NAZARE_HOME="$HOME/.nazare" sh
```

The default executable is `$HOME/.nazare/bin/nazare`. Remove
`$HOME/.nazare` to uninstall. Release artifacts include production JavaScript
dependencies and native grammars; pnpm, Python, node-gyp, and C/C++ build tools
are not required at installation time.

## Analyze files

Plain Shopify Liquid is the explicit default:

```sh
nazare source analyze sections/header.liquid
```

Select the Nazare grammar explicitly:

```sh
nazare source analyze components/card.nz.liquid --language nazare-liquid
```

Read UTF-8 source from stdin:

```sh
cat sections/header.liquid \
  | nazare source analyze --stdin --language liquid --format json
```

A file and `--stdin` are mutually exclusive. JSON is currently the only output
format.

## Exit codes

- `0`: syntax facts are authoritative.
- `1`: malformed source, unsupported options, missing input, or an operational error.

Consumers must check both the process status and `authoritative`. Invalid CSTs
fail closed: semantic fact arrays are empty rather than partially projected.

## JSON contract

Every response has `schemaVersion: 1`. Public ranges are half-open JavaScript
UTF-16 code-unit ranges.

Plain Liquid response:

```json
{
  "schemaVersion": 1,
  "file": "sections/header.liquid",
  "language": "liquid",
  "authoritative": true,
  "issues": [],
  "embeddedRegions": [],
  "syntax": {
    "liquid": {
      "authoritative": true,
      "dependencies": [],
      "settingsReads": [],
      "blocks": [],
      "conditionals": [],
      "localBindings": [],
      "renderArguments": [],
      "assetReferences": [],
      "localeReferences": [],
      "docParams": [],
      "reads": [],
      "guards": []
    }
  }
}
```

Nazare responses additionally contain `problems`, `syntax.nazare`, and the
shared `syntax.liquid` facts extracted from the same CST.

`issues` contains Tree-sitter syntax failures. `problems` contains validated
Nazare tag-shape failures such as unsupported script languages. Embedded
regions identify JavaScript, TypeScript, and CSS body/open/close ranges.

Additive fields may appear within schema version 1. Removing or changing the
meaning of an existing field requires a schema-version increment.

## Shopify CLI wrapper

```sh
#!/usr/bin/env sh
set -eu

nazare source analyze "$1" --language liquid --format json > source-analysis.json
shopify theme check
```

For many files, invoke the command once per file today. A future newline-delimited
or directory mode can batch files without changing the versioned per-file
result schema.

## Supported release targets

Artifacts are target-specific because the grammars are native Node addons. Each
release publishes Linux x64, Linux ARM64, macOS x64, and macOS ARM64 artifacts.
The installer selects `<os>-<architecture>` from `linux|darwin` and
`x64|arm64`. Source archives remain available from the matching Git tag for
other systems.
