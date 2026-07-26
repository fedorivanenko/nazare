# Tree-sitter frontend performance baseline

Measured on Node `v24.13.0`, macOS x64. Run:

```sh
pnpm -s build
pnpm --dir packages/compiler benchmark:frontends
```

The benchmark rotates execution order to reduce systematic JIT/GC bias. It
reports parse plus mechanical fact extraction, not only native parse time.

## Committed corpus

10 Nazare files, 3,507 bytes total, 20 measured rounds after 5 warmups:

| Path | ms/file | Relative to legacy |
| --- | ---: | ---: |
| Legacy Shopify parser/frontend extraction | 8.259 | 1.00x |
| Raw Tree-sitter CST + facts | 1.355 | **6.09x faster** |
| Current hybrid Tree-sitter compiler projection | 10.419 | **1.26x slower** |
| Incremental Tree-sitter edit + facts | 2.101 | **3.93x faster** |

The hybrid is slower because it deliberately runs both Tree-sitter and the
Shopify compatibility parse. It is a parity bridge, not the final runtime.

## Large synthetic file

One 112,524-byte Nazare file containing 1,500 repeated HTML/Liquid regions, 5
measured rounds after 2 warmups:

| Path | ms/file | Relative to legacy |
| --- | ---: | ---: |
| Legacy Shopify parser/frontend extraction | 9,683 | 1.00x |
| Raw Tree-sitter CST + facts | 3,143 | **3.08x faster** |
| Current hybrid Tree-sitter compiler projection | 11,207 | **1.16x slower** |
| Incremental Tree-sitter edit + facts | 3,368 | **2.88x faster** |

This run exposed a `node-tree-sitter@0.21.1` direct-string input ceiling at
32,768 UTF-16 code units. `@nazare/source` now always uses the callback input
API in 16,384-code-unit chunks, including the injected HTML parser. A regression
test parses and incrementally edits a source above the old ceiling.

## Cutover interpretation

Raw Tree-sitter is materially faster. The production opt-in bridge is not yet
faster and must not become the default. Remaining performance work:

1. remove the Shopify compatibility parse;
2. avoid full secondary HTML reparsing after incremental edits;
3. profile CST traversal on large files;
4. repeat on Linux/macOS release artifacts and a representative large theme.
