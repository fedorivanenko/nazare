import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	liquidDependencies,
	liquidSchema,
	liquidSettingsReads,
	scanLiquid,
} from "../../scan/dist/index.js";
import {
	createDefaultSourceParserRegistry,
	liquidSyntaxFacts,
	parseSourceDocument,
} from "../dist/index.js";

const corpusRoot = fileURLToPath(
	new URL("../../../fixtures/theme-corpus/", import.meta.url),
);
const registry = createDefaultSourceParserRegistry();

function liquidFiles(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...liquidFiles(path));
		else if (path.endsWith(".liquid") && !path.endsWith(".nz.liquid"))
			files.push(path);
	}
	return files;
}

const sortFacts = (facts) =>
	[...facts].sort((left, right) =>
		JSON.stringify(left).localeCompare(JSON.stringify(right)),
	);

test("Tree-sitter dependency/settings/schema facts match scanner corpus", () => {
	const files = liquidFiles(corpusRoot);
	assert.ok(files.length > 0);
	for (const path of files) {
		const source = readFileSync(path, "utf8");
		const file = relative(corpusRoot, path);
		const document = parseSourceDocument(registry, file, "liquid", source);
		assert.deepEqual(document.issues, [], `Tree-sitter rejected ${file}`);
		const actual = liquidSyntaxFacts(document);
		assert.equal(actual.authoritative, true);

		const scan = scanLiquid(source);
		assert.equal(scan.status, "valid", `scanner rejected ${file}`);
		const expectedDependencies = liquidDependencies(scan.document);
		assert.deepEqual(
			sortFacts(actual.dependencies),
			sortFacts(expectedDependencies),
			`dependencies diverged in ${file}`,
		);
		assert.deepEqual(
			sortFacts(actual.settingsReads),
			sortFacts(liquidSettingsReads(scan.document)),
			`settings reads diverged in ${file}`,
		);
		const expectedSchema = liquidSchema(scan.document);
		assert.equal(
			actual.schema?.body,
			expectedSchema?.body,
			`schema diverged in ${file}`,
		);
		assert.equal(
			actual.schema?.bodyRange.start,
			expectedSchema?.bodyStart,
			`schema offset diverged in ${file}`,
		);
	}
});

test("invalid CST never produces authoritative facts", () => {
	const document = parseSourceDocument(
		registry,
		"x.liquid",
		"liquid",
		"{% render 'card'",
	);
	assert.ok(document.issues.length > 0);
	assert.deepEqual(liquidSyntaxFacts(document), {
		authoritative: false,
		dependencies: [],
		settingsReads: [],
	});
});
