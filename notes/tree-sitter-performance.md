# Tree-sitter frontend performance baseline

Measured on Node `v24.13.0`, macOS x64. Run:

```sh
pnpm -s build
pnpm --dir packages/compiler benchmark:frontends
```

The benchmark rotates execution order to reduce systematic JIT/GC bias. It
reports parsing plus mechanical fact extraction and compiler AST projection,
not only native parse time.

## Committed corpus

10 Nazare files, 3,507 bytes total, 20 measured rounds after 5 warmups:

| Path | ms/file | Relative to legacy |
| --- | ---: | ---: |
| Legacy Shopify parser/frontend extraction | 23.510 | 1.00x |
| Raw Tree-sitter CST + facts | 3.806 | **6.18x faster** |
| Tree-sitter compiler frontend | 10.171 | **2.31x faster** |
| Incremental Tree-sitter edit + facts | 4.719 | **4.98x faster** |

Small-file absolute timings vary with JIT and GC; repeated runs have shown the
Tree-sitter compiler frontend around 2.2–2.3x faster than legacy after removing
the source-level Shopify compatibility parse.

## Large synthetic file

One 112,524-byte Nazare file containing 1,500 repeated HTML/Liquid regions, 2
measured rounds after 1 warmup (exploratory, not a stable CI threshold):

| Path | ms/file | Relative to legacy |
| --- | ---: | ---: |
| Legacy Shopify parser/frontend extraction | 5,141 | 1.00x |
| Raw Tree-sitter CST + facts | 3,171 | **1.62x faster** |
| Tree-sitter compiler frontend | 3,915 | **1.31x faster** |
| Incremental Tree-sitter edit + facts | 2,246 | **2.29x faster** |

An earlier run exposed a `node-tree-sitter@0.21.1` direct-string input ceiling
at 32,768 UTF-16 code units. `@nazare/source` now always uses the callback input
API in 16,384-code-unit chunks, including the injected HTML parser. A regression
test parses and incrementally edits a source above the old ceiling.

## Cutover interpretation

The Nazare compiler and theme workspace now skip source-level Shopify parsing;
Tree-sitter owns declarations, shared Liquid mechanics, theme source facts,
HTML root selection, compiler AST projection, and emission locations. Remaining
performance work:

1. avoid full secondary HTML reparsing after incremental edits;
2. profile CST traversal on large files;
3. monitor the Linux/macOS CI threshold before default cutover.

Tree-sitter is now the default for Nazare and plain-Liquid compilation and
workspace analysis, avoiding `@nazare/scan` and authored-source Shopify parsing.
Passing `sourceFrontend: "legacy"` keeps the old paths available only as
explicit differential oracles until deletion gates pass. CI now rejects a Nazare Tree-sitter
frontend/legacy relative time above `0.9` on both Ubuntu and macOS.
