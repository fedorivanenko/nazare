# Semantic Theme Graph Production Corpus Findings

## Context

Nazare semantic graph version 2 was measured against four production Shopify themes:

- `/Users/fedori/Coding/hyuman/alkamind/alkamind-nazare`
- `/Users/fedori/Coding/hyuman/alkamind/alkamind-old`
- `/Users/fedori/Coding/hyuman/climatic-health`
- `/Users/fedori/Coding/hyuman/ucan`

Measurements used the local CLI command:

```sh
nazare inspect theme . --format json
```

Compiler commits included in the measurement:

- `e88aaca` — semantic theme graph version 2;
- `797ba36` — production-theme inspection hardening.

The second commit fixed three corpus-discovered integration defects:

1. CLI inspection omitted `blocks/`, section-group JSON, and locales.
2. Shopify-generated JSON comment preambles were rejected by `JSON.parse`.
3. Generated Replo `<style>` payloads caused pathological LiquidHTML parsing.

## Corpus measurements

| Theme | Files | Time | JSON output | Nodes | Edges | Errors | Warnings |
|---|---:|---:|---:|---:|---:|---:|---:|
| alkamind-nazare | 237 | 37s | 8.4MB | 2,851 | 6,157 | 4 | 2,060 |
| alkamind-old | 404 | 100s | 60.6MB | 29,835 | 46,712 | 54 | 2,241 |
| climatic-health | 156 | 36s | 8.3MB | 2,700 | 5,867 | 1 | 2,282 |
| ucan | 409 | 219s | 11.6MB | 4,098 | 8,292 | 41 | 910 |

Raw measurement output was written to:

```text
/tmp/nazare-inspect2-alkamind-nazare.json
/tmp/nazare-inspect2-alkamind-old.json
/tmp/nazare-inspect2-climatic-health.json
/tmp/nazare-inspect2-ucan.json
/tmp/nazare-measurements-summary2.json
/tmp/nazare-vision-check.json
```

These `/tmp` paths are ephemeral; this note preserves the conclusions and key metrics.

## Structural query completeness

| Theme | Render targets resolved | Section instances resolved | Block instances resolved | Setting reads resolved | Important-edge evidence coverage |
|---|---:|---:|---:|---:|---:|
| alkamind-nazare | 98.4% | 100% | 100% | 94.1% | 99.1% |
| alkamind-old | 99.0% | 99.7% | 95.0% | 92.8% | 99.7% |
| climatic-health | 100% | 100% | 100% | 96.0% | 99.1% |
| ucan | 96.9% | 99.0% | 93.1% | 98.4% | 99.3% |

The graph architecture is close to the product vision. It can represent and traverse:

```text
Page → Template → SectionInstance → Section
Section/File → RenderSite → Snippet
RenderSite → RenderArgument → ExpectedInput
RenderArgument → Setting or Shopify data origin
SectionInstance → BlockInstance → Block type
Changed artifact → Dependents → Affected pages
```

Static structural resolution is strong. The remaining reliability problems are mainly semantic inference, output size, parser coverage, and performance.

## Findings

### 1. Component input inference is too noisy

Missing-argument diagnostics found in the corpus:

| Theme | `THEME_RENDER_ARGUMENT_MISSING` |
|---|---:|
| alkamind-nazare | 826 |
| alkamind-old | 653 |
| climatic-health | 1,116 |
| ucan | 410 |

Many are false positives caused by branch-local assignments and captures.

Example from `climatic-health/snippets/c-img-srcset.liquid`:

```liquid
{% if image != blank %}
  {% assign max_width = max_width | default: 2000 %}
  {% capture img_srcset %}...{% endcapture %}
  ... reads of max_width and img_srcset ...
{% endif %}
```

The current collector ignores conditional assignments as local bindings. It therefore treats later reads inside the same branch as caller inputs. This one pattern generated hundreds of warnings across render sites.

Required implementation:

- model assignment definitions with lexical/branch ranges;
- suppress a free-variable read when a dominating definition exists in the same branch;
- recognize `capture` as a local definition;
- retain uncertainty when a conditional definition is read outside its branch;
- make alias propagation branch-aware rather than globally accepting or rejecting a conditional alias.

### 2. Expression coverage warnings overwhelm useful diagnostics

`LIQUID_UNSCANNED_SETTINGS_EXPRESSION` counts:

| Theme | Count |
|---|---:|
| alkamind-nazare | 1,164 |
| alkamind-old | 958 |
| climatic-health | 1,018 |
| ucan | 369 |

Sampling showed common supported-looking constructs rather than truly opaque syntax:

