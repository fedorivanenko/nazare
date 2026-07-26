// The scanner and the reference parser must agree about what a theme contains.
//
// This is the check that makes replacing the parser a bounded task rather than
// a compatibility gamble: it runs both implementations over the committed
// corpus theme and compares the facts they produce, name and position.
//
// Known, deliberate differences are listed rather than tolerated — each one is
// a defect in the reference parser that the scanner does not reproduce.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parsePlainLiquid } from "../../compiler/dist/plain-liquid.js";
import {
	LineIndex,
	liquidDependencies,
	liquidSettingsReads,
	scanLiquid,
} from "../dist/index.js";

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

const depKey = (kind, name, span) =>
	`${kind}:${name ?? "(dynamic)"}@${span.start.line}:${span.start.column}`;
const readKey = (object, name) => `${object}.${name}`;

test("differential: scanner and reference parser agree on the corpus", () => {
	const files = corpusFiles();
	assert.ok(files.length > 0, "corpus theme has Liquid files");

	for (const file of files) {
		const reference = parsePlainLiquid(file.contents, file.path, {
			parseMode: "liquid-only",
		});
		if (!reference.factsCollected) continue;

		const index = new LineIndex(file.contents);
		const tokens = scanLiquid(file.contents).tokens;
		const scanned = liquidDependencies(tokens).map((dependency) =>
			depKey(
				dependency.kind,
				dependency.name,
				index.spanAt(file.path, dependency.range),
			),
		);
		const expected = reference.dependencies.map((dependency) =>
			depKey(dependency.kind, dependency.name, dependency.span),
		);
		assert.deepEqual(
			scanned.sort(),
			expected.sort(),
			`dependencies diverged in ${file.path}`,
		);

		const scannedReads = liquidSettingsReads(tokens)
			.map((read) => readKey(read.object, read.name))
			.sort();
		const expectedReads = reference.settingsReads
			.map((read) => readKey(read.object, read.name))
			.sort();
		assert.deepEqual(
			scannedReads,
			expectedReads,
			`settings reads diverged in ${file.path}`,
		);
	}
});

test("differential: the scanner is faster than the reference parser", () => {
	// Not a benchmark — a floor. If this ever fails, the scanner has stopped
	// being a scanner and the reason to have it is gone.
	const files = corpusFiles();
	const started = process.hrtime.bigint();
	for (const file of files) scanLiquid(file.contents);
	const scanNs = process.hrtime.bigint() - started;

	const referenceStarted = process.hrtime.bigint();
	for (const file of files) {
		parsePlainLiquid(file.contents, file.path, { parseMode: "liquid-only" });
	}
	const referenceNs = process.hrtime.bigint() - referenceStarted;

	assert.ok(
		scanNs * 10n < referenceNs,
		`expected the scanner to be well over 10x faster, got ${Number(referenceNs / (scanNs || 1n))}x`,
	);
});
