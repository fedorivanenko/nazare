import assert from "node:assert/strict";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createFileSystemProjectHost,
	diffProjectFileSnapshots,
	discoverProjectFiles,
	fingerprintProductKey,
	projectFileId,
} from "../dist/index.js";

async function withDirectory(run) {
	const directory = await mkdtemp(join(tmpdir(), "nazare-project-host-"));
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

function id(path) {
	return projectFileId({ workspace: "test", package: "theme", path });
}

test("discovers sorted project files while excluding generated directories", async () => {
	await withDirectory(async (root) => {
		await mkdir(join(root, "sections"));
		await mkdir(join(root, "node_modules/package"), { recursive: true });
		await mkdir(join(root, ".nazare-out"));
		await writeFile(join(root, "sections/z.liquid"), "z");
		await writeFile(join(root, "sections/a.liquid"), "a");
		await writeFile(join(root, "node_modules/package/index.js"), "ignored");
		await writeFile(join(root, ".nazare-out/cache"), "ignored");

		const files = await discoverProjectFiles({
			root,
			workspace: "test",
			package: "theme",
		});
		assert.deepEqual(
			files.map((file) => file.path),
			["sections/a.liquid", "sections/z.liquid"],
		);
	});
});

test("snapshot diff recognizes unique content-preserving moves", () => {
	const shared = fingerprintProductKey("same");
	const previous = [
		{ id: id("old.liquid"), fingerprint: shared },
		{ id: id("changed.liquid"), fingerprint: fingerprintProductKey("old") },
		{ id: id("removed.liquid"), fingerprint: fingerprintProductKey("removed") },
	];
	const current = [
		{ id: id("new.liquid"), fingerprint: shared },
		{ id: id("changed.liquid"), fingerprint: fingerprintProductKey("new") },
		{ id: id("added.liquid"), fingerprint: fingerprintProductKey("added") },
	];

	assert.deepEqual(
		diffProjectFileSnapshots(previous, current).map((change) => change.kind),
		["added", "changed", "moved", "removed"],
	);
	const moved = diffProjectFileSnapshots(previous, current).find(
		(change) => change.kind === "moved",
	);
	assert.equal(moved.from.path, "old.liquid");
	assert.equal(moved.key.path, "new.liquid");
});

test("filesystem host emits a coalesced change batch", async () => {
	await withDirectory(async (root) => {
		await writeFile(join(root, "before.liquid"), "before");
		const host = createFileSystemProjectHost({
			root,
			workspace: "test",
			package: "theme",
			watchDebounceMs: 20,
		});
		const watcher = host.watch()[Symbol.asyncIterator]();
		const next = watcher.next();
		await new Promise((resolve) => setTimeout(resolve, 100));
		await rename(join(root, "before.liquid"), join(root, "after.liquid"));
		const result = await Promise.race([
			next,
			new Promise((_, reject) =>
				setTimeout(() => reject(new Error("watch timeout")), 3_000),
			),
		]);
		await watcher.return();

		assert.equal(result.done, false);
		assert.equal(result.value.length, 1);
		assert.equal(result.value[0].kind, "moved");
		assert.equal(result.value[0].from.path, "before.liquid");
		assert.equal(result.value[0].key.path, "after.liquid");
	});
});
