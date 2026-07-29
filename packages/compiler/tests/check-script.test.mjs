import assert from "node:assert/strict";
import { test } from "node:test";
import {
	checkScriptConstraints,
	compileNazareArtifact,
} from "../dist/index.js";

test("check-script: valid JavaScript passes", () => {
	const result = compileNazareArtifact(
		`<div ref="root"></div>\n{% script lang="js" %}\nexport default island(({ refs }) => refs.root.remove());\n{% endscript %}`,
		"component.nz.liquid",
	);
	assert.deepEqual(checkScriptConstraints(result.ir), []);
});

test("check-script: malformed JavaScript reports a syntax diagnostic", () => {
	const result = compileNazareArtifact(
		`<div ref="root"></div>\n{% script lang="js" %}\nexport default island(() => {;\n{% endscript %}`,
		"component.nz.liquid",
	);
	assert.ok(
		checkScriptConstraints(result.ir).some(
			(issue) => issue.code === "SCRIPT_JAVASCRIPT_PARSE_ERROR",
		),
	);
});

test("check-script: TypeScript behavior blocks are explicitly unsupported", () => {
	const result = compileNazareArtifact(
		`<div ref="root"></div>\n{% script lang="ts" %}\nexport default island(({ refs }) => refs.root.remove());\n{% endscript %}`,
		"component.nz.liquid",
	);
	assert.ok(
		checkScriptConstraints(result.ir).some(
			(issue) => issue.code === "SCRIPT_TYPESCRIPT_UNSUPPORTED",
		),
	);
});
