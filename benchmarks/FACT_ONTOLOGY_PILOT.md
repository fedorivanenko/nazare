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

## Findings

Validated:

- Seven predicates represent current snippet calls and scoped binding lineage without losing tested semantic truth.
- Synthetic Liquid/JavaScript/CSS operations share one DOM attribute Symbol through `USES` roles without requiring new core predicates.
- Fact-level certainty, authority, evidence, and guards remain independent.
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
- Actual CSS, JavaScript, DOM attribute, and event frontends remain untested; only synthetic cross-language Facts were validated.
- Existing `SourceAuthority` vocabulary is narrower than the proposed conceptual authority vocabulary.

## Decision gate

Continue with the ontology if the next experiments preserve these properties:

1. Liquid binding compact lineage remains lossless.
2. Actual frontend-produced DOM attribute facts match the validated synthetic `USES` role model.
3. Actual frontend-produced CSS class lifecycle facts fit `USES` roles without false joins.
4. Artifact topology can keep attachment/reachability separate from semantic Facts.
5. Lazy or direct Fact production removes most projection overhead.

Do not replace the current snapshot yet.
