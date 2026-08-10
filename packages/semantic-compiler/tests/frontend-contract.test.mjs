import assert from "node:assert/strict";
import test from "node:test";
import { defineFrontend } from "../dist/index.js";

test("frontend contract preserves typed source-local extraction", () => {
	const frontend = defineFrontend({
		id: "test-frontend",
		version: 1,
		languages: ["test"],
		ontology: { namespace: "test", version: 1 },
		extract({ document }) {
			return {
				path: document.path,
				language: document.language,
				frontend: { id: "test-frontend", version: 1 },
				facts: [],
				diagnostics: [],
				boundaries: [],
				coverage: [
					{
						family: "test.syntax",
						status: "complete",
						boundaryIds: [],
					},
				],
				work: { visited: 1, emitted: 0 },
			};
		},
	});
	const result = frontend.extract({
		document: {
			path: "test.txt",
			language: "test",
			source: "",
			syntax: {},
			diagnostics: [],
		},
		limits: { maxFacts: 10, maxWork: 100 },
	});

	assert.equal(result.path, "test.txt");
	assert.equal(result.coverage[0]?.status, "complete");
});