- nested `LiquidTag` nodes inside `{% liquid %}`;
- `LogicalExpression` conditions;
- assignment/filter markup;
- dynamic block setting lookups;
- raw tags represented inside `{% liquid %}`.

Required implementation:

- traverse nested `LiquidTag` and `LiquidBranch` markup;
- traverse `LogicalExpression` operands;
- treat known raw tags as deliberately ignored rather than unscanned;
- report unsupported expression shape names in diagnostics;
- aggregate repeated coverage warnings by file/shape for inspect output.

### 3. Locale representation is not canonical

`alkamind-old` generated:

```text
23,837 localeKey nodes
60.6MB graph JSON
```

The same conceptual translation key is represented once per locale file. This violates the vision's canonical-concept goal and dominates output size.

Target model:

```text
LocaleKey concept: products.product.add_to_cart
  → TranslationDefinition in en.default.json
  → TranslationDefinition in de.json
  → TranslationDefinition in fr.json
```

Required implementation:

- one canonical locale-key node per key;
- separate locale translation-definition records/nodes when per-file provenance is needed;
- resolve a Liquid translation reference to the canonical key once, not every locale definition;
- preserve all defining files as evidence;
- expose missing-key and missing-locale-translation queries separately.

### 4. Performance is not production-ready

UCan inspection took 219 seconds. It contains many generated Replo snippets around 256KB each.

Raw-text preprocessing improved one representative Replo chunk from approximately 20 seconds to 3.7 seconds, but whole-workspace latency remains too high.

Required implementation:

1. profile parse, source-fact collection, model building, graph projection, sorting, and JSON serialization separately;
2. add content-hash analysis caching;
3. support parallel per-file collection while preserving deterministic merge order;
4. identify generated raw-heavy files and avoid repeated full-tree walks;
5. offer compact/streaming graph serialization for CLI output;
6. add performance fixtures and budgets.

`analyzeNazareTheme()` is synchronous today, so worker-based parallel collection likely requires an asynchronous workspace API rather than hidden concurrency inside the existing function.

### 5. Parser compatibility still skips real files

Corpus error summary:

- alkamind-nazare: 4 unsupported dependency forms;
- alkamind-old: 30 Liquid parse failures and 8 schema JSON failures;
- climatic-health: 1 unknown schema setting read;
- ucan: 34 Liquid parse failures and 7 dependency/setting errors.

Required implementation:

- cluster parse failures by syntax pattern;
- add minimal representative fixtures for each cluster;
- distinguish unsupported-but-indexable syntax from a complete fact-collection failure;
- continue preserving explicit unknowns rather than fabricating facts.

### 6. Capability/classification results need ground truth

Classifications are present and structurally explainable, but rule confidence is not corpus-calibrated. Known ambiguity remains:

- cart page versus cart drawer;
- one product image versus product gallery;
- generic menu versus primary navigation;
- product card versus full product section.

Required implementation:

- manually label representative files from these four themes;
- record expected capabilities/classifications as golden fixtures;
- measure precision and recall per rule;
- propagate page/containment context into classification evidence;
- do not increase confidence based only on filenames.

## Vision assessment

Current assessment after corpus measurement:

| Dimension | Estimate |
|---|---:|
| Graph architecture | 85% |
| Static structural reliability | 80–90% |
| Component input/interface reliability | 50–60% |
| Configuration influence | 65–75% |
| Capability/classification reliability | 55–65% |
| Impact analysis | 70–75% structural, lower behavioral |
| Performance/readiness | 45% |
| Overall production readiness | approximately 60% |

The canonical graph foundation is close to the vision. The current output is suitable for an experimental architecture browser, but not yet for an authoritative component-interface or change-safety product.

## Implementation order

### Milestone A — semantic signal quality

1. branch-aware assignments and captures;
2. nested Liquid expression coverage;
3. diagnostic aggregation;
4. rerun all four themes and compare warning reductions.

### Milestone B — canonical output size

1. canonical locale-key concepts;
2. translation-definition provenance;
3. compact graph output measurement;
4. ensure unchanged-theme determinism.

### Milestone C — production performance

1. phase profiling;
2. async/parallel file analysis API;
3. content-hash cache;
4. compact/streaming CLI serialization;
5. performance budgets for ordinary and generated themes.

### Milestone D — semantic calibration

1. manually label core queries in the four themes;
2. add golden query fixtures;
3. calibrate capability/classification rules;
4. publish precision, recall, unresolved, and skipped-fact metrics.

## Implementation progress after baseline

Work started immediately after preserving the baseline above.

### Branch-aware local definitions

Implemented:

