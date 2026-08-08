import assert from "node:assert/strict";
import {
	mkdir,
	mkdtemp,
	readFile,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createOwnedOutputPlan,
	createProtectedOwnedOutputPlan,
	executeOutputTransaction,
	FileSystemAtomicOutputStore,
	hashOutput,
	ObsoleteOutputRevisionError,
	OutputPreconditionError,
} from "../dist/testing.js";

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

test("filesystem output store rolls back when prepared output changed", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "nazare-output-race-"));
	const outputRoot = join(temporary, "theme");
	await mkdir(join(outputRoot, "config"), { recursive: true });
	const path = join(outputRoot, "config/settings_data.json");
	await writeFile(path, "before");
	const plan = createProtectedOwnedOutputPlan({
		writes: [
			{
				path: "config/settings_data.json",
				contents: "generated",
				ownerId: "merchant:data",
				ownership: "merchant",
			},
		],
		existing: {
			hashes: { "config/settings_data.json": hashOutput("before") },
			contents: { "config/settings_data.json": "before" },
			ownership: { version: 1, files: {} },
		},
	});
	await writeFile(path, "changed-after-prepare");

	await assert.rejects(
		executeOutputTransaction({
			plan,
			expectedRevision: 1,
			currentRevision: () => 1,
			store: new FileSystemAtomicOutputStore(outputRoot),
		}),
		OutputPreconditionError,
	);
	assert.equal(await readFile(path, "utf8"), "changed-after-prepare");
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

test("filesystem output store restores backups when revision changes after backup", async () => {
	const temporary = await mkdtemp(
		join(tmpdir(), "nazare-output-backup-stale-"),
	);
	const outputRoot = join(temporary, "theme");
	await mkdir(outputRoot, { recursive: true });
	await writeFile(join(outputRoot, "existing.txt"), "before");
	const plan = createOwnedOutputPlan({
		writes: [
			{ path: "existing.txt", contents: "after", ownerId: "component:test" },
		],
	});
	let revisionChecks = 0;

	await assert.rejects(
		executeOutputTransaction({
			plan,
			expectedRevision: 3,
			currentRevision: () => (++revisionChecks < 3 ? 3 : 4),
			store: new FileSystemAtomicOutputStore(outputRoot),
		}),
		ObsoleteOutputRevisionError,
	);
	assert.equal(
		await readFile(join(outputRoot, "existing.txt"), "utf8"),
		"before",
	);
});

test("filesystem output store rolls back publication failures", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "nazare-output-rollback-"));
	const outputRoot = join(temporary, "theme");
	await mkdir(join(outputRoot, "z-directory"), { recursive: true });
	await writeFile(join(outputRoot, "a.txt"), "old");
	const plan = createOwnedOutputPlan({
		writes: [
			{ path: "a.txt", contents: "new", ownerId: "component:a" },
			{ path: "z-directory", contents: "invalid", ownerId: "component:z" },
		],
	});

	await assert.rejects(
		executeOutputTransaction({
			plan,
			expectedRevision: 1,
			currentRevision: () => 1,
			store: new FileSystemAtomicOutputStore(outputRoot),
		}),
		/Output path is not a regular file/,
	);
	assert.equal(await readFile(join(outputRoot, "a.txt"), "utf8"), "old");
	assert.equal(
		(await stat(join(outputRoot, "z-directory"))).isDirectory(),
		true,
	);
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
