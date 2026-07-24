import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
	buildNazareThemeWorkspace,
	ThemeBuildSession,
	ThemeProgram,
} from "../dist/index.js";

function fixture() {
	return [
		{
			path: "parent.nz.liquid",
			contents:
				'{% import Child from "./child.nz.liquid" %}<div>{% render Child {} %}</div>',
		},
		{ path: "child.nz.liquid", contents: "<span>Child</span>" },
		{ path: "unrelated.nz.liquid", contents: "<aside>Other</aside>" },
		{
			path: "sections/product.liquid",
			contents: "{{ product.metafields.custom.subtitle }}",
		},
	];
}

function assertTelemetryShape(telemetry) {
	for (const key of [
		"filesParsed",
		"passKeysProcessed",
		"semanticRecordsReplaced",
		"graphRecordsReplaced",
		"outputsEmitted",
		"elapsedMs",
		"peakMemoryBytes",
	]) {
		assert.equal(typeof telemetry[key], "number", key);
		assert.ok(telemetry[key] >= 0, key);
	}
}

test("cold, no-op, edit, dependency, and snapshot benchmark matrix records telemetry", () => {
	const files = fixture();
	const coldStarted = performance.now();
	const cold = buildNazareThemeWorkspace(files);
	const coldElapsedMs = performance.now() - coldStarted;
	assert.ok(cold.artifacts.length > 0);
	assert.ok(coldElapsedMs > 0);

	const program = new ThemeProgram(files);
	const noOpStarted = performance.now();
	const noOp = program.updateFile(files[0]);
	const noOpElapsedMs = performance.now() - noOpStarted;
	assertTelemetryShape(noOp.telemetry);
	assert.equal(noOp.telemetry.filesParsed, 0);
	assert.equal(noOp.telemetry.passKeysProcessed, 0);
	assert.equal(noOp.telemetry.semanticRecordsReplaced, 0);
	assert.equal(noOp.telemetry.graphRecordsReplaced, 0);
	assert.ok(noOpElapsedMs < coldElapsedMs);

	const plainEdit = program.updateFile({
		path: "sections/product.liquid",
		contents: "{{ product.title }}",
	});
	assertTelemetryShape(plainEdit.telemetry);
	assert.equal(plainEdit.telemetry.filesParsed, 1);
	assert.ok(plainEdit.telemetry.passKeysProcessed > 0);
	assert.ok(plainEdit.telemetry.semanticRecordsReplaced > 0);
	assert.ok(plainEdit.telemetry.graphRecordsReplaced > 0);
	assert.equal(plainEdit.telemetry.outputsEmitted, 0);

	const build = new ThemeBuildSession(files);
	const unrelated = build.updateFile({
		path: "unrelated.nz.liquid",
		contents: "<aside>Updated other</aside>",
	});
	assertTelemetryShape(unrelated.telemetry);
	assert.deepEqual(unrelated.recomputedPaths, ["unrelated.nz.liquid"]);
	assert.equal(unrelated.telemetry.filesParsed, 1);
	assert.equal(unrelated.telemetry.outputsEmitted, 1);

	const dependency = build.updateFile({
		path: "child.nz.liquid",
		contents: "<strong>Updated child</strong>",
	});
	assertTelemetryShape(dependency.telemetry);
	assert.deepEqual(dependency.recomputedPaths, [
		"child.nz.liquid",
		"parent.nz.liquid",
	]);
	assert.equal(dependency.telemetry.filesParsed, 1);
	assert.equal(dependency.telemetry.outputsEmitted, 2);

	const snapshot = program.updateExternalArtifacts({
		metafields: {
			path: ".shopify/metafields.json",
			contents: JSON.stringify([
				{
					ownerType: "product",
					namespace: "custom",
					key: "subtitle",
					type: "single_line_text_field",
				},
			]),
		},
	});
	assertTelemetryShape(snapshot.telemetry);
	assert.equal(snapshot.telemetry.filesParsed, 0);
	assert.ok(snapshot.telemetry.passKeysProcessed > 0);
	assert.equal(snapshot.telemetry.outputsEmitted, 0);
});
