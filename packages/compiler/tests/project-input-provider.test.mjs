import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	compareProjectFileIds,
	createFileSystemInputProvider,
	createProjectMetadataInputProvider,
	normalizeProjectPath,
	PROJECT_METADATA_KEYS,
	projectFileId,
	sameProjectFileId,
	serializeProjectFileId,
} from "../dist/testing.js";

async function withDirectory(run) {
	const directory = await mkdtemp(join(tmpdir(), "nazare-project-input-"));
	try {
		await run(directory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test("project metadata provider revisions config and external Shopify inputs", async () => {
	const metadata = createProjectMetadataInputProvider({
		[PROJECT_METADATA_KEYS.config]: { inspect: { exclude: ["generated/**"] } },
		[PROJECT_METADATA_KEYS.metafields]: { state: "present", definitions: [] },
	});
	assert.deepEqual(await metadata.discover(), [
		PROJECT_METADATA_KEYS.config,
		PROJECT_METADATA_KEYS.metafields,
	]);
	assert.deepEqual(
		(await metadata.provider.read(PROJECT_METADATA_KEYS.config)).value,
		{ inspect: { exclude: ["generated/**"] } },
	);
	const watcher = metadata.provider.watch()[Symbol.asyncIterator]();
	metadata.set(
		PROJECT_METADATA_KEYS.themeCheck,
		"extends: theme-check:recommended",
	);
	const added = await watcher.next();
	assert.equal(added.value[0].kind, "added");
	assert.equal(added.value[0].key, PROJECT_METADATA_KEYS.themeCheck);
	metadata.remove(PROJECT_METADATA_KEYS.metafields);
	const removed = await watcher.next();
	assert.equal(removed.value[0].kind, "removed");
	metadata.close();
	assert.equal((await watcher.next()).done, true);
});

test("project file IDs normalize portable relative paths", () => {
	const id = projectFileId({
		workspace: "storefront",
		package: "@shop/theme",
		path: ".\\sections\\nested\\..\\card.liquid",
	});

	assert.deepEqual(id, {
		workspace: "storefront",
		package: "@shop/theme",
		path: "sections/card.liquid",
	});
	assert.equal(Object.isFrozen(id), true);
	assert.equal(
		sameProjectFileId(id, { ...id, path: "sections/./card.liquid" }),
		true,
	);
});

test("project paths reject absolute and escaping paths", () => {
	for (const path of [
		"",
		"/tmp/file",
		"C:\\tmp\\file",
		"../secret",
		"a/../../secret",
	]) {
		assert.throws(() => normalizeProjectPath(path), /path|escapes/);
	}
});

test("project file serialization and ordering are deterministic", () => {
	const left = projectFileId({ workspace: "a", package: "theme", path: "b" });
	const right = projectFileId({ workspace: "a", package: "theme", path: "c" });

	assert.equal(
		serializeProjectFileId(left),
		serializeProjectFileId({ ...left }),
	);
	assert.equal(compareProjectFileIds(left, right) < 0, true);
});

test("filesystem provider reads and fingerprints contained files", async () => {
	await withDirectory(async (root) => {
		await mkdir(join(root, "sections"));
		await writeFile(join(root, "sections/card.liquid"), "first", "utf8");
		const provider = createFileSystemInputProvider({
			root,
			workspace: "storefront",
			package: "theme",
		});
		const id = projectFileId({
			workspace: "storefront",
			package: "theme",
			path: "sections/card.liquid",
		});

		const first = await provider.read(id);
		await writeFile(join(root, "sections/card.liquid"), "second", "utf8");
		const second = await provider.read(id);
		assert.equal(first.value.contents, "first");
		assert.equal(second.value.contents, "second");
		assert.notEqual(first.fingerprint, second.fingerprint);
	});
});

test("filesystem provider rejects foreign IDs and escaping symlinks", async () => {
	await withDirectory(async (parent) => {
		const root = join(parent, "root");
		await mkdir(root);
		await writeFile(join(parent, "secret"), "secret", "utf8");
		await symlink(join(parent, "secret"), join(root, "escape.liquid"));
		const provider = createFileSystemInputProvider({
			root,
			workspace: "storefront",
			package: "theme",
		});

		await assert.rejects(
			provider.read({
				workspace: "other",
				package: "theme",
				path: "escape.liquid",
			}),
			/does not belong/,
		);
		await assert.rejects(
			provider.read({
				workspace: "storefront",
				package: "theme",
				path: "escape.liquid",
			}),
			/escapes provider root/,
		);
	});
});
