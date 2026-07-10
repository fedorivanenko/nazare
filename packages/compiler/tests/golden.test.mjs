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

const components = readdirSync(componentsDir, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => {
		const manifest = JSON.parse(
			readFileSync(join(componentsDir, entry.name, "nazare.json"), "utf8"),
		);
		return { name: entry.name, dir: join(componentsDir, entry.name), manifest };
	})
	.filter((component) => component.manifest.entry.endsWith(".nz.liquid"));

function compileComponent(component, contracts) {
	const entryPath = join(component.dir, component.manifest.entry);
	const file = relative(repoRoot, entryPath);
	return compileNazareArtifact(readFileSync(entryPath, "utf8"), file, {
		packageId: component.manifest.id,
		contracts,
		readAsset: (relativePath) => {
			try {
				return readFileSync(join(component.dir, relativePath), "utf8");
			} catch {
				return undefined;
			}
		},
	});
}

const contractsByPackageId = new Map(
	components.map((component) => [
		component.manifest.id,
		compileComponent(component, []).contract,
	]),
);

for (const component of components) {
	test(`golden: ${component.name}`, () => {
		const contracts = Object.keys(component.manifest.dependencies ?? {})
			.map((packageId) => contractsByPackageId.get(packageId))
			.filter((contract) => contract !== undefined);

		const result = compileComponent(component, contracts);
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
