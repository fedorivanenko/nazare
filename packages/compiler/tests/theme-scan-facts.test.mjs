// The scanner adapter must produce the same facts as the reference extractor.
//
// This asserts parity on the committed corpus fixture, which covers every fact
// family. Parity on the production corpus is not yet complete — see
// notes/spike-liquid-scanner/findings.md for the remaining gaps — and the swap
// waits on it.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { scanLiquid } from "@nazare/scan";
import { parsePlainLiquid } from "../dist/plain-liquid.js";
import { collectScannedSourceFacts } from "../dist/theme-scan-facts.js";
import { collectSourceThemeFacts } from "../dist/theme-source-facts.js";

const corpusRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../fixtures/theme-corpus",
);

function corpusFiles() {
	const files = [];
	for (const dir of ["sections", "snippets", "blocks", "templates", "layout"]) {
		let entries = [];
		try {
			entries = readdirSync(join(corpusRoot, dir));
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (!entry.endsWith(".liquid")) continue;
			const path = `${dir}/${entry}`;
			files.push({
				path,
				contents: readFileSync(join(corpusRoot, path), "utf8"),
			});
		}
	}
	return files;
}

/** Compares on the fields the graph keys on, not on span noise. */
function factKey(fact) {
	switch (fact.kind) {
		case "readsShopifyData":
			return `data ${fact.expression} conditional=${fact.conditional === true}`;
		case "readsFreeVariable":
			return `free ${fact.expression} usage=${fact.usage}`;
		case "guardsObject":
			return `guard ${fact.name}:${fact.via}`;
		case "referencesAsset":
			return `asset ${fact.targetName}`;
		case "referencesLocaleKey":
			return `locale ${fact.key}`;
		case "declaresDocParam":
			return `doc ${fact.name}:${fact.required}:${fact.paramType ?? ""}`;
		case "passesRenderArgument":
			return `arg ${fact.targetName}#${fact.argumentName}=${fact.sourceObject ?? ""}.${fact.sourcePath ?? ""}`;
		case "detectsCapability":
			return `cap ${fact.capability}:${fact.evidenceStrength}`;
		default:
			return undefined;
	}
}

test("scan adapter: facts match the reference extractor on the corpus", () => {
	const files = corpusFiles();
	assert.ok(files.length > 0);
	for (const file of files) {
		const reference = parsePlainLiquid(file.contents, file.path, {
			parseMode: "liquid-only",
		});
		if (!reference.factsCollected) continue;

		const expected = collectSourceThemeFacts(
			file.path,
			file.contents,
			reference.liquidAst,
		)
			.facts.map(factKey)
			.filter(Boolean)
			.sort();
		const actual = collectScannedSourceFacts(
			file.path,
			file.contents,
			scanLiquid(file.contents).tokens,
		)
			.facts.map(factKey)
			.filter(Boolean)
			.sort();

		assert.deepEqual(actual, expected, `facts diverged in ${file.path}`);
	}
});