- lexical branch ranges from LiquidHTML `LiquidBranch` nodes;
- assignment definitions visible only after their definition and within their branch;
- `capture` destination bindings;
- branch-scoped alias propagation;
- loop bindings restricted to the loop body rather than the `else` branch;
- tests for same-branch, sibling-branch, capture, and conditional alias behavior.

Corpus spot rerun results:

| Theme | Baseline missing-input warnings | After branch-aware definitions | Baseline expected inputs | After |
|---|---:|---:|---:|---:|
| climatic-health | 1,116 | 692 | 364 | 255 |
| alkamind-nazare | 826 | 632 | 464 | 357 |

This removes a major false-positive class, but remaining missing-input warnings still need sampling and scope/default analysis.

### Expression walker coverage

Implemented expected handling for nested Liquid tags/branches, raw tags, and logical expressions without double-walking nested tags.

Corpus spot rerun results:

| Theme | Baseline unscanned warnings | After |
|---|---:|---:|
| climatic-health | 1,018 | 7 |
| alkamind-nazare | 1,164 | 2 |

Coverage warnings are now a small actionable set rather than the dominant diagnostic category.

### Canonical locale projection

Implemented:

- one canonical `localeKey` concept per translation key;
- detailed per-file locale translations retained in `ThemeSemanticModel` IR;
- compact inspect projection with sorted `translationPaths` on each canonical key;
- every Liquid translation reference resolves to one canonical key.

Measured on the 26 locale files from alkamind-old:

| Projection | Nodes | Edges | Compact JSON |
|---|---:|---:|---:|
| Per-locale key/translation projection | 25,794 | 47,726 | 52.2MB |
| Canonical inspect projection | 1,957 | 52 | 1.2MB |

Detailed translation provenance remains available in analysis IR without forcing graph consumers to load one node and multiple edges per locale/key pair.

### Parser recovery and inspection throughput

Implemented:

- tolerant inspection parses a masked Liquid-only projection instead of requiring one static HTML tree;
- schema bodies remain intact while generated HTML/CSS/JavaScript text is masked with offsets preserved;
- all 64 baseline parser failures now produce semantic facts;
- strict builds retain full LiquidHTML validation;
- concurrent directory traversal and bounded-concurrency file reads;
- indexed lexical-scope lookup instead of repeated full range scans;
- exhaustive conditional assignment joins and `if`/`elsif`/`unless` guard handling.

Latest large-theme reruns:

| Theme | Baseline runtime | Latest observed runtime | Parse failures | Baseline output | Latest output |
|---|---:|---:|---:|---:|---:|
| alkamind-old | 100s | 114s | 30 → 0 | 60.6MB | 29.8MB |
| ucan | 219s | 69s | 34 → 0 | 11.6MB | 12.4MB |

Alkamind-old now extracts substantially more generated Zipify code, increasing graph size and analysis work despite locale compaction. UCan benefits heavily because Replo HTML no longer enters static HTML-tree parsing.

Latest diagnostic changes:

| Theme | Baseline issues | Latest issues | Baseline unscanned | Latest unscanned | Baseline missing arguments | Latest missing arguments |
|---|---:|---:|---:|---:|---:|---:|
| alkamind-old | 2,325 | 1,241 | 958 | 11 | 653 | 527 |
| ucan | 985 | 436 | 369 | 11 | 410 | 290 |

Recovered Zipify facts expose additional interface candidates that were previously absent rather than proven correct. Remaining missing-argument warnings still require precision sampling.

### Incremental fact cache

Implemented:

- per-file content fingerprints over analyzer revision, file kind, parse mode, and source;
- reusable fact/diagnostic cache for plain Liquid, JSON, locales, and assets;
- changed-file invalidation and deleted-file pruning;
- CLI persistence at `.nazare-out/inspect-cache-v1.json`;
- Nazare components intentionally remain uncached because dependency state affects their analysis.

UCan measurement:

| Run | Runtime | Cache size |
|---|---:|---:|
| Cold | 71.6s | 1.8MB |
| Warm, unchanged | 3.3s | 1.8MB |

### Validation

- 204 compiler tests pass;
- Biome checks pass;
- canonical input-order test remains green.

Worker-based cold parser parallelism remains unimplemented.

## Acceptance target

Before describing Nazare Inspect as production-ready:

- fewer than 10% of diagnostics may be extraction-coverage warnings;
- missing-input precision must be manually measured and exceed an agreed threshold;
- canonical locale representation must avoid per-locale concept duplication;
- a 400-file generated-heavy theme should inspect within an agreed interactive/CI budget;
- every core query in `theme-graph-reqs.md` must have corpus-backed golden answers;
- skipped files and unresolved relationships must remain explicit and queryable.
