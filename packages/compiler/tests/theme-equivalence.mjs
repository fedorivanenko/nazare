import assert from "node:assert/strict";
import {
	analyzeNazareTheme,
	buildNazareThemeWorkspace,
	inspectNazareTheme,
	ThemeImpactIndex,
} from "../dist/index.js";

export function assertProgramEqualsCold(program, files, options = {}) {
	const coldAnalysis = analyzeNazareTheme(files, options);
	const coldGraph = inspectNazareTheme(files, options);
	assert.deepEqual(program.getModel(), coldAnalysis.ir);
	assert.deepEqual(program.getFacts(), coldAnalysis.facts);
	assert.deepEqual(program.getGraph(), coldGraph);
	assert.deepEqual(program.getModel().issues, coldAnalysis.ir.issues);
	const coldImpact = new ThemeImpactIndex(coldGraph);
	for (const node of coldGraph.nodes) {
		assert.deepEqual(
			program.getDependencies(node.id),
			coldImpact.getDependencies(node.id),
			`dependencies diverged for ${node.id}`,
		);
		assert.deepEqual(
			program.getDependents(node.id),
			coldImpact.getDependents(node.id),
			`dependents diverged for ${node.id}`,
		);
		assert.deepEqual(
			program.getAffectedPages(node.id),
			coldImpact.getAffectedPages(node.id),
			`affected pages diverged for ${node.id}`,
		);
	}
}

export function assertBuildEqualsCold(session, files) {
	assert.deepEqual(session.getBuild(), buildNazareThemeWorkspace(files));
}
