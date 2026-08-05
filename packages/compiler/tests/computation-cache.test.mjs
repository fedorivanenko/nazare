import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createComputationGraph,
	createFileSystemComputationCache,
	createMemoryComputationCache,
	defineComputation,
	defineProduct,
	fingerprintProductKey,
	productKeyCodec,
} from "../dist/testing.js";

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
	const entry = (value) => ({
		value,
		valueFingerprint: fingerprintProductKey(value),
		productFingerprint: fingerprintProductKey("product"),
		dependencies: [],
	});

	await cache.write("first", entry("first"));
	await cache.write("second", entry("second"));
	await cache.read("first");
	await cache.write("third", entry("third"));

	assert.deepEqual(await cache.read("first"), entry("first"));
	assert.equal(await cache.read("second"), undefined);
	assert.deepEqual(await cache.read("third"), entry("third"));
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
		const value = { files: ["a.liquid"], valid: true };
		const entry = {
			value,
			valueFingerprint: fingerprintProductKey(value),
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
		const value = "valid";
		await cache.write("nazare:test@1:key", {
			value,
			valueFingerprint: fingerprintProductKey(value),
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

test("filesystem cache hashes cache keys into contained paths", async () => {
	await withCacheDirectory(async (directory) => {
		const cache = createFileSystemComputationCache({ directory });
		const value = "safe";
		await cache.write("../../outside/private-source.liquid", {
			value,
			valueFingerprint: fingerprintProductKey(value),
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
