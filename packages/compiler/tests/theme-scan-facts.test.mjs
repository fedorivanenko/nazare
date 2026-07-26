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

test("scan adapter: definite assignment decides whether a name is an input", () => {
	// A name assigned on every path is the file's own; assigned on some, a read
	// below may find nothing, which is what a caller would have to supply.
	const free = (contents) =>
		[
			...new Set(
				collectScannedSourceFacts(
					"snippets/t.liquid",
					contents,
					scanLiquid(contents).tokens,
				)
					.facts.filter((fact) => fact.kind === "readsFreeVariable")
					.map((fact) => fact.name),
			),
		].sort();

	assert.deepEqual(free("{% if c %}{% assign x = 1 %}{% endif %}{{ x }}"), [
		"c",
		"x",
	]);
	assert.deepEqual(
		free(
			"{% if c %}{% assign x = 1 %}{% else %}{% assign x = 2 %}{% endif %}{{ x }}",
		),
		["c"],
	);
	// A loop may run zero times, so its body assigns nothing definitely.
	assert.deepEqual(
		free("{% for i in a %}{% assign x = 1 %}{% endfor %}{{ x }}"),
		["a", "x"],
	);
	// The defaulting idiom depends on this: `alt` stays free, so it remains a
	// parameter, and the guard makes it optional rather than required.
	assert.deepEqual(
		free(
			"{% unless alt %}{% assign alt = image.alt %}{% endunless %}{{ alt }}",
		),
		["alt", "image"],
	);
	// Preserve reference quirk for behavior-neutral scanner adoption: `case`
	// assignments remain branch-local even when `else` makes it exhaustive.
	assert.deepEqual(
		free(
			"{% case c %}{% when 1 %}{% assign x = 1 %}{% else %}{% assign x = 2 %}{% endcase %}{{ x }}",
		),
		["c", "x"],
	);
});

test("scan adapter: assigned defaults guard their source name", () => {
	const contents = "{% assign local = local | default: fallback %}{{ local }}";
	const guards = collectScannedSourceFacts(
		"snippets/t.liquid",
		contents,
		scanLiquid(contents).tokens,
	).facts.filter((fact) => fact.kind === "guardsObject");

	assert.deepEqual(
		guards.map((fact) => `${fact.name}:${fact.via}`),
		["local:default"],
	);
});
