# Strategy: Inspect rides on the Shopify CLI

## Position

Shopify's CLI fetches ground truth from the store and hands it to a human.
Inspect connects that truth to the theme's structure.

We do not compete with Theme Check, do not reimplement its checks, and tell
people to run it. We consume what the CLI already produces and answer the
questions it structurally cannot.

## Why not compete

Theme Check ships 65 checks. Inspect has an equivalent for about 9, and one of
those (`THEME_DOC_PARAM_UNUSED`) is a duplicate of theirs (`UnusedDocParam`).
The gap is not an oversight to close — it is 12 performance checks, 10 Liquid
correctness checks that depend on Shopify's per-version catalog of every object
and filter, ~15 schema and settings validity checks, plus auto-fix, an LSP, a
config format, custom checks, and theme app extension support. Shopify
maintains all of it, ships it in the merchant's editor and admin, and gives it
away.

Any roadmap that competes there loses on cost and on distribution.

## What we have that they don't

A graph. Files, render sites, arguments, data reads, settings, locale keys, and
pages, joined into nodes and edges with a source span behind every claim, plus
explicit states for what the source does not prove (dynamic, ambiguous,
unresolved, unknown).

A linter walks files and reports offenses. It has no notion of "which pages are
affected." That is a different data structure, and it is the one we have.

## The pattern

The CLI is very good at fetching ground truth from a live store, and it stops
at the point where acting on that truth requires knowing how the theme is
wired:

| CLI command | What it fetches | Where it stops |
|---|---|---|
| `theme metafields pull` | the store's metafield definitions, typed | writes `.shopify/metafields.json` for editor completion; **none of the 65 checks reads it** |
| `theme profile` | real server-side Liquid render timing for one page | opens a Speedscope flamegraph for a human to read |
| `theme console` | real store data, evaluated in page context | an interactive prompt |

Each is a join waiting to happen, and the graph is the other half of all three.

## The three joins

### 1. Store schema × graph — proven, build first

Cross-referencing `.shopify/metafields.json` against Inspect's data-access
index on alkamind-nazare, using files already on disk:

- **5 metafield reads pointing at definitions that do not exist in the store.**
  Verified against the definitions file and confirmed in source:
  `collection.metafields.custom.hero_description` and `.hero_video`
  (`s-collection-hero.liquid`), `product.metafields.custom.subtitle`
  (`s-article-body.liquid`, `c-product-chip.liquid`),
  `product.metafields.custom.bundle` (`s-plp-grid.liquid`), and
  `product.metafields.card.tagline` (`c-bundle-card.liquid`,
  `c-plp-bundle-card.liquid`). These render empty in production and nothing in
  the ecosystem reports them. The last is a `| default:` fallback, so it is
  also unreachable code.
- **19 of 262 definitions are actually read by the theme.** The inverse
  question — which definitions are safe to retire — needs care before shipping:
  110 of the unused sit in one `my_fields` namespace and several are app-owned
  (`shopify--discovery--*`), so "unused by this theme" is not "unused".

Queries this unlocks that no linter can answer: which definitions this theme
consumes and where; which reads are broken; **which pages break if a definition
is renamed or deleted** (metafield → file → snippet → section → template →
page); whether a `list.product_reference` is being read as a scalar.

### 2. Profile × graph

`theme profile` reports that a page spent time in `product-card`. It cannot
report that `product-card` renders on 23 other pages, so one fix pays 23 times,
or that the expensive branch only executes when a setting is enabled. Per-page
cost plus the graph turns a flamegraph into a prioritized, theme-wide list.

**Verified against Shopify CLI documentation:** documented flags show no
`--output`/`--json`; command opens a browser with Speedscope. Do not build
profile ingestion yet. Future implementation must capture or receive browser
payload through separately validated integration; CLI stdout is not a stable
machine-readable source.

### 3. Console × graph

`theme console` returns real values for an expression you already knew to ask
about. The graph knows which expressions are load-bearing — which metafields
feed which sections, which reads never resolve. Together: "here are the 12 data
reads this page depends on, and here is what each returns on the live store."

**Verified against Shopify CLI documentation:** the console is an interactive
Liquid REPL. Documented flags provide store, URL context, credentials, and
verbosity, but no expression, stdin, script, or JSON-output flag. Do not build
console pairing on CLI stdout until a supported non-interactive interface is
validated.

## The hole in the lifecycle

Read the 20 `theme` commands as a workflow — init, dev, check, profile, push,
publish. **No command answers "what will this change affect."** You can lint a
file, time a page, and ship a theme; you cannot ask which pages break if you
edit a snippet, or what your theme consumes from your store.

That is structural, not an oversight: every one of those commands operates on a
file or a page, never on the theme as a connected whole.

## What we consume

Read Shopify's artifacts instead of inventing our own:

- `.shopify/metafields.json` — the store's data schema, with types
- `{% doc %}` LiquidDoc — declared component contracts (already consumed)
- `.theme-check.yml` — the team's ignore lists and severities, so our output
  respects conventions they already set

## What we stop doing

- **Drop `THEME_DOC_PARAM_UNUSED`** — it duplicates `UnusedDocParam`.
- **Abandon argument type checking** (the earlier "phase 3") —
  `ValidRenderSnippetArgumentTypes` already ships. Declared types stay useful
  for resolving data flow through parameters; they are not for validation.
- **Stop describing Inspect as adjacent to linting** anywhere in docs or
  marketing.

## Phases

1. **Metafields join.** Read `.shopify/metafields.json`, index metafield reads
   against real definitions, report broken references, expose consumed and
   unconsumed definitions as queries, and extend impact analysis so a
   definition is a node with dependents. Proven and self-contained.
2. **Respect `.theme-check.yml`** ignores so the two tools agree on scope.
3. **Profile ingestion**, only after confirming a machine-readable output
   exists.
4. **Console pairing**, only after confirming non-interactive use.

## Non-goals

Correctness linting, performance rules, editor integration, auto-fix, theme app
extensions, and any check that requires maintaining Shopify's catalog of
objects, filters, or schema rules per API version.

## Risks

- **The pulled schema is a snapshot of one store at one time.** Anything built
  on it must report when it was pulled, and a missing file must mean "unknown",
  never "this metafield does not exist". Same rule as everywhere else in the
  graph: absence of evidence is not evidence of absence.
- **Multi-store themes.** One theme may serve several stores with different
  definitions; a read that is broken against one store may be valid against
  another. Findings are scoped to the pulled store and must say so.
- **CLI surface drift.** We would depend on the shape of `.shopify/metafields.json`,
  which is documented as an implementation detail of a completion feature, not
  as an API. Parse defensively and degrade to "unknown" rather than failing.
- **Dependence cuts both ways.** If Shopify adds impact analysis to the CLI,
  the wedge narrows. The defensible core is the graph and its evidence
  discipline, not any single join.
