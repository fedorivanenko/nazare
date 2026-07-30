# Benchmark runner image, built for Railway but plain Docker anywhere.
#
# The repository is cloned at run time rather than baked in, so one image can
# benchmark any pair of refs and the layer cache survives every push.
#
#   docker build -t nazare-benchmark -f benchmarks/Dockerfile benchmarks
#   docker run --rm -e HEAD_REF=my-branch nazare-benchmark
FROM node:24-bookworm-slim

# node-gyp needs a toolchain, and the tree-sitter bindings are patched to
# C++20, which bookworm's g++ 12 supports.
RUN apt-get update \
	&& apt-get install --no-install-recommends -y \
		build-essential \
		ca-certificates \
		git \
		python3 \
	&& rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.0.0 --activate

# One store for both builds in a run: the baseline install then costs links
# rather than downloads.
ENV PNPM_HOME=/pnpm
ENV PNPM_STORE_DIR=/pnpm/store
ENV PATH="$PNPM_HOME:$PATH"

WORKDIR /benchmark
COPY railway-run.sh ./railway-run.sh
RUN chmod +x ./railway-run.sh

ENV GIT_REMOTE=https://github.com/fedorivanenko/nazare.git
ENV HEAD_REF=main
ENV BASELINE_REF=origin/main
ENV THEME=fixture
ENV SCALES=1,4,16,32
ENV RUNS=3
ENV MAX_COLD_REGRESSION=15

CMD ["./railway-run.sh"]
