# Fixtures

## Canonical integration theme

`canonical-theme/` is the only committed whole-theme semantic fixture. Use it
for compiler/CLI integration, graph topology contracts, batch/incremental
equivalence, and as the seed for generated performance themes.

Load compiler inputs through `theme-fixture.mjs`; do not duplicate theme file
selection in tests or benchmarks.

`theme-graph-contract.json` records required graph motifs for the canonical
theme and optional external real-theme corpora. Real-theme source remains
outside this repository.

## Focused fixtures

Package-local fixtures remain intentionally separate:

- `packages/compiler/tests/fixtures/`: valid and invalid component cases.
- `packages/cli-client/tests/fixtures/source-analysis/`: exact single-file CLI contracts.
- `packages/preview/fixtures/theme/`: preview stories and fixture data.
- `packages/tree-sitter-nazare-liquid/test/corpus/`: grammar corpus.
- `examples/theme/`: documentation and generated-output example, not test truth.

Focused invalid/parser fixtures must not be merged into `canonical-theme/`.
Generated 400–800-file themes must not be committed; create them with
`pnpm benchmark:scaffold` in a temporary directory.
