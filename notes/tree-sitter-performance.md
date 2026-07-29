# Tree-sitter frontend performance baseline

Historical frontend baseline measured on Node `v24.13.0`, macOS x64 before
the legacy frontend harness was deleted. The benchmark rotated execution order
to reduce systematic JIT/GC bias. It reported parsing plus mechanical fact
extraction and compiler AST projection, not only native parse time.

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
3. establish an absolute cross-platform regression budget for the canonical frontend.

Tree-sitter is the only built-in frontend for Nazare and plain-Liquid
compilation and workspace analysis. `@nazare/scan`, authored-source Shopify
parsing, and `sourceFrontend: "legacy"` were removed after deletion gates passed.

## Incremental update benchmark

Run the committed theme-corpus benchmark on demand or in scheduled CI:

```sh
pnpm -s benchmark:incremental
```

It constructs fresh `ThemeProgram` instances at 1x, 2x, and 4x corpus scales,
warms each instance with three alternating edits, and measures ten further edits
to `snippets/price.liquid`. Input IO is outside the measured samples. Output is
versioned JSON containing cold construction time, edit-time distributions,
work-counter distributions, runtime metadata, and the 4x/1x median growth
ratio.

A single-file sample must report exactly one parsed file. The process also
fails when the default growth ratio exceeds 6. Both checks are machine-stable
signals; absolute milliseconds remain report-only. Every configurable value is
available explicitly:

```sh
pnpm -s benchmark:incremental -- \
  --corpus fixtures/theme-corpus \
  --edit-path snippets/price.liquid \
  --iterations 10 \
  --warmups 3 \
  --scales 1,2,4 \
  --max-growth-ratio 6
```

Scale factors must start at 1 and increase strictly. Scaling duplicates only
blocks, sections, and snippets; singleton theme files remain singleton.
Unknown options and invalid values fail rather than falling back.

## Shopify parser comparison harness

The root dev dependency on `@shopify/liquid-html-parser` exists only for this
benchmark. It is not a compiler/runtime dependency. Run the comparison with an
explicit list of files:

```sh
pnpm -s benchmark:shopify-parser -- --rounds 3 --file-timeout-ms 5000 \
  path/to/theme/sections/header.liquid \
  path/to/theme/snippets/card.liquid > benchmark.json
```

The harness compares `parseSourceDocument()` against the previous compiler's
`toLiquidHtmlAST()` configuration (`mode: "tolerant"` and
`allowUnclosedDocumentNode: true`). File input is loaded before each timed
sample. Each sample runs in a fresh worker, parser order rotates by round, and
the report contains raw samples, medians, throughput, rejection counts, runtime
metadata, and the slowest Shopify parses.

Before measuring batches, Shopify files receive a timeout-aware probe. Files
that exceed the threshold are reported and excluded from both parsers' ratio,
so a hung Shopify parse cannot stall the benchmark or inflate the measured
speedup. Rejected parses remain in the common batch and count toward timing.
Use `--language liquid` when the tested integration uses the plain-Liquid
grammar; the default is `nazare-liquid`.

A local production-corpus run on Node `v24.13.0`, macOS x64 produced:

| Common subset | Tree-sitter median | Shopify median | Relative |
| --- | ---: | ---: | ---: |
| 863 files, 14.91 MB | 8.884 s | 303.120 s | **34.12x faster** |

The source corpus contained 864 files and 15.16 MB, with content SHA-256
`800fb9635ddaa7a147a56bae38dbc21854d454bc7f92f248ed30ea30a3d4f337`.
One Shopify parse exceeded the five-second per-file threshold and was reported
separately. Tree-sitter rejected two files on the 863-file common subset while
Shopify threw on 58. The measured samples drifted upward as the machine heated;
the ratio remained close to the prior run's 34.94x result. The ratio excludes
the timeout file and includes Shopify's early failures. Treat it as a
machine/corpus result, not a universal constant.
