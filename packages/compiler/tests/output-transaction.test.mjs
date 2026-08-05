import assert from "node:assert/strict";
import test from "node:test";
import {
	createOwnedOutputPlan,
	executeOutputTransaction,
	ObsoleteOutputRevisionError,
	OutputPlanValidationError,
} from "../dist/testing.js";

function memoryStore(files = new Map()) {
	return {
		files,
		commits: 0,
		async atomicCommit(commit) {
			if (!commit.isCurrentRevision()) return false;
			const candidate = new Map(files);
			for (const path of commit.plan.deletes) candidate.delete(path);
			for (const file of commit.plan.writes)
				candidate.set(file.path, file.contents);
			if (!commit.isCurrentRevision()) return false;
			files.clear();
			for (const [path, contents] of candidate) files.set(path, contents);
			this.commits++;
			return true;
		},
	};
}

test("owned output plans validate collisions before side effects", async () => {
	const plan = createOwnedOutputPlan({
		writes: [
			{ path: "sections/card.liquid", contents: "one", ownerId: "one" },
			{ path: "sections/card.liquid", contents: "two", ownerId: "two" },
		],
	});
	const store = memoryStore();
	await assert.rejects(
		executeOutputTransaction({
			plan,
			expectedRevision: 1,
			currentRevision: () => 1,
			store,
		}),
		(error) => {
			assert.ok(error instanceof OutputPlanValidationError);
			assert.equal(error.diagnostics[0].code, "OUTPUT_PATH_COLLISION");
			return true;
		},
	);
	assert.equal(store.commits, 0);
	assert.deepEqual(store.files, new Map());
});

test("output transaction commits writes and stale owned deletions together", async () => {
	const store = memoryStore(
		new Map([
			["assets/old.js", "old"],
			["merchant/settings_data.json", "merchant"],
		]),
	);
	const plan = createOwnedOutputPlan({
		writes: [
			{ path: "assets/new.js", contents: "new", ownerId: "component:new" },
		],
		previouslyOwnedPaths: ["assets/old.js"],
	});
	const result = await executeOutputTransaction({
		plan,
		expectedRevision: 4,
		currentRevision: () => 4,
		store,
	});

	assert.equal(result.committed, true);
	assert.deepEqual(
		store.files,
		new Map([
			["merchant/settings_data.json", "merchant"],
			["assets/new.js", "new"],
		]),
	);
	assert.deepEqual(result.deletedPaths, ["assets/old.js"]);
});

test("obsolete revisions cannot publish staged output", async () => {
	let revision = 7;
	const files = new Map([["assets/current.js", "current"]]);
	const store = {
		async atomicCommit(commit) {
			const staged = new Map(
				commit.plan.writes.map((file) => [file.path, file.contents]),
			);
			revision = 8;
			if (!commit.isCurrentRevision()) return false;
			files.clear();
			for (const entry of staged) files.set(...entry);
			return true;
		},
	};
	const plan = createOwnedOutputPlan({
		writes: [
			{ path: "assets/next.js", contents: "next", ownerId: "component:next" },
		],
	});

	await assert.rejects(
		executeOutputTransaction({
			plan,
			expectedRevision: 7,
			currentRevision: () => revision,
			store,
		}),
		ObsoleteOutputRevisionError,
	);
	assert.deepEqual(files, new Map([["assets/current.js", "current"]]));
});
