import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	createDefaultSourceParserRegistry,
	nazareSyntaxFacts,
	parseSourceDocument,
} from "../dist/index.js";

const registry = createDefaultSourceParserRegistry();

function filesUnder(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(path));
		else if (path.endsWith(".nz.liquid")) files.push(path);
	}
	return files;
}

test("all committed Nazare corpus files produce authoritative CST facts", () => {
	const roots = [
		fileURLToPath(new URL("../../../fixtures/", import.meta.url)),
		fileURLToPath(new URL("../../../examples/", import.meta.url)),
	];
	const files = roots.flatMap(filesUnder);
	assert.ok(files.length > 0);
	for (const file of files) {
		const source = readFileSync(file, "utf8");
		const document = parseSourceDocument(
			registry,
			file,
			"nazare-liquid",
			source,
		);
		assert.deepEqual(document.issues, [], `Tree-sitter rejected ${file}`);
		assert.equal(nazareSyntaxFacts(document).authoritative, true);
	}
});

test("invalid Nazare CST never produces authoritative facts", () => {
	const document = parseSourceDocument(
		registry,
		"x.nz.liquid",
		"nazare-liquid",
		"{% props { title: %}",
	);
	assert.ok(document.issues.length > 0);
	const facts = nazareSyntaxFacts(document);
	assert.equal(facts.authoritative, false);
	assert.deepEqual(facts.facts, []);
	assert.equal(facts.liquid.authoritative, false);
});
