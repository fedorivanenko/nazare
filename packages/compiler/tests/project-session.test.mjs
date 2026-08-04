import assert from "node:assert/strict";
import test from "node:test";
import {
	coalesceInputChanges,
	createProjectSession,
	defineComputation,
	defineInputProvider,
	defineProduct,
	defineProjectHost,
	externalProjectInput,
	fingerprintProductKey,
	mergeAsyncIterables,
	projectFileId,
	projectFileRevisionInput,
} from "../dist/index.js";

function createMemoryProject(initial) {
	const files = new Map(
		initial.map(({ id, contents }) => [JSON.stringify(id), { id, contents }]),
	);
	const provider = defineInputProvider({
		id: "test.files",
		version: 1,
		async read(id) {
			const file = files.get(JSON.stringify(id));
			if (!file) throw new Error(`Missing test file ${id.path}`);
			return { value: file, fingerprint: fingerprintProductKey(file) };
		},
	});
	return {
		files,
		host: defineProjectHost({
			files: provider,
			async discover() {
				return [...files.values()].map((file) => file.id);
			},
		}),
	};
}

function id(path) {
	return projectFileId({ workspace: "test", package: "theme", path });
}

test("coalesces noisy watcher changes deterministically", () => {
	const a = id("a.liquid");
	const b = id("b.liquid");
	assert.deepEqual(
		coalesceInputChanges([
			{ kind: "added", key: a, fingerprint: "a1" },
			{ kind: "changed", key: a, fingerprint: "a2" },
			{ kind: "added", key: b, fingerprint: "b1" },
			{ kind: "removed", key: b },
		]),
		[{ kind: "added", key: a, fingerprint: "a2" }],
	);
});

test("opens a deterministic revisioned project snapshot", async () => {
	const project = createMemoryProject([
		{ id: id("b.liquid"), contents: "b" },
		{ id: id("a.liquid"), contents: "a" },
	]);
	const session = await createProjectSession({ host: project.host });

	assert.equal(session.snapshot().revision, 1);
	assert.deepEqual(
		session.snapshot().fileIds.map((file) => file.path),
		["a.liquid", "b.liquid"],
	);
});

test("applies add, change, and delete as one atomic revision", async () => {
	const a = id("a.liquid");
	const b = id("b.liquid");
	const project = createMemoryProject([{ id: a, contents: "a" }]);
	const session = await createProjectSession({ host: project.host });
	const update = await session.apply({
		kind: "files",
		changes: [
			{ kind: "changed", key: a, fingerprint: "a2" },
			{ kind: "added", key: b, fingerprint: "b1" },
			{ kind: "removed", key: a },
		],
	});

	assert.equal(update.committed, true);
	assert.equal(update.revision, 2);
	assert.deepEqual(
		session.snapshot().fileIds.map((file) => file.path),
		["b.liquid"],
	);
});

test("applies moves as one atomic remove and add revision", async () => {
	const before = id("before.liquid");
	const after = id("after.liquid");
	const project = createMemoryProject([{ id: before, contents: "same" }]);
	const session = await createProjectSession({ host: project.host });
	const update = await session.apply({
		kind: "files",
		changes: [
			{
				kind: "moved",
				from: before,
				key: after,
				fingerprint: fingerprintProductKey("same"),
			},
		],
	});

	assert.equal(update.committed, true);
	assert.equal(update.revision, 2);
	assert.deepEqual(
		session.snapshot().fileIds.map((file) => file.path),
		["after.liquid"],
	);
});

test("external inputs participate in snapshots and graph invalidation", async () => {
	const project = createMemoryProject([{ id: id("a.liquid"), contents: "a" }]);
	const values = new Map([["schema", { version: 1 }]]);
	const external = defineInputProvider({
		id: "test.schema",
		version: 1,
		async read(key) {
			const value = values.get(key);
			if (!value) throw new Error(`Missing external input ${key}`);
			return { value, fingerprint: fingerprintProductKey(value) };
		},
	});
	const host = defineProjectHost({
		...project.host,
		externalInputs: [
			{
				provider: external,
				async discover() {
					return ["schema"];
				},
			},
		],
	});
	const session = await createProjectSession({ host });
	assert.equal(session.snapshot().externalInputs[0].providerId, "test.schema");

	const definition = defineProduct({
		namespace: "test",
		id: "external-revision",
		version: 1,
	});
	let calls = 0;
	const computation = defineComputation(definition, async (context, key) => {
		calls++;
		return context.input(externalProjectInput("test.schema", 1, key));
	});
	session.graph.register(computation);
	const product = computation.product("schema");
	const first = await session.get(product);
	const nextFingerprint = fingerprintProductKey({ version: 2 });
	const update = await session.apply({
		kind: "external",
		providerId: "test.schema",
		changes: [{ kind: "changed", key: "schema", fingerprint: nextFingerprint }],
	});
	const second = await session.get(product);

	assert.equal(update.committed, true);
	assert.notEqual(first, second);
	assert.equal(second, nextFingerprint);
	assert.equal(calls, 2);
});

test("failed session validation preserves the previous revision", async () => {
	const project = createMemoryProject([{ id: id("a.liquid"), contents: "a" }]);
	const session = await createProjectSession({
		host: project.host,
		validators: [
			(snapshot) =>
				snapshot.fileIds.some((file) => file.path === "forbidden.liquid")
					? [
							{
								severity: "error",
								code: "FORBIDDEN_FILE",
								message: "forbidden file",
								phase: "check",
							},
						]
					: [],
		],
	});
	const revision = session.snapshot().revision;
	const update = await session.apply({
		kind: "files",
		changes: [
			{
				kind: "added",
				key: id("forbidden.liquid"),
				fingerprint: fingerprintProductKey("forbidden"),
			},
		],
	});

	assert.equal(update.committed, false);
	assert.equal(update.diagnostics[0].code, "FORBIDDEN_FILE");
	assert.equal(session.snapshot().revision, revision);
	assert.deepEqual(
		session.snapshot().fileIds.map((file) => file.path),
		["a.liquid"],
	);
});

test("merged watchers forward values from every provider", async () => {
	async function* values(prefix, delay) {
		await new Promise((resolve) => setTimeout(resolve, delay));
		yield `${prefix}:1`;
		yield `${prefix}:2`;
	}
	const merged = [];
	for await (const value of mergeAsyncIterables([
		values("files", 5),
		values("external", 0),
	])) {
		merged.push(value);
	}
	assert.deepEqual(
		new Set(merged),
		new Set(["files:1", "files:2", "external:1", "external:2"]),
	);
});

test("session file revisions invalidate dependent graph products", async () => {
	const fileId = id("a.liquid");
	const project = createMemoryProject([{ id: fileId, contents: "a" }]);
	const session = await createProjectSession({ host: project.host });
	const definition = defineProduct({
		namespace: "test",
		id: "file-revision",
		version: 1,
	});
	let calls = 0;
	const computation = defineComputation(definition, async (context, key) => {
		calls++;
		return context.input(projectFileRevisionInput(key));
	});
	session.graph.register(computation);

	const product = computation.product(fileId);
	const first = await session.graph.get(product);
	await session.apply({
		kind: "files",
		changes: [{ kind: "changed", key: fileId, fingerprint: "changed" }],
	});
	const second = await session.graph.get(product);
	assert.notEqual(first, second);
	assert.equal(calls, 2);
});
