import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createOwnedOutputPlan,
	executeOutputTransaction,
	FileSystemAtomicOutputStore,
	ObsoleteOutputRevisionError,
} from "../dist/index.js";

test("filesystem output store publishes owned writes and deletions only", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "nazare-output-"));
	const outputRoot = join(temporary, "theme");
	await mkdir(join(outputRoot, "assets"), { recursive: true });
	await mkdir(join(outputRoot, "config"), { recursive: true });
	await writeFile(join(outputRoot, "assets/old.js"), "old");
	await writeFile(join(outputRoot, "config/settings_data.json"), "merchant");
	const plan = createOwnedOutputPlan({
		writes: [
			{ path: "assets/new.js", contents: "new", ownerId: "component:new" },
		],
		previouslyOwnedPaths: ["assets/old.js"],
	});

	await executeOutputTransaction({
		plan,
		expectedRevision: 3,
		currentRevision: () => 3,
		store: new FileSystemAtomicOutputStore(outputRoot),
	});

	assert.equal(
		await readFile(join(outputRoot, "assets/new.js"), "utf8"),
		"new",
	);
	await assert.rejects(readFile(join(outputRoot, "assets/old.js"), "utf8"), {
		code: "ENOENT",
	});
	assert.equal(
		await readFile(join(outputRoot, "config/settings_data.json"), "utf8"),
		"merchant",
	);
});

test("filesystem output store discards staging when revision becomes obsolete", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "nazare-output-stale-"));
	const outputRoot = join(temporary, "theme");
	let revisionReads = 0;
	const plan = createOwnedOutputPlan({
		writes: [
			{ path: "assets/new.js", contents: "new", ownerId: "component:new" },
		],
	});

	await assert.rejects(
		executeOutputTransaction({
			plan,
			expectedRevision: 3,
			currentRevision: () => (revisionReads++ === 0 ? 3 : 4),
			store: new FileSystemAtomicOutputStore(outputRoot),
		}),
		ObsoleteOutputRevisionError,
	);
	await assert.rejects(readFile(join(outputRoot, "assets/new.js"), "utf8"), {
		code: "ENOENT",
	});
});

test("filesystem output store rejects symbolic-link output traversal", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "nazare-output-link-"));
	const outputRoot = join(temporary, "theme");
	const externalRoot = join(temporary, "external");
	await mkdir(outputRoot, { recursive: true });
	await mkdir(externalRoot, { recursive: true });
	await symlink(externalRoot, join(outputRoot, "assets"));
	const plan = createOwnedOutputPlan({
		writes: [
			{ path: "assets/new.js", contents: "new", ownerId: "component:new" },
		],
	});

	await assert.rejects(
		executeOutputTransaction({
			plan,
			expectedRevision: 1,
			currentRevision: () => 1,
			store: new FileSystemAtomicOutputStore(outputRoot),
		}),
		/Output path traverses a symbolic link/,
	);
	await assert.rejects(readFile(join(externalRoot, "new.js"), "utf8"), {
		code: "ENOENT",
	});
});
