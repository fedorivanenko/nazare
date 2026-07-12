# Nazare compiler architecture — audit and proposal

_2026-07-12. Reviews the committed compiler for implicit/hidden behavior and
proposes a stronger architecture organized around one invariant._

## Verdict

The architecture is coherent: the pipeline is legible from `index.ts`, passes
are separated by concern, IDs are opaque and navigated rather than parsed, the
resolver is a clean filesystem boundary, and recent work made several
previously-implicit things explicit (the `nz-root` marker replacing
"first element wins," `resolveAssetImports` cloning instead of mutating, emit
split into `checkEmitPreconditions`/`emitLiquidFile`/`emitCssFiles`/
`emitScriptFiles`).

One category of real magic remains, plus a few smaller clarity issues. All of
them are instances of the same violated rule.

## Audit findings (ranked)

### 1. Textual regex lowering — the one real piece of magic

`liquid-lowering.ts` rewrites the *emitted Liquid string* with regexes instead
of transforming parsed structure. `emit` runs span-based `applyEdits`
(correct), then regexes its own output twice. Live footguns:

- `lowerPropsReads` (`/\bprops\.(\w+)/g` over the whole file) rewrites any
  `props.x` in literal markup or `{% comment %}` when `x` is a declared prop:
  a section with prop `title` and literal text `props.title` silently becomes
  `section.settings.title`.
- `lowerStyleReads` is worse — its expression regex `\b${binding}\.(\w+)\b`
  matches `styles.anything` anywhere, with no guard that the class exists, and
  wraps it in quotes. `styles.foo` in body text becomes `"nz-w__foo"`.

Root cause: **partial lowering.** Control flow (`{% if props.x %}`) is not
lowered into expression nodes, so a span-based transform would miss those
reads — the regex is the compensating fixup. It is deliberate (the comment
says "intentionally textual") but it is invisible behavior with edge cases.

### 2. "Loose mode" is defined in three places

What `loose` does is spread across `check.ts` (gates which check groups run),
`index.ts` `filterIssuesForMode` (hardcodes `IR_NODE_NOT_PROMOTED_HTML` and
`IR_PARTIAL_LOWERING_CONTROL_FLOW` to suppress *after* they are emitted), and
`resolver.ts` (threads the mode). The filter path is emit-then-suppress. A
reader cannot answer "what does loose mode change?" from one place.

### 3. `dependencyDiagnostics` default flips by entry point

`compileNazareArtifact` defaults to hidden; `buildNazareTheme` forces
`"surface"`. The same file yields different diagnostics depending on which
function is called.

### 4. Silent lowercase fallback

`emit.ts` render lowering: `snippetNamesByLocalName.get(target) ??
target.toLowerCase()`. A render target that is not a resolved import silently
lowercases — a case already an error upstream, papered over by inventing a name.

### 5. The runtime is an untyped string constant

`runtimeSource` (~70 lines) ships verbatim, outside the type checker; only the
vm tests exercise it. Acknowledged ("grows into @nazare/runtime"), low-risk,
but logic living outside the type system.

### Explicitly defended: setting hoisting

The most semantically "magic" feature — settings appear in the schema the
author never wrote — but it is the model example of *surfacing* hidden work:
the generated header lists every hoisted setting with provenance, the schema
carries `info: "From <path>"`, and collisions/alias-reuse are hard errors.
This is the pattern the rest should follow.

## The organizing invariant

> **Parse *locates*, bind *resolves*, check *judges*, emit *projects*. Emit
> only ever replaces source spans it was handed. No pass re-reads or rewrites
> another pass's text output.**

Every finding above is a violation of the last clause. The architecture's job
is to make that violation impossible by construction.

## Proposal

### Load-bearing change: references become first-class located nodes

Today `props.x` and `styles.x` are recognized **by regex, twice,
independently** — in `check` (`checkPropsReferences`, `parseStyleReference`)
to judge them, and in `emit` to rewrite them. Two recognizers that can drift;
the emit one runs over transformed text.

Replace both with one node kind produced once in parse:

```ts
type ReferenceSyntaxNode = {
  kind: "reference";
  target: "prop" | "style";   // namespace
  name: string;               // x
  accessor?: string;          // bracket form, etc.
  span: SourceSpan;           // exact source location
};
```

Parse scans **every expression-bearing position** — `{{ output }}`,
`{% if %}` / `{% unless %}` / `{% case %}` conditions, filter arguments — for
`props.` / `styles.` tokens and emits one located node per occurrence. It does
not interpret the surrounding Liquid (control-flow *semantics* stay
deliberately opaque); it only finds reference tokens and records where they
are. The LiquidHTML AST already exposes the expression ranges, so this is
locating tokens inside known spans, not writing a Liquid parser.

Then:

