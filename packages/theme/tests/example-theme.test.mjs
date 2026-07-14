// End-to-end build of the committed example workspace (examples/theme). Copies
// it to a temp dir so the build's reconciliation baselines never dirty the
// repo, then asserts a clean build that produces the expected Shopify theme
// files. This is the "does the whole pipeline still work on a real theme" gate.
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildTheme } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const exampleSource = resolve(here, "..", "..", "..", "examples", "theme");

test("example theme builds into a Shopify theme", async () => {
	const projectRoot = mkdtempSync(join(tmpdir(), "nazare-example-"));
	try {
		cpSync(exampleSource, projectRoot, { recursive: true });
		const result = await buildTheme({
			projectRoot,
			sourceRoot: "src",
			outDir: "theme",
		});

		const errors = result.issues.filter((issue) => issue.severity === "error");
		assert.deepEqual(
			errors,
			[],
			`build errors:\n${JSON.stringify(errors, null, 2)}`,
		);
		assert.deepEqual(result.conflicts, [], "unexpected output conflicts");

		const out = join(projectRoot, "theme");
		for (const rel of [
			"sections/counter.liquid",
			"assets/counter.js",
			"assets/counter.css",
			"assets/nazare-runtime.js",
			"layout/theme.liquid",
			"templates/index.json",
			"config/settings_schema.json",
			"locales/en.default.json",
		]) {
			assert.ok(existsSync(join(out, rel)), `missing emitted file: ${rel}`);
		}
	} finally {
		rmSync(projectRoot, { recursive: true, force: true });
	}
});
