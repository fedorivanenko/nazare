# Benchmarks

Performance harness for `nazare inspect theme`, the slowest thing the CLI does
on a real theme.

```bash
pnpm benchmark:inspect                      # synthetic theme, scales 1/4/16
pnpm benchmark:inspect --scales 1,4,16,32   # push the scaling curve out
pnpm benchmark:inspect --theme climatic-health
pnpm benchmark:inspect --theme ../some-theme --runs 5
```

## Reading the numbers

**CPU time is the headline; wall time is context.** A developer machine under
load inflates wall time several fold while CPU time stays comparable. When wall
time is much larger than CPU time, the machine was busy and small differences
mean nothing.

**Cold vs warm.** Cold deletes `.nazare-out` before every run, so it measures
analysis from source. Warm reuses the persisted fact cache and mostly measures
cache validation, graph assembly, and serializing the JSON graph.

**Cost per parsed file.** Printed across scales when more than one theme is
measured. Analysis should be roughly linear in file count, so a per-file cost
that climbs with scale is the signal worth chasing — that is how a quadratic
in scope resolution showed up as a 407-file theme taking 40x the time of a
269-file one.

Themes are always copied into a temporary directory first, because cold runs
delete `.nazare-out` and that must never happen inside a real theme.

## A/B against another build

Point `--baseline-cli` at a second build to interleave both per cell and diff
their graph output:

```bash
git worktree add /tmp/nazare-baseline <commit>
cd /tmp/nazare-baseline && pnpm install --frozen-lockfile && pnpm -s build
cd -
pnpm benchmark:inspect \
  --baseline-cli /tmp/nazare-baseline/packages/cli-client/dist/index.js
```

A performance change is expected to leave the graph byte-identical. The run
exits non-zero and prints the first differing bytes when it does not, so this
doubles as the correctness check for optimization work.

## Themes

`--theme fixture` (default) scales `fixtures/theme-corpus` by cloning its
sections, snippets, and blocks, so it runs anywhere and needs no external
theme. Its files are uniform, which makes it good at catching superlinear
behavior and poor at reproducing the shape of one enormous template.

`--theme <slug>` resolves a slug from `fixtures/theme-graph-corpus.json` the
same way the corpus check does: `$NAZARE_CORPUS_*` first, then the recorded
default path. Those are real themes that live on individual machines, so the
committed fixture stays the portable option.
