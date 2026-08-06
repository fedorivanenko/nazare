import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createComputationGraph,
	createFileSystemComputationCache,
	createMemoryComputationCache,
	DEFAULT_MEMORY_COMPUTATION_CACHE_MAX_ENTRIES,
	defineComputation,
	defineProduct,
	fingerprintProductKey,
	productKeyCodec,
} from "../dist/testing.js";

const entry = (snapshot) => ({
	snapshot,
	snapshotFingerprint: fingerprintProductKey(snapshot),
	productFingerprint: fingerprintProductKey("product"),
	dependencies: [],
});

async function withCacheDirectory(run) {
	const directory = await mkdtemp(join(tmpdir(), "nazare-computation-cache-"));
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("memory cache evicts least recently used entries when bounded", async () => {
	const cache = createMemoryComputationCache({ maxEntries: 2 });
	await cache.write("first", entry("first"));
	await cache.write("second", entry("second"));
	await cache.read("first");
	await cache.write("third", entry("third"));

	assert.deepEqual(await cache.read("first"), entry("first"));
	assert.equal(await cache.read("second"), undefined);
	assert.deepEqual(await cache.read("third"), entry("third"));
});

test("memory cache applies a bounded default retention limit", async () => {
	const cache = createMemoryComputationCache();
	for (
		let index = 0;
		index <= DEFAULT_MEMORY_COMPUTATION_CACHE_MAX_ENTRIES;
		index++
	) {
		await cache.write(String(index), entry(index));
	}

	assert.equal(await cache.read("0"), undefined);
	assert.deepEqual(
		await cache.read(String(DEFAULT_MEMORY_COMPUTATION_CACHE_MAX_ENTRIES)),
		entry(DEFAULT_MEMORY_COMPUTATION_CACHE_MAX_ENTRIES),
	);
});

test("memory cache rejects invalid retention limits", () => {
	assert.throws(
		() => createMemoryComputationCache({ maxEntries: 0 }),
		/Memory computation cache maxEntries must be a positive integer/,
	);
});

test("filesystem cache round-trips validated computation entries", async () => {
	await withCacheDirectory(async (directory) => {
		const cache = createFileSystemComputationCache({ directory });
		const snapshot = { files: ["a.liquid"], valid: true };
		const entry = {
			snapshot,
			snapshotFingerprint: fingerprintProductKey(snapshot),
			productFingerprint: fingerprintProductKey("product"),
			dependencies: [
				{
					kind: "input",
					key: "config",
					fingerprint: fingerprintProductKey("strict"),
				},
			],
		};

		await cache.write("nazare:test@1:key", entry);
		assert.deepEqual(await cache.read("nazare:test@1:key"), entry);
		await cache.delete("nazare:test@1:key");
		assert.equal(await cache.read("nazare:test@1:key"), undefined);
	});
});

test("filesystem cache removes malformed entries", async () => {
	await withCacheDirectory(async (directory) => {
		const cache = createFileSystemComputationCache({ directory });
		const snapshot = "valid";
		await cache.write("nazare:test@1:key", {
			snapshot,
			snapshotFingerprint: fingerprintProductKey(snapshot),
			productFingerprint: fingerprintProductKey("product"),
			dependencies: [],
		});
		const files = (await readdir(directory, { recursive: true }))
			.filter((path) => path.endsWith(".json"))
			.map((path) => join(directory, path));
		assert.equal(files.length, 1);
		await writeFile(files[0], "{not-json", "utf8");

		assert.equal(await cache.read("nazare:test@1:key"), undefined);
		assert.deepEqual(
			(await readdir(directory, { recursive: true })).filter((path) =>
				path.endsWith(".json"),
			),
			[],
		);
	});
});

test("filesystem cache restores graph products across graph instances", async () => {
	await withCacheDirectory(async (directory) => {
		let calls = 0;
		const definition = defineProduct({
			namespace: "test",
			id: "persistent-product",
			version: 1,
		});
		const computation = defineComputation(
			definition,
			async (context) => {
				calls++;
				return `${await context.input("source")}!`;
			},
			{ cache: productKeyCodec() },
		);
		const evaluate = async () => {
			const graph = createComputationGraph({
				cache: createFileSystemComputationCache({ directory }),
			});
			graph.register(computation);
			const update = graph.beginUpdate();
			update.setInput("source", "cached");
			update.commit();
			return graph.get(computation.product("file"));
		};

		assert.equal(await evaluate(), "cached!");
		assert.equal(await evaluate(), "cached!");
		assert.equal(calls, 1);
	});
});

test("filesystem cache restores deeply frozen output-plan-like runtime values", async () => {
	await withCacheDirectory(async (directory) => {
		let calls = 0;
		const nullPrototype = Object.create(null);
		Object.defineProperty(nullPrototype, "negativeZero", {
			value: -0,
			enumerable: false,
			configurable: false,
			writable: false,
		});
		Object.freeze(nullPrototype);
		const write = Object.freeze({
			path: "sections/example.liquid",
			contents: "<section />",
			ownerId: "source:example",
		});
		const nonExtensible = Object.preventExtensions(
			Object.defineProperty({}, "hidden", {
				value: "descriptor",
				enumerable: false,
				configurable: true,
				writable: false,
			}),
		);
		const sealed = Object.seal({ mutable: true });
		const expected = Object.freeze({
			version: 1,
			writes: Object.freeze([write]),
			deletes: Object.freeze([]),
			metadata: nullPrototype,
			nonExtensible,
			sealed,
		});
		const definition = defineProduct({
			namespace: "test",
			id: "persistent-runtime-shape",
			version: 1,
		});
		const computation = defineComputation(
			definition,
			async () => {
				calls++;
				return expected;
			},
			{ cache: productKeyCodec() },
		);
		const evaluate = async () => {
			const graph = createComputationGraph({
				cache: createFileSystemComputationCache({ directory }),
			});
			graph.register(computation);
			return graph.get(computation.product("key"));
		};

		assertRuntimeShape(await evaluate(), expected);
		assertRuntimeShape(await evaluate(), expected);
		assert.equal(calls, 1);
	});
});

test("filesystem cache rejects snapshot fingerprint corruption and recomputes", async () => {
	await withCacheDirectory(async (directory) => {
		let calls = 0;
		const definition = defineProduct({
			namespace: "test",
			id: "corrupt-snapshot",
			version: 1,
		});
		const computation = defineComputation(
			definition,
			async () => {
				calls++;
				return Object.freeze({ value: "fresh" });
			},
			{ cache: productKeyCodec() },
		);
		const evaluate = async () => {
			const graph = createComputationGraph({
				cache: createFileSystemComputationCache({ directory }),
			});
			graph.register(computation);
			return graph.get(computation.product("key"));
		};

		await evaluate();
		const [path] = (await readdir(directory, { recursive: true }))
			.filter((entry) => entry.endsWith(".json"))
			.map((entry) => join(directory, entry));
		const persisted = JSON.parse(await readFile(path, "utf8"));
		persisted.entry.snapshotFingerprint = "0".repeat(64);
		await writeFile(path, JSON.stringify(persisted), "utf8");

		assertRuntimeShape(await evaluate(), Object.freeze({ value: "fresh" }));
		assert.equal(calls, 2);
	});
});

test("cache codecs reject accessors, functions, and symbol keys", async () => {
	const accessor = {};
	Object.defineProperty(accessor, "value", {
		get: () => true,
		enumerable: true,
	});
	const symbol = { value: true };
	symbol[Symbol("hidden")] = "hidden";
	for (const [index, value] of [
		accessor,
		{ value: () => true },
		symbol,
	].entries()) {
		const graph = createComputationGraph({
			cache: createMemoryComputationCache(),
		});
		const definition = defineProduct({
			namespace: "test",
			id: `unsupported-runtime-shape-${index}`,
			version: 1,
		});
		const computation = defineComputation(definition, async () => value, {
			cache: productKeyCodec(),
		});
		graph.register(computation);
		await assert.rejects(graph.get(computation.product("key")), /Product key/);
	}
});

function assertRuntimeShape(actual, expected) {
	assert.equal(Object.getPrototypeOf(actual), Object.getPrototypeOf(expected));
	assert.equal(Object.isExtensible(actual), Object.isExtensible(expected));
	assert.equal(Object.isSealed(actual), Object.isSealed(expected));
	assert.equal(Object.isFrozen(actual), Object.isFrozen(expected));
	const actualDescriptors = Object.getOwnPropertyDescriptors(actual);
	const expectedDescriptors = Object.getOwnPropertyDescriptors(expected);
	assert.deepEqual(
		Object.keys(actualDescriptors),
		Object.keys(expectedDescriptors),
	);
	for (const key of Object.keys(expectedDescriptors)) {
		const actualDescriptor = actualDescriptors[key];
		const expectedDescriptor = expectedDescriptors[key];
		assert.deepEqual(
			{
				enumerable: actualDescriptor.enumerable,
				configurable: actualDescriptor.configurable,
				writable: actualDescriptor.writable,
			},
			{
				enumerable: expectedDescriptor.enumerable,
				configurable: expectedDescriptor.configurable,
				writable: expectedDescriptor.writable,
			},
		);
		if (
			actualDescriptor &&
			expectedDescriptor &&
			"value" in actualDescriptor &&
			"value" in expectedDescriptor
		) {
			if (
				actualDescriptor.value &&
				typeof actualDescriptor.value === "object"
			) {
				assertRuntimeShape(actualDescriptor.value, expectedDescriptor.value);
			} else {
				assert.equal(actualDescriptor.value, expectedDescriptor.value);
				assert.equal(
					Object.is(actualDescriptor.value, -0),
					Object.is(expectedDescriptor.value, -0),
				);
			}
		}
	}
}

test("filesystem cache hashes cache keys into contained paths", async () => {
	await withCacheDirectory(async (directory) => {
		const cache = createFileSystemComputationCache({ directory });
		const snapshot = "safe";
		await cache.write("../../outside/private-source.liquid", {
			snapshot,
			snapshotFingerprint: fingerprintProductKey(snapshot),
			productFingerprint: fingerprintProductKey("product"),
			dependencies: [],
		});
		const entries = await readdir(directory, { recursive: true });

		assert.equal(
			entries.some((entry) => entry.includes("private-source")),
			false,
		);
		assert.equal(entries.filter((entry) => entry.endsWith(".json")).length, 1);
	});
});
