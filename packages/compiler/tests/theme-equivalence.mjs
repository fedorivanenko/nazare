import assert from "node:assert/strict";
import {
	analyzeNazareTheme,
	computeNazareTheme,
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
	const coldComputation = computeNazareTheme(files, options);
	const metafieldIdentities = new Map();
	for (const record of [
		...coldAnalysis.ir.metafieldDefinitions,
		...coldAnalysis.ir.metafieldReads,
	]) {
		const identity = {
			owner: record.owner,
			namespace: record.namespace,
			key: record.key,
		};
		metafieldIdentities.set(
			`${identity.owner}\0${identity.namespace}\0${identity.key}`,
			identity,
		);
	}
	for (const identity of metafieldIdentities.values()) {
		assert.deepEqual(
			program.getMetafieldImpact(identity),
			coldComputation.getMetafieldImpact(identity),
			`metafield impact diverged for ${identity.owner}.${identity.namespace}.${identity.key}`,
		);
	}
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
