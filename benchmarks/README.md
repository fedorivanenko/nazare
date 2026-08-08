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

`benchmarks/ab.sh` builds both sides from source and compares them:

```bash
benchmarks/ab.sh                                    # against origin/main
BASELINE_REF=HEAD~3 SCALES=1,4,16 RUNS=5 benchmarks/ab.sh
THEME=climatic-health benchmarks/ab.sh
```

Or point `--baseline-cli` at a build you already have:

```bash
pnpm benchmark:inspect \
  --baseline-cli /path/to/baseline/packages/cli-client/dist/index.js \
  --max-cold-regression 15
```

Both builds run back to back per cell, so drift in the machine hits both. The
run exits non-zero when the graph output stops being byte-identical, or when
cold time regresses past `--max-cold-regression`.

Two rules keep the gate honest on a shared machine: it compares the *minimum*
of the runs rather than the median, because contention inflates the median far
more than the floor; and it skips cells whose baseline is under a second, which
measure process startup and grammar init rather than analysis.

A performance change is expected to leave the graph byte-identical, so this
doubles as the correctness check for optimization work.

## In CI

`.github/workflows/performance.yml` runs the A/B on pull requests that touch
`packages/compiler`, `packages/source`, `packages/cli-client`, or this folder,
against the PR's merge base, and uploads the report as an artifact.

Shared GitHub runners are noisy, so treat the CI numbers as a comparison and
never as absolutes worth quoting. The budget is 15%, and a runner is fast
enough that only the larger scales clear the one-second floor — those are the
cells the gate actually watches.

The nightly run compares against the most recent release tag instead, because
drift since a release is the question there. A graph shape change across
releases is intended, so that run passes `ALLOW_OUTPUT_CHANGE=1` and reports
differences without failing; inside a pull request an output change is a
finding and fails the job.

## On Railway

`benchmarks/Dockerfile` builds a runner image that clones the repository at run
time, so one image benchmarks any pair of refs:

1. New service from this repository, Dockerfile path `benchmarks/Dockerfile`.
2. Set `HEAD_REF` (branch to measure) and `BASELINE_REF` (default
   `origin/main`). `GITHUB_TOKEN` is only needed while the repository is
   private, and the script keeps it out of the logs.
3. Give it a cron schedule. The service runs to completion and exits non-zero
   on a regression or an output difference, so a failed run is the signal.

Railway's vCPU is shared and burstable, which is fine for the interleaved
comparison this harness does and not fine for absolute numbers.

Budget: one run installs and builds twice, which is the bulk of the cost — a
few minutes of vCPU, so roughly $0.10–0.30 per run at Hobby pricing. Weekly or
on-demand fits inside a $5 plan comfortably; nightly may not. Both installs
share one pnpm store in the image, so the second one mostly links.

Real themes are not in this repository, and putting client theme source on a
third-party PaaS is a data decision rather than a technical one. The default
`THEME=fixture` needs nothing external; to benchmark a real theme there,
attach a volume, populate it yourself, and point `THEME` at that path.

## Themes

`--theme fixture` (default) scales `fixtures/canonical-theme` by cloning its
sections, snippets, and blocks, so it runs anywhere and needs no external
theme. Its files are uniform, which makes it good at catching superlinear
behavior and poor at reproducing the shape of one enormous template.

`fixtures/canonical-theme` is also the readable semantic-topology seed. It covers
Shopify structure, render/data flow, settings, locales, metafields, Nazare
imports, unresolved targets, and Liquid/CSS/JavaScript behavior relationships.

For an inspectable large theme with an exact compiler-input count, scaffold one
outside the repository and benchmark it as a path:

```bash
pnpm benchmark:scaffold --files 400 --out /tmp/nazare-theme-400
pnpm benchmark:inspect --theme /tmp/nazare-theme-400 --runs 5

pnpm benchmark:scaffold --files 800 --out /tmp/nazare-theme-800
pnpm benchmark:inspect --theme /tmp/nazare-theme-800 --runs 5
```

Scaffolding is deterministic and refuses to replace an existing directory
unless `--force` is passed. It copies the topology seed, then adds realistic
Liquid, JSON, Nazare component, CSS, and JavaScript files. A
`nazare.benchmark.json` manifest records the seed and exact generated count.

`--theme <slug>` resolves a slug from `fixtures/theme-graph-contract.json` the
same way the corpus check does: `$NAZARE_CORPUS_*` first, then the recorded
default path. Those are real themes that live on individual machines, so the
committed fixture stays the portable option.
