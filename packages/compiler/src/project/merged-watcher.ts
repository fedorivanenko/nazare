export function mergeAsyncIterables<Value>(
	iterables: readonly AsyncIterable<Value>[],
): AsyncIterable<Value> {
	return {
		[Symbol.asyncIterator]() {
			const iterators = iterables.map((iterable) =>
				iterable[Symbol.asyncIterator](),
			);
			const pending = new Map<number, Promise<IteratorEvent<Value>>>();
			let closed = false;
			for (let index = 0; index < iterators.length; index++) {
				pending.set(index, readNext(iterators[index], index));
			}
			const close = async (): Promise<void> => {
				if (closed) return;
				closed = true;
				pending.clear();
				await Promise.allSettled(
					iterators.map((iterator) => iterator.return?.()),
				);
			};
			return {
				async next(): Promise<IteratorResult<Value>> {
					while (!closed && pending.size > 0) {
						const event = await Promise.race(pending.values());
						if (closed) break;
						if (event.kind === "error") {
							await close();
							throw event.error;
						}
						if (event.result.done) {
							pending.delete(event.index);
							continue;
						}
						pending.set(
							event.index,
							readNext(iterators[event.index], event.index),
						);
						return { done: false, value: event.result.value };
					}
					return { done: true, value: undefined };
				},
				async return(): Promise<IteratorResult<Value>> {
					await close();
					return { done: true, value: undefined };
				},
			};
		},
	};
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
