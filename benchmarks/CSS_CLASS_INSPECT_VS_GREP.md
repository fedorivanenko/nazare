# Cross-language `css.class:is-active` Inspect vs grep

Real-theme agent benchmark against `~/Coding/hyuman/climatic-health`.

## Task

```text
Cross-language repository task: For artifacts reachable from templates/article.aarushi-test-template.json, explain where css.class:is-active is produced and consumed. Distinguish Liquid emission, CSS selection, and JavaScript reads/adds/removes/toggles. Give semantic occurrence counts by role and the reachable artifact list. Exclude same-name artifacts not reachable from this entrypoint. Cite representative precise path:line or path:byte-offset evidence for every role. State topology and semantic completeness limits. Do not list every occurrence. Use only available repository tools. Do not modify files or discuss methodology.
```

## Method

Each pass used a fresh non-persistent Pi session:

- provider/model: `openai-codex/gpt-5.6-sol`
- reasoning: `medium`
- same minimal system prompt and task
- Inspect pass: only experimental cross-language `inspect`
- grep pass: only `bash` and `read`
- no skills, repository context files, or unrelated extensions
- Inspect page limit: 50

`Total tokens` sums complete model usage, including cache-read input. `Peak context` is maximum input plus cache-read usage for one model call. Results are one run per pass, not a statistical performance gate.

## Results

| Metric | Inspect | grep/read | Change |
| --- | ---: | ---: | ---: |
| Total tokens | 18,458 | 219,823 | Inspect 11.9× lower |
| Peak context | 7,625 | 27,775 | Inspect 3.6× lower |
| Tool calls | 3 | 24 | Inspect 8× fewer |
| Raw tool bytes | 22,591 | 75,043 | Inspect 3.3× lower |
| Answer quality | Incomplete | Better | grep wins |

Inspect returned 123 modeled occurrences across five occurrence-bearing reachable artifacts:

```text
emits       3
selects    59
reads       7
adds       22
removes    22
toggles    10
```

grep reported broader repository behavior:

```text
emits       8
selects    59
reads      17
adds       24
removes    22
toggles    10
```

## Quality review

Both answers:

- excluded substring collisions such as `megamenu-is-active`;
- found both deployed CSS bundles;
- found deployed JavaScript bundles;
- separated semantic roles;
- cited precise source evidence;
- qualified runtime and external uncertainty.

Inspect strengths:

- dramatically lower token, context, tool-call, and raw-output cost;
- exact parser offsets and deterministic role counts;
- explicit topology versus semantic coverage;
- automatic same-name artifact filtering;
- bounded revision-aware pagination.

Inspect gaps:

1. Topology does not yet model Shopify `{% sections 'header-group' %}` section-group attachment. It omitted reachable `g-announcement`, `g-header`, and `c-megamenu-collections` Liquid emissions.
2. JavaScript frontend covers direct `classList.contains/add/remove/toggle/replace` operations only. grep additionally counted selector-based class reads and two non-`classList.add` class constructions.
3. Inspect answer stated semantic counts without clearly labeling this direct-operation extractor scope. Partial coverage was reported, but reason text did not name unsupported JavaScript class-use forms.
4. Inspect required three pages to obtain representative evidence for every role because role aggregates contain counts but no representative evidence item.

Therefore grep produced more complete behavior coverage and better page-topology explanation. Inspect won efficiency by a wide margin but does not yet reach equivalent quality.

## Bug discovered during benchmark

Initial topology traversal treated `ATTACHED_TO` as undirected. Shared assets then connected unrelated owners, making unrelated sections reachable through a common bundle. Fixed topology direction to owner → attached artifact and traversed attachment edges only forward.

After correction:

```text
REACHABLE_FROM records       2,760 → 833
topology snapshot             2.11 → 0.89 MB
sample reachable artifacts     116 → 30
is-active occurrence artifacts   8 → 5
```

## Next gates

1. Model `{% sections %}` and JSON section-group topology.
2. Add selector/query reads and direct `className` constructions to JavaScript class usage.
3. Add one representative evidence ref per role aggregate to avoid evidence-only pagination.
4. Re-run same frozen prompt after those changes.

## Captures

```text
/tmp/css-class-is-active-inspect.jsonl
/tmp/css-class-is-active-inspect-summary.json
/tmp/css-class-is-active-grep.jsonl
/tmp/css-class-is-active-grep-summary.json
```
