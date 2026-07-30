#!/usr/bin/env bash
# Interleaved A/B of `nazare inspect theme` between a baseline git ref and the
# current working tree, used by CI, by the Railway job, and by hand.
#
# Both builds are compiled from source in this run, because a benchmark that
# compares against a stale artifact measures the artifact.
#
#   benchmarks/ab.sh                          # against origin/main
#   BASELINE_REF=HEAD~3 benchmarks/ab.sh
#   THEME=climatic-health RUNS=5 benchmarks/ab.sh
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_REF="${BASELINE_REF:-origin/main}"
THEME="${THEME:-fixture}"
SCALES="${SCALES:-1,4,16}"
RUNS="${RUNS:-3}"
MAX_COLD_REGRESSION="${MAX_COLD_REGRESSION:-15}"
WORKTREE="${WORKTREE:-$(mktemp -d -t nazare-baseline)}"

cd "$REPOSITORY_ROOT"

baseline_sha="$(git rev-parse --verify "$BASELINE_REF")"
echo "Baseline $BASELINE_REF ($baseline_sha) vs working tree $(git rev-parse --short HEAD)"

cleanup() {
	git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
	rm -rf "$WORKTREE"
}
trap cleanup EXIT

echo "==> building candidate"
pnpm install --frozen-lockfile
pnpm -s build

echo "==> building baseline in $WORKTREE"
rm -rf "$WORKTREE"
git worktree add --detach "$WORKTREE" "$baseline_sha" >/dev/null
(
	cd "$WORKTREE"
	pnpm install --frozen-lockfile
	pnpm -s build
)

echo "==> benchmarking"
node benchmarks/inspect-theme.mjs \
	--theme "$THEME" \
	--scales "$SCALES" \
	--runs "$RUNS" \
	--baseline-cli "$WORKTREE/packages/cli-client/dist/index.js" \
	--max-cold-regression "$MAX_COLD_REGRESSION" \
	${REPORT_JSON:+--json} \
	| tee "${REPORT_PATH:-/dev/null}"
