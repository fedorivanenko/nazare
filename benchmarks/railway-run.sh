#!/usr/bin/env bash
# Entry point for the container benchmark: clone, then hand off to ab.sh.
#
# Exits non-zero when the candidate regresses past its budget or when the graph
# output stops matching the baseline, so a Railway cron job surfaces either as
# a failed run.
set -euo pipefail

: "${GIT_REMOTE:?GIT_REMOTE is required}"
: "${HEAD_REF:?HEAD_REF is required}"

CHECKOUT="${CHECKOUT:-/benchmark/nazare}"
remote="$GIT_REMOTE"
# A private repository needs a token, and it must not reach the logs.
if [ -n "${GITHUB_TOKEN:-}" ]; then
	remote="$(printf '%s' "$GIT_REMOTE" | sed -E "s#https://#https://x-access-token:${GITHUB_TOKEN}@#")"
fi

if [ -d "$CHECKOUT/.git" ]; then
	git -C "$CHECKOUT" remote set-url origin "$remote"
	git -C "$CHECKOUT" fetch --quiet --tags origin
else
	rm -rf "$CHECKOUT"
	# Blobless: the benchmark needs two refs' trees, not the whole history.
	git clone --quiet --filter=blob:none "$remote" "$CHECKOUT"
fi

cd "$CHECKOUT"
git checkout --quiet --detach "origin/$HEAD_REF" 2>/dev/null \
	|| git checkout --quiet --detach "$HEAD_REF"

echo "Benchmarking $HEAD_REF against ${BASELINE_REF:-origin/main}"
uname -sm
nproc
exec benchmarks/ab.sh
