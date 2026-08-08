# Refactor benchmark baseline

Recorded at `2026-08-05T14:13:40Z` from `feat/big-ass-refactor` at `3dfed65`.

Environment:

```text
Node:         v24.13.0
Platform:     darwin x64
Logical CPUs: 4
```

Numbers are local development baselines, not cross-machine budgets. Compare future candidates on the same machine with the benchmark scripts’ interleaved baseline mode where available.

## Incremental single-file edit

Product replay fixture: `packages/target-shopify/tests/equivalence-replay.test.mjs`.

Edit: append one static Liquid metafield read to `snippets/card.liquid` after warming Shopify semantic and graph products.

```text
Parsed files:             1
Duplicate computed keys:  0
Metafield record delta:  +1
Render-graph edge delta:  0
Observed test wall time: 14.05 ms
```

The wall time includes assertions and test harness work; parsed-file and semantic delta counts are the regression gates.

## Full theme inspection

Command:

```sh
node benchmarks/inspect-theme.mjs --scales 1 --runs 1 --json
```

Corpus: `fixtures/canonical-theme`, 32 theme files, 31 parsed content files, 11,688 output bytes.

```text
Cold wall: 0.9543 s
Cold CPU:  0.87 s
Warm wall: 0.6494 s
Warm CPU:  0.74 s
```

### Revision-scoped workspace index scaling

Recorded on the same local environment after replacing workspace-sized leaf-product keys with a shared revision-scoped path/symbol index.

Command:

```sh
node benchmarks/inspect-theme.mjs --scales 16,64,96 --runs 1 --json
```

```text
Scale        Parsed files  Cold CPU  Warm CPU
fixture-x16           301     3.08 s     3.25 s
fixture-x64         1,165    12.31 s    12.71 s
fixture-x96         1,741    21.06 s    21.61 s
```

From x16 to x96, parsed files grow 5.78× and cold CPU grows 6.84×. This replaces the prior superlinear behavior observed on the pull-request runner, where fixture-x64 and fixture-x96 consumed 48.94 s and 129.62 s CPU respectively.

### Persistent inspection latency gate

Recorded at `2026-08-08` after caching deeply frozen canonical keys, memoizing serialized file identities, and simplifying dependency fingerprint encoding.

Commands:

```sh
node benchmarks/inspect-theme.mjs --scales 64 --runs 1 --json
node benchmarks/inspect-incremental.mjs --scale 64 --runs 20 --json
```

Corpus: fixture-x64, 1,165 parsed content files and 1,166 total query-session files. Initial measurement includes query-session creation plus a complete `inspection()` query. Incremental measurement includes `ProjectSession` update application plus a complete `inspection()` query after adding or removing one metafield read.

```text
Fresh CLI inspection:       2.93 s wall / 3.51 s CPU
Persistent initial query:   2.66 s wall / 2.87 s CPU
Incremental median:       314.39 ms wall
Incremental p95:          342.95 ms wall
Incremental maximum:      357.79 ms wall
```

Automated budgets at fixture-x64:

```text
Persistent initial wall:       ≤ 10,000 ms
Incremental median wall:       ≤    500 ms
```

## Theme scaffold

Command:

```sh
node benchmarks/scaffold-theme.mjs --files 400 --out <temporary-directory>
```

```text
Seed files:      32
Generated files: 368
Total files:     400
Wall:            0.25 s
User CPU:        0.10 s
System CPU:      0.13 s
```

## Parser throughput

Command:

```sh
node --expose-gc packages/source/scripts/benchmark-shopify-parser.mjs \
  --rounds 3 --warmups 1 fixtures/canonical-theme/layout/theme.liquid
```

Corpus: 1 file, 379 bytes, content SHA-256 `167ae627cf4ce73097ca8bbe72c573354a14c5b284840b0b11819b1afe28c20c`.

```text
Tree-sitter median:     0.3259 ms
Tree-sitter throughput: 1.1630 MB/s
Shopify median:         19.8931 ms
Shopify throughput:     0.0191 MB/s
Measured speedup:       61.04×
Rejected files:         0
```
