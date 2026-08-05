export type RevisionedResultEvent<Result> = {
	type: "result";
	revision: number;
	durationMs: number;
	result: Result;
};

export type RevisionedUpdateFailedEvent = {
	type: "update-failed";
	revision: number;
	durationMs: number;
	error: unknown;
};

export type RevisionedExecutionEvent<Result> =
	| RevisionedResultEvent<Result>
	| RevisionedUpdateFailedEvent;

export async function executeRevisionUpdates<Update, Result>(options: {
	updates: AsyncIterable<Update>;
	revision(update: Update): number | undefined;
	run(revision: number, signal: AbortSignal): Promise<Result>;
	onEvent(event: RevisionedExecutionEvent<Result>): void | Promise<void>;
	signal?: AbortSignal;
}): Promise<void> {
	let generation = 0;
	let active: AbortController | undefined;
	const pending = new Set<Promise<void>>();
	const updates = options.updates[Symbol.asyncIterator]();
	const stop = () => {
		active?.abort("Revision execution stopped");
		void updates.return?.();
	};
	options.signal?.addEventListener("abort", stop, { once: true });
	try {
		while (!options.signal?.aborted) {
			const item = await updates.next();
			if (item.done) break;
			const update = item.value;
			const revision = options.revision(update);
			if (revision === undefined) continue;
			const currentGeneration = ++generation;
			active?.abort(`Superseded by revision ${revision}`);
			const controller = new AbortController();
			active = controller;
			const started = performance.now();
			let execution: Promise<void>;
			execution = options
				.run(revision, controller.signal)
				.then(async (result) => {
					if (
						controller.signal.aborted ||
						currentGeneration !== generation ||
						options.signal?.aborted
					)
						return;
					await options.onEvent({
						type: "result",
						revision,
						durationMs: performance.now() - started,
						result,
					});
				})
				.catch(async (error) => {
					if (
						controller.signal.aborted ||
						currentGeneration !== generation ||
						options.signal?.aborted
					)
						return;
					await options.onEvent({
						type: "update-failed",
						revision,
						durationMs: performance.now() - started,
						error,
					});
				})
				.finally(() => pending.delete(execution));
			pending.add(execution);
		}
	} finally {
		options.signal?.removeEventListener("abort", stop);
		if (options.signal?.aborted) active?.abort("Revision execution stopped");
		await Promise.all(pending);
	}
}
