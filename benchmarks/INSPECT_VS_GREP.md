# Inspect vs grep agent comparison

Manual task set for comparing Nazare MCP inspection against grep/read tools. No runner, judge protocol, fixtures, or gold answers required.

## Setup

Choose one local repository and fill these subjects before starting:

```text
<FILE>       Theme file with direct dependencies
<SHARED_FILE> Frequently referenced snippet, section, asset, or component
<BEHAVIOR>   DOM class, DOM attribute, event, custom property, or request
<METAFIELD>  Shopify owner.namespace.key
```

Use same model, reasoning setting, context limit, and questions for both passes. Start each pass in fresh session.

- **Inspect pass:** expose only Nazare `inspect` MCP tool.
- **Grep pass:** expose only repository search and file-reading tools.
- Do not give either pass output from other pass.
- Save final answer, per-turn input/output tokens, and tool-call count.
- Record both cumulative token use and peak context. They measure different costs:
  - **Total tokens:** sum of input and output tokens across all model calls. This includes repeated conversation history and approximates billed consumption.
  - **Peak context:** largest input-token count for one model call, including retained tool results. This measures context-window pressure.
  - **Context fill:** peak context divided by model context limit.

## Tasks

Run each prompt unchanged in both passes.

### 1. Direct dependencies

```text
What files does <FILE> directly depend on? Explain each relationship and cite precise path:line locations.
```

### 2. Direct dependents

```text
What files directly depend on <SHARED_FILE>? Explain each relationship and cite precise path:line locations.
```

### 3. Behavior usage

```text
Where is <BEHAVIOR> produced and consumed? Distinguish similarly named behaviors and cite precise path:line locations.
```

### 4. Metafield usage

```text
Where is <METAFIELD> defined, read, or written? Separate proven usage from inferred usage and cite precise path:line locations.
```

### 5. Change impact

```text
What could be affected if <SHARED_FILE> changes? Separate direct dependents, transitively affected pages, and uncertain impact. Cite precise path:line locations.
```

### 6. Diagnostics and uncertainty

```text
What unresolved or uncertain relationships affect <FILE>? Explain what is known, what is inferred, and why static analysis is incomplete. Cite precise path:line locations where possible.
```

## Compare

Blind labels before review: rename answers `A` and `B`; hide tool identity and token counts. Ask reviewer with repository access to score each answer from 0–5:

- correctness
- completeness
- source support
- directness
- actionability

Reveal identities afterward. Record one row per task:

| Task | Inspect total tokens | Grep total tokens | Inspect peak context | Grep peak context | Inspect calls | Grep calls | Better answer | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| Direct dependencies | | | | | | | | |
| Direct dependents | | | | | | | | |
| Behavior usage | | | | | | | | |
| Metafield usage | | | | | | | | |
| Change impact | | | | | | | | |
| Diagnostics and uncertainty | | | | | | | | |

Compare answer quality first, then total tokens and peak context among answers reaching similar quality. Do not use a quality-per-token ratio; incomplete short answers can game it. Report context fill only when both passes use the same model context limit.
