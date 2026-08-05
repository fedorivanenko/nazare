import assert from "node:assert/strict";
import test from "node:test";
import { executeRevisionUpdates } from "../dist/revision-execution.js";

const deferred = () => {
	let resolve;
	let reject;
	const promise = new Promise((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, reject, resolve };
};

async function* updates(values) {
	for (const value of values) yield value;
}

test("revision execution publishes only the latest successful result", async () => {
	const first = deferred();
	const second = deferred();
	const events = [];
	const secondStarted = deferred();
	const execution = executeRevisionUpdates({
		updates: updates([1, 2]),
		revision: (revision) => revision,
		run: (revision) => {
			if (revision === 1) return first.promise;
			secondStarted.resolve();
			return second.promise;
		},
		onEvent: (event) => events.push(event),
	});
	await secondStarted.promise;
	second.resolve("latest");
	first.resolve("stale");
	await execution;

	assert.deepEqual(
		events.map(({ type, revision, result }) => ({ type, revision, result })),
		[{ type: "result", revision: 2, result: "latest" }],
	);
});

test("revision execution reports current failures and skips rejected updates", async () => {
	const events = [];
	await executeRevisionUpdates({
		updates: updates([undefined, 3]),
		revision: (revision) => revision,
		async run() {
			throw new Error("broken revision");
		},
		onEvent: (event) => events.push(event),
	});

	assert.equal(events.length, 1);
	assert.equal(events[0].type, "update-failed");
	assert.equal(events[0].revision, 3);
	assert.match(events[0].error.message, /broken revision/);
});
