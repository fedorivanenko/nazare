# Design: `{% doc %}` as declared component contracts

## Problem

Component-input requiredness is inferred from source evidence. On files whose
authors declared their intent, inference is right 66% of the time.

Measured on alkamind-nazare, the only corpus theme using `{% doc %}` (28 of 60
snippets, 131 `@param` annotations, 130 of which match an inferred input):

| Author declared | Inference produced | Count |
|---|---|---:|
| — agreement — | | 86 |
| optional | required | 16 |
| required | optional | 16 |
| required | unknown | 12 |

Each disagreement class means something different:

- **declared optional, inferred required** — the over-claiming family. Partly
  fixed by the indirect-guard and unless-default work; the remainder are
  decoration inputs (`class`, `attributes`, `overlay`) whose optionality has no
  representation in source at all.
- **declared required, inferred optional** — the graph tells a caller an input
  is safe to omit when the author says it is not. This is the harmful
  direction and was previously invisible.
- **declared required, inferred unknown** — almost entirely `product`, which
  sits in `LIQUID_GLOBAL_NAMES` and is therefore read as ambient context even
  when a snippet declares it as a parameter.

Inference cannot close this gap on its own. An unguarded read of an optional
decoration input is byte-for-byte identical to an unguarded read of a required
one; only the author knows which it is. The authors already wrote it down, and
the compiler currently ignores it.

## Approach

Consume Shopify's LiquidDoc annotations as declared contracts, keep inference
running underneath, and treat disagreement between them as a finding rather
than resolving it silently.

`@shopify/liquid-html-parser` already parses these into `LiquidDocParamNode`
(`paramName`, `paramType`, `paramDescription`, `required`, plus positions), in
both tolerant and strict mode. Verified against real corpus files. No
hand-parsing of comment text is involved, and no new dependency.

### Precedence

1. Nazare component contracts (explicit, typed, already authoritative)
2. `{% doc %}` `@param` declarations
3. Source inference

A declaration answers the requiredness question for its input. Inference still
runs and is retained as evidence, because it is what makes the disagreement
diagnostics and the recall harness possible.

### Provenance is part of the record

`ThemeExpectedInputRecord` gains a provenance field distinguishing `declared`
from `inferred`. Consumers must be able to tell an author's statement from the
compiler's guess — the graph's existing contract with its readers is that every
claim carries its evidence, and a declared requirement is a different kind of
fact than an inferred one. Declared inputs carry the doc span as evidence.

### Declared names are inputs, not ambient globals

Within a file that declares `@param product`, `product` resolves to that
parameter rather than to the Liquid global. This closes the 12-case class
directly and, more importantly, is simply correct: a snippet that documents
`product` as a parameter does take it as one.

## Diagnostics

The disagreements are the product surface, not a side effect. Each has a
different actionability, so each gets its own code:

| Code | Fires when | Severity | Why it matters |
|---|---|---|---|
| `THEME_DOC_PARAM_UNGUARDED` | declared optional, but no read is guarded or defaulted | info | The declaration and the source describe the interface differently. 16 instances. |
| `THEME_DOC_PARAM_FALLBACK` | declared required, but the source guards or defaults it | info | The mirror case: either the contract is stricter than the code, or the fallback is unreachable. 16 instances. |
| `THEME_DOC_PARAM_UNDECLARED` | a file with a doc block has an inferred input absent from it | info | Doc incompleteness. 13 instances. |
| `THEME_DOC_PARAM_UNUSED` | a declared param is never read in the file | info | Doc rot, usually a rename. 1 instance. |

**On the silence rule.** This design originally said a declared-required input
that inference calls optional should never be reported, because inference is
conservative. That reasoning holds for `unknown`, which is inference declining
to have an opinion. It does not hold for `optional`, which is a positive
finding that the file guards or defaults the input — concrete and actionable,
so `THEME_DOC_PARAM_FALLBACK` reports it. Declared-required against inferred
`unknown` remains silent.

**Correction.** An earlier draft of this design made
`THEME_DOC_PARAM_UNGUARDED` a warning, on the reasoning that a caller omitting
the input would hit a nil read. That was wrong. Liquid renders an absent
variable as empty and does not raise, so `class='{{ item_class }}'` with
`item_class` omitted renders `class=''` — which is exactly how an optional
class hook is meant to be written. Implementing it produced 16 findings on
alkamind-nazare, all of them correct code. All three codes are therefore
informational: they report that two descriptions of one interface differ, which
is worth a human's attention and is not a defect.

Deliberately **not** a diagnostic: declared required while inference says
optional or unknown. Inference is conservative by design, so its silence is
expected and warning on it would punish the author for the compiler's caution.
That disagreement is still recorded for the harness below.

