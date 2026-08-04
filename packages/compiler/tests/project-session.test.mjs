import assert from "node:assert/strict";
import test from "node:test";
import {
	coalesceInputChanges,
	createProjectSession,
	defineComputation,
	defineInputProvider,
	defineProduct,
	defineProjectHost,
	fingerprintProductKey,
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
	const update = await session.apply([
		{ kind: "changed", key: a, fingerprint: "a2" },
		{ kind: "added", key: b, fingerprint: "b1" },
		{ kind: "removed", key: a },
	]);

	assert.equal(update.committed, true);
	assert.equal(update.revision, 2);
	assert.deepEqual(
		session.snapshot().fileIds.map((file) => file.path),
		["b.liquid"],
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
	await session.apply([
		{ kind: "changed", key: fileId, fingerprint: "changed" },
	]);
	const second = await session.graph.get(product);
	assert.notEqual(first, second);
	assert.equal(calls, 2);
});
