export const SHOPIFY_PRODUCT_CONCURRENCY = 32;

export async function mapWithConcurrency<Value, Result>(
	values: readonly Value[],
	concurrency: number,
	map: (value: Value, index: number) => Promise<Result>,
): Promise<Result[]> {
	if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
		throw new TypeError("Concurrency must be a positive safe integer");
	}
	const results = new Array<Result>(values.length);
	let nextIndex = 0;
	const worker = async (): Promise<void> => {
		while (nextIndex < values.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await map(values[index] as Value, index);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(concurrency, values.length) }, () =>
			worker(),
		),
	);
	return results;
}
