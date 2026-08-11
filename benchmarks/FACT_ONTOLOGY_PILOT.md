# Fact ontology pilot

Experimental normalized projection of the current semantic snapshot into:

```text
Artifact
Symbol
Value
Operation
Condition
Source
Fact
```

Primary predicates:

```text
DECLARES
BINDS
DERIVES_FROM
USES
PASSES
CALLS
GUARDED_BY
```

The current snapshot remains authoritative. This pilot tests representational fit and compact query projection; it is not yet a compiler replacement.

Fact ontology contract v2 adds explicit claim evaluation (`static`, `runtime-dependent`, `external-data-required`, or `unsupported`) independently from lexical execution conditionality. Earlier byte measurements were recorded before this small v2 field addition.

## Implementation

- `packages/semantic-compiler/src/experimental/fact-ontology.ts`
  - typed records and predicates
  - executable endpoint/ref validation
  - fact-set coverage
- `packages/semantic-compiler/src/experimental/fact-projection.ts`
  - deterministic adapter from `SemanticGraphSnapshot`
  - revision-bound public Fact refs
  - no internal graph IDs in normalized output
  - source/evidence deduplication
  - snippet, binding, value-flow, condition, render, and argument normalization
- `packages/semantic-compiler/src/experimental/fact-query.ts`
  - compact call aggregation
  - argument-contract aggregation
  - expandable call Fact refs
  - expandable aggregate refs
  - facet-specific render coverage
- `packages/semantic-compiler/tests/fact-ontology.test.mjs`
  - canonical snippet call
  - scoped binding lineage
  - guarded render
  - compact summary and expansion
  - endpoint validation
  - synthetic cross-language DOM attribute roles (`emits`, `reads`, `selects`)

## Real-theme result

Corpus: 131 Liquid files and 556,759 source bytes from Climatic Health.

Normalized records:

| Record | Count |
| --- | ---: |
| Artifacts | 131 |
| Symbols | 1,555 |
| Values | 11,490 |
| Operations | 9,374 |
| Conditions | 2,109 |
| Sources | 12,394 |
| Facts | 34,223 |
| Coverage records | 1,443 |

Serialized sizes:

| Snapshot | Bytes |
| --- | ---: |
| Existing semantic snapshot | 26,002,388 |
| Experimental Fact snapshot | 25,507,123 |

The normalized snapshot is approximately 1.9% smaller despite reified Facts. It is not yet storage-optimized.

One measured projection took 2,270 ms after compilation. Median compact query latency across 20 in-process runs was 8.48 ms. Projection cost is currently too high for eager production use and should be treated as experimental overhead.

## `c-item-price` compact answer

The Fact query reproduced exact ground truth:

```text
calls                16
artifacts             12
conditional           13
unconditional          3
```

Argument contract:

```text
item                   16/16
skip_price_update       5/16
is_hide_savings         4/16
regular_price_adj       2/16
subscription_frequency  2/16
hide_trailing_zeros     1/16
is_show_price_range     1/16
is_small_font           1/16
is_subscription         1/16
price_quantity          1/16
```

Coverage remained facet-specific:

```text
renders                partial
covered artifacts      131/131
complete artifacts     130/131
uncertain artifacts      1/131
reason                  Unexpected Liquid syntax: #
```

Compact response size: 3,413 bytes.

Comparison:

| Projection | Bytes |
| --- | ---: |
| Existing two-page rich dependent response | 53,733 |
| Compact Fact summary | 3,413 |

Reduction: approximately 93.6%. Every call retains a revision-bound Fact ref and exact source offset. Every argument aggregate retains an expandable aggregate ref. Expanding one call restores its assertion, endpoints, evidence, guards, and passed-value Facts.

## Actual Liquid DOM attribute experiment

Second phase added an HTML CST projection inside the Liquid parser. Liquid syntax is replaced with position-preserving placeholders before HTML parsing, retaining exact original offsets. This supports static names with literal, dynamic, mixed, and boolean values. Dynamic attribute-name emission remains explicit partial coverage.

Real-theme result:

```text
markup attribute operations   3,005
markup attribute values       3,005
unique normalized symbols       189
```

`data-variant-id` compact query:

```text
uses             10
artifacts          3
roles              emits: 10
response bytes     1,690 (including coverage)
```

Semantic count matched textual corpus count. Each use retained exact source offset, expandable evidence, emitted value/resolvability, guards, certainty, authority, execution state, and facet coverage.

Markup-attribute coverage:

```text
covered artifacts      131/131
complete artifacts     100/131
uncertain artifacts     31/131
status                 partial
reasons                dynamic attribute names; one unsupported Liquid file
```

Post-attribute snapshot measurements:

| Snapshot | Bytes |
| --- | ---: |
| Existing semantic snapshot | 33,793,256 |
| Experimental Fact snapshot | 33,118,463 |

Observed non-outlier runs varied with host load: compile 6.7–13.1 seconds, Fact projection 2.4–5.7 seconds, and compact query median 10.0–11.7 ms across 20 in-process runs. Projection remains unsuitable for eager production use.

