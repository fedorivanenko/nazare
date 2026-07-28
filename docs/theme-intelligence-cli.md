# Theme intelligence CLI

## Problem

Shopify CLI can run, synchronize, and deploy a theme. Theme Check can validate
individual conventions. Neither answers the maintenance question developers ask
before editing a mature theme:

> If I change this file, what can break?

The compiler already owns a deterministic whole-theme semantic graph. Theme
intelligence turns that graph into direct answers instead of requiring users to
read graph JSON.

## Product goal

Give a Shopify developer a useful answer within one command, without requiring
Nazare syntax, a running store, or knowledge of compiler internals.

```sh
nazare inspect impact snippets/price.liquid
```

The answer includes:

- file kind and whether it is used, unused, an entry point, or not provable;
- direct dependencies;
- direct dependents;
- transitively affected pages;
- diagnostics authored in that file;
- styling and behavior consumers connected through static DOM hooks;
- explicit uncertainty when dynamic Liquid or JavaScript prevents a complete answer.

The default output is concise text. `--format json` emits a versioned projection
for editor integrations and automation.

## UX contract

```txt
nazare inspect impact <theme-relative-file> [theme-root] [--format text|json]
```

Theme root defaults to `nazare.theme.json` `build.sourceRoot`. File path is
always relative to that root. A missing root, missing file, unsupported format,
unsafe root, malformed configuration, or unreadable artifact fails explicitly.

Example:

```txt
Impact: snippets/price.liquid
Kind snippet · usage used · certainty complete
Dependencies (1):
- snippets/money.liquid
Dependents (1):
- sections/main-product.liquid
Affected pages (1):
- templates/product.json
Uncertainty: none
Issues: none
```

## Correctness rules

- Queries project the canonical `InspectNazareThemeResult`; they never rescan
  source or maintain a second dependency model.
- Dependencies and dependents are direct. Affected pages are transitive.
- `unused` is emitted only for file kinds the impact index can prove unused.
- Dynamic references, markup hooks, and script selectors produce
  `certainty: partial`; absence of a static edge is never presented as proof of
  safety.
- CSS and JavaScript are parsed by compiler frontends. Literal classes, ids,
  data attributes, dataset access, local script modules, custom properties,
  events, and custom elements join through the canonical theme model.
- Behavior relationships can add direct file dependencies and dependents, but
  do not broaden affected pages merely because a shared stylesheet or script is
  loaded globally.
- Missing metafield snapshots and other absent external state remain unknown.
- Query execution writes only the existing analysis cache under `.nazare-out`.
- Any analysis error keeps a non-zero process exit status while still printing
  available intelligence.

## Architecture

`@nazare/compiler` exports the pure `getThemeFileImpact(graph, path)` query and
its versioned `ThemeFileImpact` result. CLI owns argument handling and text
rendering. `graph-server` exposes the same projection as the `fileImpact` MCP
tool without reimplementing it.

This split keeps semantic truth in compiler and presentation in client.
Whole-theme source frontends own local extraction; the linker alone owns
cross-language relationships and impact.

## Extension path

Future commands should reuse the same query layer:

```sh
nazare inspect unused
nazare inspect metafields
nazare inspect explain <node-id>
nazare inspect trace <source> <target>
```

Add a command only when it answers a developer question more directly than raw
`inspect theme` output. Do not duplicate graph derivation in CLI.

## Non-goals

- Replacing Shopify CLI, Theme Check, or storefront runtime validation.
- Claiming dynamic Liquid resolution is complete.
- Treating generated JSON as a stable parser API; `source analyze` owns that
  contract.
- Broad repository intelligence outside configured theme source.