- **bind** resolves each reference to its replacement: a `prop` reference →
  declaration → provenance (`section.settings.x` for `.setting()`, bare name
  otherwise); a `style` reference → a class in a bound sheet → the scoped
  name. The replacement string is a resolution fact, computed once.
- **check** judges reference nodes directly (unknown prop, unknown/unused
  class) — no second recognizer.
- **emit** appends one span replacement per reference node and runs the single
  `applyEdits`. `liquid-lowering.ts` is deleted.

Payoff: **emit becomes a pure projection.** If a `props.x` in a `{% if %}` is
not lowered, it is because parse produced no node for it — a visible,
unit-testable gap in one pass, not a silent regex miss in output. Both
footguns die: literal `props.title` in body text is not in an expression
position, so parse never locates it. And `checkStyleBindings`'s recognizer and
`lowerStyleReads`'s regex collapse into the same node — one source of truth.

### Modes become a declared registry

```ts
const RULES = [
  { name: "render-target-kind",   modes: ["loose", "strict"], run },
  { name: "section-prop-setting",  modes: ["strict"],          run },
  { name: "css-module-linkage",    modes: ["strict"],          run },
  // …
];
// checkArtifactIR = RULES.filter(r => r.modes.includes(mode)).flatMap(run)
```

"What does loose mode do?" is answerable from one list. `filterIssuesForMode`
is deleted; the `IR_PARTIAL_LOWERING_*` notices stop being
diagnostics-that-get-suppressed and become a separate `notes` channel on the
result — nothing is emitted then dropped.

### Resolver stops having a policy that flips by caller

Contract derivation always happens. "Also fully check the imported files"
becomes an explicit second function (`checkDependencies(ast, readFile,
{mode})`) that `build` calls and `compile` does not — instead of a
`dependencyDiagnostics` default that is `hidden` from one entry point and
`surface` from another. Same behavior, visible as a call rather than a hidden
default.

## Cost and scope

**Deleted:** `liquid-lowering.ts` (both regexes), `filterIssuesForMode`,
`parseStyleReference`, the `props.`/`styles.` regex in `checkPropsReferences`,
the `dependencyDiagnostics` policy plumbing. Emit's surface shrinks to
span-projection. The IR gains one honest node kind replacing three ad-hoc
recognizers.

**Added:** an expression-token scanner in parse (locate `props.`/`styles.`
inside known expression ranges), and a reference-resolution step in bind.

**Unchanged:** the stage pipeline, opaque IDs, the resolver as fs boundary,
the `nz-root` marker, the emit file-split, span-based surgery for everything
already span-located (refs, islands, render sites, tags). Not a rewrite —
completing the IR so emit has nothing left to do textually. Output is
byte-identical, so the emit snapshots barely move.

## Suggested build order

1. ✅ **DONE** (commit 21f088d) — `ReferenceSyntaxNode`: scanner in parse
   (`references.ts`, scans only Liquid expression regions via the AST — output
   tags, structured control-flow conditions via `markup.position`, render
   args), span projection in emit, `checkPropsReferences`/`checkStyleBindings`
   consume the located nodes. Deleted `liquid-lowering.ts`,
   `parseStyleReference`, `NazareOutputExpression`, and the props/style
   regexes. Output byte-identical (emit snapshots unchanged); the literal-text
   footgun is gone and control-flow conditions are now checked. Replacement
   computation lives in emit (`referenceLowering`) rather than bind — a small
   deviation from the sketch, kept for scope.
2. ✅ **DONE** (commit 912758f) — `CHECK_RULES` registry in `check.ts`: each
   rule tagged with the modes it runs in, so `checkArtifactIR` filters the
   list instead of an `if (mode === "strict")` branch. The two
   `IR_PARTIAL_LOWERING_*` notices moved from `issues` to a `notes` channel on
   the compile result (and `NazareAst.notes`), mode-independent;
   `filterIssuesForMode` deleted. CLI surfaces `notes` alongside `issues`.
3. ✅ **DONE** (commit aa1b57f) — `resolveComponentContracts` now only derives
   contracts + reports import-graph failures. A new
   `checkDependencies(ast, readFile, {mode})` fully checks every
   transitively-imported file; `buildNazareTheme` calls it explicitly and a
   plain compile does not. The `dependencyDiagnostics` policy (and the
   `--dependency-diagnostics` flag) that flipped its default between compile
   and build are removed — the difference is now a visible call.

**All three items done — the audit is closed.** The invariant holds: parse
locates, bind resolves, check judges, emit projects; emit only replaces spans;
no pass re-reads another pass's output; mode and dependency behavior are each
one visible thing rather than a scattered default.

Smaller cleanups also done (commit 3c2c1ae): #4 the unresolved render target
keeps its authored name instead of inventing a lowercased one; #5 the runtime
is a DOM-typed function in `runtime.ts`, type-checked (DOM added to the
compiler lib) and shipped via `toString()`. Nothing from the audit remains.