## Actual CSS/SCSS class-selector experiment

Third phase added a bounded PostCSS frontend and Shopify projection:

```text
CSS/SCSS rule
→ exact class-selector fact
→ artifact-scoped css.class Symbol
→ USES(role=selects)
→ compact scoped query
```

Static Liquid class tokens use the same ontology with `USES(role=emits)`, but remain artifact-scoped. Equal class text across Liquid and CSS is intentionally ambiguous without scope; no cross-language join occurs before artifact reachability exists.

Real authored SCSS corpus:

```text
files                         98
class-selector occurrences  752
scoped class symbols         545
compile                     328 ms
Fact projection              62 ms
```

`is-active` result:

```text
semantic selector uses       34
artifacts                     20
compact response bytes    2,070
text matches                  36
comment-only text matches      2
```

Semantic extraction excluded both comment-only matches. Coverage was complete for 97/98 artifacts; one SCSS interpolation produced explicit partial coverage.

Validated syntax includes plain selectors, selector lists, `:is()`, `:not()`, SCSS nesting, `&`, escaped identifiers, attribute-value false-positive exclusion, comments, interpolation boundaries, exact offsets, and work/fact budgets.

## Actual JavaScript class lifecycle experiment

Fourth phase added bounded Acorn extraction and browser-runtime projection:

```text
classList.add      → USES(role=adds)
classList.remove   → USES(role=removes)
classList.toggle   → USES(role=toggles)
classList.contains → USES(role=reads)
classList.replace  → removes + adds
```

Literal class names produce exact artifact-scoped `css.class` Symbols. Runtime arguments produce no guessed symbol and explicit browser-runtime partial coverage. JavaScript, Liquid, and CSS symbols with equal text remain three distinct scoped identities before topology joins.

Real authored JavaScript corpus, excluding minified duplicates:

```text
files                         10
source bytes             307,417
textual classList calls       200
static class Facts            195
scoped class symbols           60
dynamic argument boundaries     9
compile                     339 ms
Fact projection              10 ms
```

Role totals:

```text
adds       77
removes    69
reads      28
toggles    21
```

`is-active` result:

```text
uses             62
adds             22
removes          22
toggles          11
reads             7
compact bytes 3,922
```

Coverage was complete for 8/10 files. Remaining files contained runtime class-name arguments; unknown names remained unavailable rather than becoming missing or guessed data.

## Findings

Validated:

- Seven predicates represent current snippet calls and scoped binding lineage without losing tested semantic truth.
- Synthetic Liquid/JavaScript/CSS operations share one DOM attribute Symbol through `USES` roles without requiring new core predicates.
- Actual Liquid markup extraction projects attribute emission into the same `Symbol → USES(role=emits)` model.
- Actual CSS/SCSS extraction projects selectors through `USES(role=selects)` without adding core predicates.
- Equal Liquid/CSS class text remains separate artifact-scoped Symbols before topology joins.
- Direct JavaScript class lifecycle operations fit the same `USES` predicate through `adds`, `removes`, `toggles`, and `reads` roles.
- Equal Liquid/CSS/JavaScript text remains three separate scoped Symbols before topology joins.
- Fact-level certainty, authority, evaluation (`static` versus runtime/external), lexical execution conditionality, evidence, and guards remain independent.
- Symbol/predicate aggregation produces dramatically smaller agent-facing answers.
- Public Fact refs support targeted expansion without exposing internal graph IDs.
- Coverage can describe render enumeration independently from value-flow completeness.
- Reified Facts do not inherently increase serialized snapshot size versus the current assertion-heavy representation.

Unresolved:

- Adapter currently normalizes the tested Liquid vertical, not every existing semantic relation family.
- Source snapshots usually contain exact offsets but not precomputed line/character positions; expansion needs source access to calculate lines.
- Projection adds multi-second eager work. Direct compiler emission or lazy/indexed projection would be preferable.
- Fact query indexes are currently built in memory and are not incremental.
- Artifact attachment and reachability topology are not implemented.
- JavaScript direct `classList` reads/mutations are validated. DOM attributes, `className`, aliases, helper wrappers, and events remain untested.
- Existing `SourceAuthority` vocabulary is narrower than the proposed conceptual authority vocabulary.

## Decision gate

Continue with the ontology if the next experiments preserve these properties:

1. Liquid binding compact lineage remains lossless.
2. **Passed:** frontend-produced Liquid DOM attribute facts match the validated synthetic `USES` role model.
3. **Passed:** frontend-produced Liquid/CSS class lifecycle facts fit `USES` roles without false joins.
4. **Passed:** direct JavaScript class operations fit role-qualified `USES` facts while dynamic names remain runtime-dependent.
5. Artifact topology can keep attachment/reachability separate from semantic Facts.
6. Lazy or direct Fact production removes most projection overhead.

Do not replace the current snapshot yet.
