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
#   ALLOW_OUTPUT_CHANGE=1 BASELINE_REF=v0.1.0-rc.4 benchmarks/ab.sh
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASELINE_REF="${BASELINE_REF:-origin/main}"
THEME="${THEME:-fixture}"
SCALES="${SCALES:-1,4,16}"
RUNS="${RUNS:-3}"
MAX_COLD_REGRESSION="${MAX_COLD_REGRESSION:-15}"
MAX_COLD_MS="${MAX_COLD_MS:-}"
MAX_COLD_SCALE="${MAX_COLD_SCALE:-}"
# An explicit template rather than -t: GNU mktemp requires the XXXXXX that BSD
# mktemp treats as optional.
WORKTREE="${WORKTREE:-$(mktemp -d "${TMPDIR:-/tmp}/nazare-baseline.XXXXXX")}"

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
max_cold_args=()
if [[ -n "$MAX_COLD_MS" ]]; then
	max_cold_args=(--max-cold-ms "$MAX_COLD_MS")
	if [[ -n "$MAX_COLD_SCALE" ]]; then
		max_cold_args+=(--max-cold-scale "$MAX_COLD_SCALE")
	fi
fi
node benchmarks/inspect-theme.mjs \
	--theme "$THEME" \
	--scales "$SCALES" \
	--runs "$RUNS" \
	--baseline-cli "$WORKTREE/packages/cli-client/dist/index.js" \
	--max-cold-regression "$MAX_COLD_REGRESSION" \
	"${max_cold_args[@]}" \
	${ALLOW_OUTPUT_CHANGE:+--allow-output-change} \
	${REPORT_JSON:+--json} \
	| tee "${REPORT_PATH:-/dev/null}"
