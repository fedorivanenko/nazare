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
| Answer quality | Incomplete | Closer, but incomplete | Neither reaches broad static truth |

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

## Side-by-side source adjudication

The initial quality label overstated grep accuracy. Reviewing every disagreement against reachable source produced this broader static classification:

| Role | Inspect | grep answer | Source-adjudicated | Finding |
| --- | ---: | ---: | ---: | --- |
| Liquid emits | 3 | 8 | 8 | grep includes global layout sections; Inspect topology misses `{% section %}` |
| CSS selects | 59 | 59 | 59 | tie |
| JavaScript reads | 7 | 17 | 18 | grep includes selector reads but misses reachable inline script |
| JavaScript adds | 22 | 24 | 23 | Inspect misses inline add; grep folds two initial class-string emissions into adds and misses inline add |
| JavaScript removes | 22 | 22 | 23 | both miss inline remove |
| JavaScript toggles | 10 | 10 | 10 | tie |
| JavaScript emits | 0 | 0 | 2 | both omit initial class-string construction as its own role |

Adjudicated occurrence-bearing artifacts: **9**.

```text
sections/g-announcement.liquid
sections/g-header.liquid
snippets/c-megamenu-collections.liquid
snippets/c-video.liquid
snippets/c-account-address-form.liquid   # inline JavaScript
assets/preload.min.css
assets/main.min.css
assets/js-main.min.js
assets/js-shopify.min.js
```

Reachability proof:

- `layout/theme.liquid:214-225` statically includes global sections containing first three missing Liquid artifacts.
- `layout/theme.liquid:238` renders `c-account-address-form`.
- `snippets/c-account-address-form.liquid:315,317,324` reads, removes, and adds `is-active` in inline JavaScript.
- Two `js-shopify.min.js` string constructions emit initial `is-active` markup; they are not `classList.add` operations.

Therefore grep is **closer on broad behavior**, but not fully accurate. Inspect is exact for its currently declared direct extractors; its failure is incomplete extractor/topology coverage plus insufficiently specific coverage reasons, not false direct-operation counts.

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

1. Topology does not yet model Shopify `{% section 'name' %}` attachment. It omitted reachable `g-announcement`, `g-header`, and `c-megamenu-collections` Liquid emissions.
2. JavaScript frontend covers direct `classList.contains/add/remove/toggle/replace` operations only. grep additionally counted selector-based class reads and two non-`classList.add` class constructions.
3. Inspect answer stated semantic counts without clearly labeling this direct-operation extractor scope. Partial coverage was reported, but reason text did not name unsupported JavaScript class-use forms.
4. Inspect required three pages to obtain representative evidence for every role because role aggregates contain counts but no representative evidence item.

Therefore grep produced broader behavior coverage and better page-topology explanation, but still missed reachable inline JavaScript and conflated class-string emission with `classList.add`. Inspect won efficiency by a wide margin but does not yet reach equivalent broad coverage.

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

1. Model `{% section %}`, `{% sections %}`, and JSON section-group topology.
2. Parse reachable inline `<script>` JavaScript.
3. Add selector/query reads, direct `className`, and class-string emission to JavaScript class usage.
4. Add one representative evidence ref per role aggregate to avoid evidence-only pagination.
5. Re-run same frozen prompt after those changes.

## Captures

```text
/tmp/css-class-is-active-inspect.jsonl
/tmp/css-class-is-active-inspect-summary.json
/tmp/css-class-is-active-grep.jsonl
/tmp/css-class-is-active-grep-summary.json
```
