# PR 57 remaining work

Stopped on 2026-03-16 with uncommitted changes in the working tree.

## Known unimplemented fixes

None of the 12 audited compiler-flow defects remain intentionally unimplemented. The current working tree contains fixes and regression coverage for all 12:

1. Imported CSS/JavaScript/TypeScript asset invalidation.
2. Cache fingerprints include strictness.
3. JavaScript syntax and unsupported `require()` validation.
4. Nazare prop projection and reserved-binding filtering.
5. Duplicate emitted output-path rejection.
6. Invalid CSS rejection.
7. JSON template shape and order validation.
8. Metafield snapshot shape validation.
9. SHA-256 cache fingerprints.
10. Persisted cache entry ownership validation.
11. Mandatory fixed-point work accounting.
12. Non-`ENOENT` cache-revision read errors are surfaced.

## Still required before commit/push

- Re-run `pnpm -s test:all`. The last complete run reached 417/418; its sole stale fixture expectation was then fixed, but the full suite was not rerun afterward.
- Re-run `pnpm -s test:corpus`. The latest run passed `alkamind-nazare`, then was aborted before the remaining corpus themes completed.
- Run the document-contract agreement check with its required `--graph theme=path` arguments. Running bare `pnpm -s test:doc-agreement` is invalid because the script requires graph inputs.
- Confirm `packages/compiler/src/fact-cache-revision.ts` remains current after final edits/build.
- Review the full diff, commit, push `feat/semantic-theme-graph`, and verify GitHub checks.

## Last confirmed checks

- `biome check .`: passed.
- `pnpm -s build`: passed.
- Targeted compiler and CLI regressions: passed before the final Liquid parser compatibility adjustment.
- Corpus `alkamind-nazare`: passed after that adjustment (`3102` nodes, `6282` edges, `246` issues).

## Important parser adjustment

`liquid-only` parsing now uses the tolerant Shopify parser plus explicit rejection of unclosed Liquid blocks. Strict parser mode rejected valid Shopify render arguments containing filters, such as:

```liquid
{% render 'card', class: value | strip %}
```

Keep regression coverage for both valid filtered render arguments and malformed/unclosed Liquid structures.
