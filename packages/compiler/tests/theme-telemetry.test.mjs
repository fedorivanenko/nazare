import assert from "node:assert/strict";
import test from "node:test";
import { buildNazareThemeWorkspace, ThemeProgram } from "../dist/index.js";

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

test("no-op, edit, dependency, and snapshot updates report deterministic work", () => {
	const files = fixture();
	const cold = buildNazareThemeWorkspace(files);
	assert.ok(cold.artifacts.length > 0);

	const program = new ThemeProgram(files);
	const noOp = program.updateFile(files[0]);
	assertTelemetryShape(noOp.telemetry);
	assert.equal(noOp.telemetry.filesParsed, 0);
	assert.equal(noOp.telemetry.passKeysProcessed, 0);
	assert.equal(noOp.telemetry.semanticRecordsReplaced, 0);
	assert.equal(noOp.telemetry.graphRecordsReplaced, 0);

	const plainEdit = program.updateFile({
		path: "sections/product.liquid",
		contents: "{{ product.title }}",
	});
	assertTelemetryShape(plainEdit.telemetry);
	assert.equal(plainEdit.telemetry.filesParsed, 1);
	assert.ok(plainEdit.telemetry.passKeysProcessed > 0);
	assert.ok(plainEdit.telemetry.semanticRecordsReplaced > 0);
	assert.equal(plainEdit.telemetry.graphRecordsReplaced, 0);
	assert.equal(plainEdit.graph, undefined);
	assert.equal(plainEdit.telemetry.outputsEmitted, 0);

	const eagerProgram = new ThemeProgram(files, { graphProjection: "eager" });
	const eagerEdit = eagerProgram.updateFile({
		path: "sections/product.liquid",
		contents: "{{ product.title }}",
	});
	assert.ok(eagerEdit.telemetry.graphRecordsReplaced > 0);
	assert.ok(eagerEdit.graph);

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
