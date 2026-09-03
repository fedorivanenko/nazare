# @nazare/theme-intelligence

Analysis-only semantic compiler for Shopify themes.

It parses Liquid, Shopify JSON, CSS/SCSS, and JavaScript; projects language facts into a semantic graph; and answers bounded inspection queries with exact source evidence, coverage, and explicit uncertainty.

## Scope

- Liquid snippets, renders, bindings, expressions, guards, and value flow
- Shopify template and artifact topology
- CSS class selectors
- JavaScript `classList` operations
- GraphQL/metafield references
- Semantic graph assembly, indexing, and inspection

This package does not generate layouts, compile a custom template language, publish themes, or mutate source files.

## Development

```sh
pnpm --filter @nazare/theme-intelligence build
pnpm --filter @nazare/theme-intelligence test
pnpm --filter @nazare/theme-intelligence typecheck
```

Public exports are defined by `src/index.ts`. Experimental fact and topology projections remain explicitly namespaced and are not authoritative replacements for the semantic graph snapshot.
