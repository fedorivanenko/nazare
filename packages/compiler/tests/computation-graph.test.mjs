import assert from "node:assert/strict";
import test from "node:test";
import {
	ComputationCycleError,
	createComputationGraph,
	createMemoryComputationCache,
	defineComputation,
	defineProduct,
	ObsoleteComputationRevisionError,
	optionalProductKeyCodec,
	productKeyCodec,
	productKeyValueCodec,
} from "../dist/testing.js";

function inputComputation(id, inputKey, calls) {
	const definition = defineProduct({
		namespace: "test",
		id,
		version: 1,
	});
	return defineComputation(
		definition,
		async (context) => {
			calls.count++;
			return context.input(inputKey);
		},
		{ cache: productKeyCodec() },
	);
}

test("memoizes products and deduplicates concurrent computation", async () => {
	const graph = createComputationGraph();
	const calls = { count: 0 };
	const source = inputComputation("source", "source", calls);
	graph.register(source);
	const update = graph.beginUpdate();
	update.setInput("source", "value");
	const revision = update.commit();
	const requested = source.product("same-key");

	const [first, second] = await Promise.all([
		graph.get(requested, { revision }),
		graph.get(requested, { revision }),
	]);
	const third = await graph.get(requested, { revision });

	assert.equal(first, "value");
	assert.equal(second, "value");
	assert.equal(third, "value");
	assert.equal(calls.count, 1);
});

test("reports revisioned compute, reuse, and invalidation telemetry", async () => {
	const events = [];
	const graph = createComputationGraph({
		onTelemetry(event) {
			events.push(event);
		},
	});
	const source = inputComputation("telemetry-source", "source", { count: 0 });
	graph.register(source);
	let update = graph.beginUpdate();
	update.setInput("source", "one");
	update.commit();
	const product = source.product("key");

	await graph.get(product);
	await graph.get(product);
	update = graph.beginUpdate();
	update.setInput("source", "two");
	update.commit();
	await graph.get(product);

	assert.deepEqual(
		events.map(({ type, revision }) => ({ type, revision })),
		[
			{ type: "computed", revision: 1 },
			{ type: "memory-hit", revision: 1 },
			{ type: "invalidated", revision: 2 },
			{ type: "computed", revision: 2 },
		],
	);
	assert.equal(
		events.every((event) => event.cacheKey === product.cacheKey),
		true,
	);
});

test("reports non-fatal cache read, write, and delete faults", async () => {
	const definition = defineProduct({
		namespace: "test",
		id: "cache-fault",
		version: 1,
	});
	const product = definition.product("file");
	const expected = [
		[
			"read",
			{
				read: async () => {
					throw Object.assign(new Error("read denied"), { code: "EACCES" });
				},
				write: async () => {},
				delete: async () => {},
			},
		],
		[
			"write",
			{
				read: async () => undefined,
				write: async () => {
					throw new Error("write denied");
				},
				delete: async () => {},
			},
		],
		[
			"delete",
			{
				read: async () => ({
					value: "stale",
					valueFingerprint: "invalid",
					productFingerprint: "invalid",
					dependencies: [],
				}),
				write: async () => {},
				delete: async () => {
					throw new Error("delete denied");
				},
			},
		],
	];

	for (const [operation, cache] of expected) {
		const events = [];
		const graph = createComputationGraph({
			cache,
			onTelemetry(event) {
				events.push(event);
			},
		});
		graph.register(
			defineComputation(definition, async () => "computed", {
				cache: productKeyCodec(),
			}),
		);

		assert.equal(await graph.get(product), "computed");
		const fault = events.find((event) => event.type === "cache-fault");
		assert.deepEqual(
			{
				type: fault?.type,
				operation: fault?.operation,
				cacheKey: fault?.cacheKey,
				revision: fault?.revision,
				error: fault?.error,
			},
			{
				type: "cache-fault",
				operation,
				cacheKey: product.cacheKey,
				revision: 0,
				error:
					operation === "read"
						? { name: "Error", message: "read denied", code: "EACCES" }
						: { name: "Error", message: `${operation} denied` },
			},
		);
	}
});

