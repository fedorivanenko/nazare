# @nazare/scan

Fast syntactic scanning for tooling that must answer within a keystroke.

A single pass per file, no dependencies, and no AST allocation beyond the
tokens a caller asks for. Measured against `@shopify/liquid-html-parser` on
five production themes: **100–400x faster, with equal or better fidelity.**

## What it is not

Scanning answers *what does this file mention*. It does not answer *is it
correct*. The build path keeps the Shopify parser for HTML validation, and
script checking keeps the TypeScript compiler — those do semantic analysis,
which is a different job.

## Liquid

```ts
import { scanLiquid, liquidDependencies, LineIndex } from "@nazare/scan";

const { tokens, issues } = scanLiquid(source);
const dependencies = liquidDependencies(tokens);
const span = new LineIndex(source).spanAt(file, dependencies[0].range);
```

`scanLiquid` emits a token stream rather than facts, because dependencies,
settings reads, locale references and the Nazare tag layer are all different
readings of the same tags. Readers (`liquidDependencies`, `liquidSettingsReads`,
`liquidSchema`) are plain functions over those tokens, so a caller that needs
one does not pay for the rest.

The tag vocabulary in `liquid-spec.ts` is copied from the reference parser's own
grammar exports, and a test fails if a parser upgrade makes them drift.

## Two defects it does not reproduce

Found by differential testing against the reference parser on real themes:

- **A filter in a render argument loses the dependency.** `{% render 'card',
  x: y | strip %}` degrades to a dynamic reference in the reference parser, so
  the edge to `card` disappears. That also suppresses unused-file detection
  theme-wide, because one dynamic snippet reference disables it globally.
- **`{% paginate … by section.settings.per_page %}` loses the settings read**,
  because `PaginateMarkup` is not in the reference parser's known-children list.

## Planned

Same token-stream shape, in this order:

- `nazare` — `.nz.liquid` tags, layered over the Liquid tokens
- `script` — JS/TS module syntax, replacing a `ts.createSourceFile` walk
- `style` — CSS class tokens, replacing a postcss parse

`typescript` and `postcss` stay where real analysis needs them.
