import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	compareVersions,
	componentFolderName,
	FileSystemRegistry,
	parseComponentId,
} from "../dist/index.js";

const component = (id, version, dependencies = {}, files = {}) => ({
	id,
	version,
	dependencies,
	files: { "nazare.json": JSON.stringify({ id, version }), ...files },
});

async function withRegistry(fn) {
	const dir = mkdtempSync(join(tmpdir(), "nazare-reg-"));
	try {
		await fn(new FileSystemRegistry(dir));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("parseComponentId splits scope and name; rejects malformed ids", () => {
	assert.deepEqual(parseComponentId("@nazare/counter"), {
		scope: "nazare",
		name: "counter",
	});
	assert.equal(componentFolderName("@nazare/counter"), "counter");
	assert.throws(() => parseComponentId("counter"));
	assert.throws(() => parseComponentId("@nazare/"));
});

test("compareVersions orders numerically, not lexically", () => {
	assert.ok(compareVersions("0.2.0", "0.10.0") < 0);
	assert.ok(compareVersions("1.0.0", "0.9.9") > 0);
	assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
});

test("fake registry round-trips publish -> fetch and resolves latest", async () => {
	await withRegistry(async (registry) => {
		await registry.publish(component("@nazare/link", "0.1.0"), "t");
		await registry.publish(component("@nazare/link", "0.2.0"), "t");

		const meta = await registry.fetchMetadata("@nazare/link");
		assert.deepEqual(meta, {
			id: "@nazare/link",
			latest: "0.2.0",
			versions: ["0.1.0", "0.2.0"],
		});

		const exact = await registry.fetchComponent("@nazare/link", "0.1.0");
		assert.equal(exact.version, "0.1.0");
		const latest = await registry.fetchComponent("@nazare/link", "latest");
		assert.equal(latest.version, "0.2.0");
	});
});

test("fake registry returns undefined for unknown id or version", async () => {
	await withRegistry(async (registry) => {
		assert.equal(await registry.fetchMetadata("@nazare/nope"), undefined);
		assert.equal(
			await registry.fetchComponent("@nazare/nope", "0.1.0"),
			undefined,
		);
		await registry.publish(component("@nazare/link", "0.1.0"), "t");
		assert.equal(
			await registry.fetchComponent("@nazare/link", "9.9.9"),
			undefined,
		);
	});
});

test("fake registry refuses to overwrite a published version", async () => {
	await withRegistry(async (registry) => {
		const first = await registry.publish(
			component("@nazare/link", "0.1.0"),
			"t",
		);
		assert.equal(first.ok, true);
		const second = await registry.publish(
			component("@nazare/link", "0.1.0"),
			"t",
		);
		assert.equal(second.ok, false);
		assert.equal(second.code, "VERSION_EXISTS");
	});
});