test("cache codecs preserve supported values across cold and warm graphs", async () => {
	const entries = new Map();
	const cache = {
		async read(cacheKey) {
			const value = entries.get(cacheKey);
			return value === undefined ? undefined : structuredClone(value);
		},
		async write(cacheKey, value) {
			entries.set(cacheKey, structuredClone(value));
		},
		async delete(cacheKey) {
			entries.delete(cacheKey);
		},
	};
	const values = [
		null,
		["array", { nested: true }],
		{ record: { value: 1 }, empty: [] },
	];

	for (const [index, value] of values.entries()) {
		let calls = 0;
		const definition = defineProduct({
			namespace: "test",
			id: `codec-parity-${index}`,
			version: 1,
		});
		const computation = defineComputation(
			definition,
			async () => {
				calls++;
				return value;
			},
			{ cache: productKeyValueCodec() },
		);
		const evaluate = async () => {
			const graph = createComputationGraph({ cache });
			graph.register(computation);
			return graph.get(computation.product("key"));
		};

		assert.deepEqual(await evaluate(), value);
		assert.deepEqual(await evaluate(), value);
		assert.equal(calls, 1);
	}

	let calls = 0;
	const optionalDefinition = defineProduct({
		namespace: "test",
		id: "optional-codec-parity",
		version: 1,
	});
	const optional = defineComputation(
		optionalDefinition,
		async () => {
			calls++;
			return undefined;
		},
		{ cache: optionalProductKeyCodec() },
	);
	const evaluateOptional = async () => {
		const graph = createComputationGraph({ cache });
		graph.register(optional);
		return graph.get(optional.product("key"));
	};
	assert.equal(await evaluateOptional(), undefined);
	assert.equal(await evaluateOptional(), undefined);
	assert.equal(calls, 1);
});

test("cache codecs reject unsupported runtime shapes before caching", async () => {
	for (const [index, value] of [
		undefined,
		new Map(),
		new Set(),
		new Date(),
	].entries()) {
		const graph = createComputationGraph({
			cache: createMemoryComputationCache(),
		});
		const definition = defineProduct({
			namespace: "test",
			id: `unsupported-codec-${index}`,
			version: 1,
		});
		const computation = defineComputation(definition, async () => value, {
			cache: productKeyValueCodec(),
		});
		graph.register(computation);
		await assert.rejects(graph.get(computation.product("key")), /Product key/);
	}
});

test("invalidates only transitive dependents of changed inputs", async () => {
	const graph = createComputationGraph();
	const sourceCalls = { count: 0 };
	const unrelatedCalls = { count: 0 };
	const derivedCalls = { count: 0 };
	const source = inputComputation("source", "source", sourceCalls);
	const unrelated = inputComputation("unrelated", "unrelated", unrelatedCalls);
	const derivedDefinition = defineProduct({
		namespace: "test",
		id: "derived",
		version: 1,
	});
	const derived = defineComputation(derivedDefinition, async (context, key) => {
		derivedCalls.count++;
		return `${await context.get(source.product(key))}!`;
	});
	graph.register(source);
	graph.register(unrelated);
	graph.register(derived);

	const initial = graph.beginUpdate();
	initial.setInput("source", "a");
	initial.setInput("unrelated", "x");
	initial.commit();
	assert.equal(await graph.get(derived.product("file")), "a!");
	assert.equal(await graph.get(unrelated.product("file")), "x");

	const changed = graph.beginUpdate();
	changed.setInput("source", "b");
	changed.commit();
	assert.equal(await graph.get(derived.product("file")), "b!");
	assert.equal(await graph.get(unrelated.product("file")), "x");

	assert.equal(sourceCalls.count, 2);
	assert.equal(derivedCalls.count, 2);
	assert.equal(unrelatedCalls.count, 1);
});

