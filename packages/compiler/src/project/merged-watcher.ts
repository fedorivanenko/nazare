export async function* mergeAsyncIterables<Value>(
	iterables: readonly AsyncIterable<Value>[],
): AsyncIterable<Value> {
	if (iterables.length === 0) return;
	const iterators = iterables.map((iterable) =>
		iterable[Symbol.asyncIterator](),
	);
	const pending = new Map<number, Promise<IteratorEvent<Value>>>();
	for (let index = 0; index < iterators.length; index++) {
		pending.set(index, readNext(iterators[index], index));
	}

	try {
		while (pending.size > 0) {
			const event = await Promise.race(pending.values());
			if (event.kind === "error") throw event.error;
			if (event.result.done) {
				pending.delete(event.index);
				continue;
			}
			pending.set(event.index, readNext(iterators[event.index], event.index));
			yield event.result.value;
		}
	} finally {
		await Promise.allSettled(iterators.map((iterator) => iterator.return?.()));
	}
}

type IteratorEvent<Value> =
	| {
			kind: "result";
			index: number;
			result: IteratorResult<Value>;
	  }
	| { kind: "error"; index: number; error: unknown };

async function readNext<Value>(
	iterator: AsyncIterator<Value>,
	index: number,
): Promise<IteratorEvent<Value>> {
	try {
		return { kind: "result", index, result: await iterator.next() };
	} catch (error) {
		return { kind: "error", index, error };
	}
}