## Recall harness

The 131 declared params are a labeled corpus that regenerates itself. A script
alongside `check-theme-graph-corpus.mjs` reports declared-vs-inferred agreement
per theme and fails on regression against a committed baseline.

This is what turns "recall is unmeasured" — carried as an open item since the
readiness assessment — into a number that moves when inference changes. It also
guards against the failure mode this design otherwise invites: once
declarations override inference, inference quality becomes invisible in the
output, and would rot unnoticed.

## Phases

1. **Extract and report.** Parse `@param` into facts, add provenance, let
   declarations win, close the ambient-global case. Ship the three diagnostics.
   *Done.*
2. **Harness.** Agreement script plus committed baseline; wire into the corpus
   check. *Done —* `scripts/check-doc-contract-agreement.mjs`, baseline in
   `notes/doc-contract-agreement.json`, and it runs inside the corpus check.
   The measured baseline is **81 of 131 (61.8%)**, lower than the 66% quoted
   above because that earlier figure scored declared-optional-vs-inferred-
   unknown as agreement; the harness counts it as a disagreement, which is the
   stricter and more useful reading.
3. **Types.** `@param {product}`, `{image}`, `{boolean}` and friends feed the
   type layer, so `product.price` inside a snippet resolves as a Shopify data
   access through a declared parameter rather than an ambient guess. The corpus
   vocabulary is 73 `string`, 17 `boolean`, 12 `product`, 10 `image`, 5
   `video`, 4 `variant`, 3 `metaobject`, and a tail including `link[]` and
   `array`, so array syntax and unknown type names both need a defined
   behavior before this phase starts.

Phases 1 and 2 are worth doing together; phase 3 is separable and larger.

## Measured against the contracts

Using the harness as a labeled corpus, agreement moved from 81/131 (61.8%) to
89/131 (67.9%). Four inference changes, each measured rather than assumed:

- **Caller-supplied arguments are inputs.** A name a caller passes by name is a
  parameter of the target, whatever it looks like from inside. This is what
  ambient Shopify objects needed: `declared required, inferred unknown` fell
  from 13 to 5, almost all `product`.
- **Guarded ambient objects stay unknown.** A guard around an ambient object may
  protect against absent page context rather than an omitted argument. Calling
  these optional instead buys one more agreement and costs two more inputs
  wrongly described as safe to omit, so unknown wins.
- **A guard on a derived property is not a guard on its base name.**
  `{% if benefits %}`, where `benefits` is `product.metafields…`, says the file
  handles missing benefits, not a missing product.
- **Conditional reads do not prove requirement.** Dispatcher snippets branch on
  an argument; reads in unselected branches are not evidence. Without this, the
  caller-argument change produced two `THEME_RENDER_ARGUMENT_MISSING` warnings
  on ucan against a snippet whose callers correctly omit `product` when
  selecting a branch that does not use it — the corpus golden caught them.

One hypothesis was tested and rejected: treating a bare guard as `unknown`
rather than `optional`, on the theory that a guard proves tolerance and not
optionality. Agreement fell from 68% to 40%, because authors overwhelmingly do
guard the inputs they consider optional. The rule stayed as it was.

The remaining 42 disagreements are dominated by two classes that inspection
says are genuine doc-vs-code disagreements rather than inference defects: 16
declared-optional inputs whose reads carry no evidence of optionality, and 16
declared-required inputs the source guards or defaults. Both are now reported.

## Scope and non-goals

- Snippets first. All 28 corpus doc blocks are in `snippets/`; sections take
  settings rather than params, and their doc semantics differ.
- No prose parsing. alkamind-old and climatic-health document optionality in
  free-text comments (`- responsive_image: An optional responsive image`).
  Reading those would be guessing at English, which is exactly the class of
  inference this design exists to replace. They stay unresolved until their
  authors adopt `{% doc %}`.
- Undocumented files are unaffected. Absence of a doc block is not a signal;
  inference continues exactly as today.

## Risks

- **Declarations can be wrong.** A stale `@param` outranks correct inference.
  Mitigated by `THEME_DOC_PARAM_UNGUARDED` and `THEME_DOC_PARAM_UNUSED`, which
  are precisely the checks that catch a doc drifting from its code, and by
  provenance making the source of every claim visible.
- **Silent inference rot.** Addressed by phase 2; it is the reason phase 2 is
  not optional.
- **Corpus bias.** Only one theme in the corpus uses `{% doc %}`, and it is the
  Nazare-authored one. The 66% figure describes that theme, not Shopify themes
  generally. A second documented theme would strengthen every number here.