test("restores content-addressed results after validating direct dependency hashes", async () => {
	const cache = createMemoryComputationCache();
	const sourceCalls = { count: 0 };
	const derivedCalls = { count: 0 };
	const source = inputComputation("cached-source", "source", sourceCalls);
	const derivedDefinition = defineProduct({
		namespace: "test",
		id: "cached-derived",
		version: 1,
	});
	const derived = defineComputation(
		derivedDefinition,
		async (context, key) => {
			derivedCalls.count++;
			return `${await context.get(source.product(key))}!`;
		},
		{ cache: productKeyCodec() },
	);

	const createGraph = (value) => {
		const graph = createComputationGraph({ cache });
		graph.register(source);
		graph.register(derived);
		const update = graph.beginUpdate();
		update.setInput("source", value);
		update.commit();
		return graph;
	};

	assert.equal(await createGraph("a").get(derived.product("file")), "a!");
	assert.equal(await createGraph("a").get(derived.product("file")), "a!");
	assert.equal(sourceCalls.count, 1);
	assert.equal(derivedCalls.count, 1);

	assert.equal(await createGraph("b").get(derived.product("file")), "b!");
	assert.equal(sourceCalls.count, 2);
	assert.equal(derivedCalls.count, 2);
});

test("cacheable parents reuse fingerprints from non-serializable dependencies", async () => {
	const cache = createMemoryComputationCache();
	let sourceCalls = 0;
	let derivedCalls = 0;
	const sourceDefinition = defineProduct({
		namespace: "test",
		id: "non-serializable-source",
		version: 1,
	});
	const source = defineComputation(sourceDefinition, async (context) => {
		sourceCalls++;
		return { value: await context.input("source"), runtime: new Map() };
	});
	const derivedDefinition = defineProduct({
		namespace: "test",
		id: "serializable-derived",
		version: 1,
	});
	const derived = defineComputation(
		derivedDefinition,
		async (context, key) => {
			derivedCalls++;
			return (await context.get(source.product(key))).value;
		},
		{ cache: productKeyCodec() },
	);
	const evaluate = async () => {
		const graph = createComputationGraph({ cache });
		graph.register(source);
		graph.register(derived);
		const update = graph.beginUpdate();
		update.setInput("source", "stable");
		update.commit();
		return graph.get(derived.product("file"));
	};

	assert.equal(await evaluate(), "stable");
	assert.equal(await evaluate(), "stable");
	assert.equal(sourceCalls, 2);
	assert.equal(derivedCalls, 1);
});

test("aggregates product-owned diagnostics and uncertainty from dependencies", async () => {
	const graph = createComputationGraph();
	const sourceDefinition = defineProduct({
		namespace: "test",
		id: "reported-source",
		version: 1,
	});
	const source = defineComputation(sourceDefinition, async () => "source", {
		diagnostics() {
			return [
				{
					severity: "warning",
					code: "SOURCE_WARNING",
					message: "source warning",
					phase: "parse",
				},
			];
		},
		uncertainty() {
			return [{ code: "SOURCE_OPAQUE", message: "source is opaque" }];
		},
	});
	const derivedDefinition = defineProduct({
		namespace: "test",
		id: "reported-derived",
		version: 1,
	});
	const derived = defineComputation(
		derivedDefinition,
		async (context, key) => `${await context.get(source.product(key))}!`,
		{
			diagnostics() {
				return [
					{
						severity: "error",
						code: "DERIVED_ERROR",
						message: "derived error",
						phase: "check",
					},
				];
			},
		},
	);
	graph.register(source);
	graph.register(derived);

	const metadata = await graph.metadata(derived.product("file"));
	assert.deepEqual(
		metadata.diagnostics.map((diagnostic) => diagnostic.code).sort(),
		["DERIVED_ERROR", "SOURCE_WARNING"],
	);
	assert.deepEqual(metadata.uncertainty, [
		{ code: "SOURCE_OPAQUE", message: "source is opaque" },
	]);
});

