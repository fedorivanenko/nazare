import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compileNazareArtifact } from "../dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const componentsDir = join(repoRoot, "examples", "components");
const snapshotsDir = join(dirname(fileURLToPath(import.meta.url)), "__snapshots__");
const updateSnapshots = process.env.UPDATE_SNAPSHOTS === "1";

// The repo root plays the project root: every file is identified by its
// repo-relative path, and imports resolve across component directories.
const readFile = (path) => {
	try {
		return readFileSync(join(repoRoot, path), "utf8");
	} catch {
		return undefined;
	}
};

const components = readdirSync(componentsDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => {
		const manifest = JSON.parse(
			readFileSync(join(componentsDir, entry.name, "nazare.json"), "utf8"),
		);
		return { name: entry.name, dir: join(componentsDir, entry.name), manifest };
	})
	.filter((component) => component.manifest.entry.endsWith(".nz.liquid"));

for (const component of components) {
	test(`golden: ${component.name}`, () => {
		const entryPath = join(component.dir, component.manifest.entry);
		const file = relative(repoRoot, entryPath);
		const result = compileNazareArtifact(readFileSync(entryPath, "utf8"), file, {
			readFile,
		});
		const actual = `${JSON.stringify(
			{
				ir: result.ir,
				graph: result.graph,
				issues: result.issues,
				contract: result.contract,
			},
			null,
			2,
		)}\n`;

		const snapshotPath = join(snapshotsDir, `${component.name}.json`);
		if (updateSnapshots) {
			mkdirSync(snapshotsDir, { recursive: true });
			writeFileSync(snapshotPath, actual);
			return;
		}

		let expected;
		try {
			expected = readFileSync(snapshotPath, "utf8");
		} catch {
			assert.fail(
				`Missing snapshot ${relative(repoRoot, snapshotPath)}; run UPDATE_SNAPSHOTS=1 pnpm test`,
			);
		}
		assert.equal(actual, expected);
	});
}
