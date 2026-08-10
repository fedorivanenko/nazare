import assert from "node:assert/strict";
import test from "node:test";
import { InvalidOntologyError, SemanticGraphContract } from "../dist/index.js";

const ontology = {
	namespace: "test",
	version: 1,
	entityKinds: [
		{
			kind: "test.file",
			identity: [
				{
					name: "path",
					type: "string",
					required: true,
					normalization: "path",
				},
			],
			attributes: [],
		},
	],
	occurrenceKinds: [],
	relationKinds: [],
	valueSlots: [],
	predicateKinds: [],
	boundaryKinds: ["dynamic-target"],
	coverageFamilies: [
		{
			kind: "test.files",
			description: "Indexed source files",
		},
	],
};

function snapshot(entityKind = "test.file") {
	return {
		contractVersion: 1,
		revision: {
			id: "revision:1",
			compilerVersion: "test",
			repositoryFingerprint: "repository:1",
			externalInputs: {},
		},
		ontologies: [{ namespace: "test", version: 1 }],
		entities: [
			{
				id: "entity:file",
				kind: entityKind,
				identity: {
					scheme: entityKind,
					components: { path: "sections/test.liquid" },
				},
				path: "sections/test.liquid",
				attributes: {},
				assertion: {
					epistemic: { status: "proven", basis: "syntax" },
					availability: "static",
					provenance: {
						authorities: ["authored-source"],
						sourceIds: [],
					},
					evidence: [
						{
							path: "sections/test.liquid",
							range: { start: 0, end: 10 },
						},
					],
					boundaryIds: [],
				},
			},
		],
		occurrences: [],
		relations: [],
		values: [],
		predicates: [],
		boundaries: [],
		coverage: [],
		diagnostics: [],
	};
}

test("ontology compiles into graph constraints", () => {
	const contract = new SemanticGraphContract([ontology]);
	const result = contract.validate(snapshot());
	assert.equal(result.valid, true);
	assert.deepEqual(result.issues, []);
});

test("graph contract rejects undeclared semantic kinds", () => {
	const contract = new SemanticGraphContract([ontology]);
	const result = contract.validate(snapshot("test.unknown"));
	assert.equal(result.valid, false);
	assert.equal(result.issues[0]?.code, "UNKNOWN_ENTITY_KIND");
});

test("graph contract rejects duplicate ontology namespaces", () => {
	assert.throws(
		() => new SemanticGraphContract([ontology, ontology]),
		InvalidOntologyError,
	);
});