test("same-value and rolled-back updates preserve memoized products", async () => {
	const graph = createComputationGraph();
	const calls = { count: 0 };
	const source = inputComputation("source", "source", calls);
	graph.register(source);
	const initial = graph.beginUpdate();
	initial.setInput("source", "a");
	initial.commit();
	assert.equal(await graph.get(source.product("file")), "a");

	const unchanged = graph.beginUpdate();
	unchanged.setInput("source", "a");
	assert.equal(unchanged.commit(), graph.revision);
	const rolledBack = graph.beginUpdate();
	rolledBack.setInput("source", "b");
	rolledBack.rollback();
	assert.equal(await graph.get(source.product("file")), "a");
	assert.equal(calls.count, 1);
});

test("rejects computation cycles instead of deadlocking", async () => {
	const graph = createComputationGraph();
	const leftDefinition = defineProduct({
		namespace: "test",
		id: "left",
		version: 1,
	});
	const rightDefinition = defineProduct({
		namespace: "test",
		id: "right",
		version: 1,
	});
	const left = defineComputation(leftDefinition, async (context, key) =>
		context.get(right.product(key)),
	);
	const right = defineComputation(rightDefinition, async (context, key) =>
		context.get(left.product(key)),
	);
	graph.register(left);
	graph.register(right);

	await assert.rejects(graph.get(left.product("file")), ComputationCycleError);
});

test("rejects three-node concurrent wait cycles with two roots", async () => {
	const graph = createComputationGraph();
	const definition = (id) =>
		defineProduct({ namespace: "test", id, version: 1 });
	const aDefinition = definition("concurrent-a");
	const bDefinition = definition("concurrent-b");
	const cDefinition = definition("concurrent-c");
	const deferred = () => {
		let resolve;
		const promise = new Promise((done) => {
			resolve = done;
		});
		return { promise, resolve };
	};
	const roots = deferred();
	const children = deferred();
	const aStarted = deferred();
	const bStarted = deferred();
	const cStarted = deferred();
	const a = defineComputation(aDefinition, async (context, key) => {
		aStarted.resolve();
		await roots.promise;
		return context.get(b.product(key));
	});
	const b = defineComputation(bDefinition, async (context, key) => {
		bStarted.resolve();
		await children.promise;
		return context.get(c.product(key));
	});
	const c = defineComputation(cDefinition, async (context, key) => {
		cStarted.resolve();
		await children.promise;
		return context.get(a.product(key));
	});
	graph.register(a);
	graph.register(b);
	graph.register(c);

	const pending = Promise.allSettled([
		graph.get(a.product("file")),
		graph.get(c.product("file")),
	]);
	await Promise.all([aStarted.promise, cStarted.promise]);
	roots.resolve();
	await bStarted.promise;
	children.resolve();

	const results = await pending;
	assert.equal(
		results.every(
			(result) =>
				result.status === "rejected" &&
				result.reason instanceof ComputationCycleError,
		),
		true,
	);
});

test("rejects requests pinned to obsolete revisions", async () => {
	const graph = createComputationGraph();
	const calls = { count: 0 };
	const source = inputComputation("source", "source", calls);
	graph.register(source);
	const first = graph.beginUpdate();
	first.setInput("source", "a");
	const oldRevision = first.commit();
	const second = graph.beginUpdate();
	second.setInput("source", "b");
	second.commit();

	await assert.rejects(
		graph.get(source.product("file"), { revision: oldRevision }),
		ObsoleteComputationRevisionError,
	);
});

test("caller cancellation does not poison shared memoization", async () => {
	const graph = createComputationGraph();
	const definition = defineProduct({
		namespace: "test",
		id: "slow",
		version: 1,
	});
	let resolve;
	let calls = 0;
	const computation = defineComputation(definition, async () => {
		calls++;
		return new Promise((done) => {
			resolve = done;
		});
	});
	graph.register(computation);
	const controller = new AbortController();
	const cancelled = graph.get(computation.product("file"), {
		signal: controller.signal,
	});
	const retained = graph.get(computation.product("file"));
	await new Promise((done) => setImmediate(done));
	controller.abort();
	await assert.rejects(cancelled, { name: "AbortError" });
	resolve("done");

	assert.equal(await retained, "done");
	assert.equal(await graph.get(computation.product("file")), "done");
	assert.equal(calls, 1);
});
