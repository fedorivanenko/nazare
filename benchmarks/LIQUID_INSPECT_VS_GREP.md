# Liquid Inspect vs grep UX pilot

Real-theme pilot against `~/Coding/hyuman/climatic-health`. Scope intentionally limited to the current Liquid vertical.

## Corpus

- 131 `.liquid` files under `layout/`, `sections/`, `snippets/`, and `templates/`, recursively
- 556,759 source bytes
- Repository scope declared complete only for that Liquid file set
- CSS, JavaScript, JSON, generated assets, and `node_modules` excluded

## Method

Each cell used a fresh non-persistent Pi session with:

- provider/model: `openai-codex/gpt-5.6-sol`
- reasoning: `medium`
- identical minimal system prompt and task
- Inspect pass: only standalone semantic compiler `inspect`
- grep pass: only Pi `grep` and `read`
- Inspect page limit: 10
- evidence mode chosen by agent

`Total tokens` sums each model call's complete input and output usage, including cache-read input. `Peak context` is the largest input plus cache-read usage for one model call. Results are one run per final cell, not a statistical performance gate. Quality review was not blinded.

## Tasks and results

| Task | Inspect total tokens | grep total tokens | Inspect peak context | grep peak context | Inspect calls | grep/read calls | Quality |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Direct renders from `sections/g-header.liquid` | 4,782 | 9,349 | 3,758 | 5,305 | 1 | 4 | Tie |
| All direct callers of `snippets/c-item-price.liquid` | 54,868 | 144,098 | 24,731 | 21,665 | 4 | 25 | Tie |
| Trace `megamenu_title_array` into both `c-megamenu-collections` calls | 128,826 | 31,160 | 20,565 | 11,171 | 14 | 9 | grep better |
| **Total** | **188,476** | **184,607** | **24,731 max** | **21,665 max** | **19** | **38** | Mixed |

### Task 1

```text
Liquid-only task: What snippets does sections/g-header.liquid directly render? Explain each render relationship, including guards or arguments when relevant, and cite precise path:line locations.
```

Both answers correctly found two snippets and five calls. Inspect answered from one file-dependency response. It used about 49% fewer total tokens and 29% fewer peak-context tokens.

### Task 2

```text
Liquid-only task: Which files directly render snippets/c-item-price.liquid? List every call site, summarize passed arguments and guards, and cite precise path:line locations.
```

Both answers correctly found 16 executable calls across 12 files, including nested `templates/customers/order.liquid`. Inspect used about 62% fewer total tokens and 84% fewer tool calls. Its large semantic pages produced a 14% higher peak context than grep.

### Task 3

```text
Liquid-only task: At both renders of c-megamenu-collections in sections/g-header.liquid, trace the passed megamenu_title_array value back to its local bindings and inputs. Separate proven source lineage from Shopify runtime-dependent values, include guards, and cite precise path:line locations.
```

grep produced the better answer with about 76% fewer total tokens. Inspect found the correct initialization, loop binding, filter chain, runtime inputs, and guards, but the agent had to explore broad occurrence pages because bindings are not public typed subjects or directly discoverable records. grep also explained nearby non-lineage bindings and downstream string use more clearly.

## Compiler and response timing

One local in-process measurement after fixes:

- Cold session compile: 4,800.8 ms
- Five one-file updates: 2,342.8–2,810.3 ms
- File dependency Inspect response: 10.2 ms, 12,647 bytes
- First direct-dependent page: 25.9 ms, 34,665 bytes

Incremental updates reuse unchanged per-file contributions, but full repository assembly and index construction still dominate.

## UX findings

Strengths:

- Direct dependency and dependent questions now map cleanly to one or a few domain calls.
- Render responses carry arguments, guards, value lineage, exact evidence, and runtime availability together.
- Inspect halved tool calls overall.
- Semantic parsing excluded a commented example render without special agent work.

Remaining problems:

- Binding/value-flow exploration lacks a typed public subject or focused facet. Agents fall back to broad file occurrence pagination.
- Large dependent pages can exceed grep's peak context despite lower cumulative tokens.
- Repository-wide value-flow budget exhaustion marks broad coverage partial on this theme.
- `snippets/c-megamenu-collections.liquid` contains unsupported `#` syntax, so repository-wide absence claims remain qualified.
- One-file updates remain multi-second because assembly and indexes rebuild fully.

## Bugs found and fixed during pilot

- Multi-statement `{% liquid %}` assignments and conditions shared incorrect enclosing-tag evidence, causing 1,101 assembly conflicts on the real theme.
- Exact repository resolution merged every reference anchor into each render relation, contaminating call-site evidence and inflating responses.
- File dependency responses exposed only target snippets, forcing separate calls for render arguments and guards.
- Render arguments and guards lacked their own public evidence locations.
- Initial benchmark loader omitted nested Liquid files; recursive discovery corrected the corpus from 124 to 131 files.

## Symbol-subject follow-up

Inspect contract version 2 added exact symbol subjects with optional kind:

```json
{
  "subject": {
    "symbol": "snippets/c-item-price.liquid",
    "kind": "snippet"
  },
  "facet": "dependents"
}
```

Snippet paths canonicalize to their handle symbol. Symbol kind is optional when unambiguous. Default discovery now returns semantic symbols only, not render or expression occurrences; occurrence selection remains location-based.

Re-running the direct-caller task with symbol-oriented tool guidance produced exactly two paginated dependent calls and the same 16-call answer:

| Metric | Original Inspect | Symbol Inspect | Change |
| --- | ---: | ---: | ---: |
| Tool calls | 4 | 2 | -50% |
| Raw tool bytes | 94,475 | 53,733 | -43% |
| Total tokens | 54,868 | 25,536 | -53% |
| Peak context | 24,731 | 14,187 | -43% |

This isolates subject identity from relationship intent and removes discovery hydration. Remaining 53,733-byte payload comes from rich render details, repeated evidence, automatic value lineage, and completeness metadata; symbol subjects do not solve projection size.

Symbol support is currently an Inspect/index projection over the existing graph. Snapshot records were not collapsed or renamed.

## Conclusion

Current Liquid Inspect UX wins architecture-shaped questions and loses focused local value-flow tracing. Across this three-task pilot, total tokens were effectively equal, peak context was slightly worse for Inspect, and tool calls were halved. Next UX work should target binding/value-flow inspection and smaller dependent projections before claiming a general token-efficiency win for the standalone compiler.
