import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("packages/cli-client/dist/index.js");

function runCli(cwd, ...args) {
	return spawnSync(process.execPath, [cli, ...args], {
		cwd,
		encoding: "utf8",
	});
}

async function withProject(files, fn) {
	const cwd = mkdtempSync(join(tmpdir(), "nazare-cli-"));
	try {
		for (const [path, contents] of Object.entries(files)) {
			writeFileSync(join(cwd, path), contents);
		}
		await fn(cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

test("cli: --strictness loose suppresses component-author diagnostics", async () => {
	await withProject(
		{
			"component.nz.liquid": `<div></div>\n{% script %}\nexport default island(({ refs }) => refs.missing);\n{% endscript %}`,
		},
		async (cwd) => {
			const strict = runCli(cwd, "artifact", "component.nz.liquid");
			const loose = runCli(
				cwd,
				"artifact",
				"component.nz.liquid",
				"--strictness",
				"loose",
			);

			assert.notEqual(strict.status, 0);
			assert.equal(loose.status, 0, loose.stderr);
			assert.ok(
				JSON.parse(strict.stdout).issues.some(
					(issue) => issue.code === "CONSTRAINT_UNKNOWN_REF",
				),
			);
			assert.ok(
				!JSON.parse(loose.stdout).issues.some(
					(issue) => issue.code === "CONSTRAINT_UNKNOWN_REF",
				),
			);
		},
	);
});

test("cli: --dependency-diagnostics controls build dependency diagnostics", async () => {
	await withProject(
		{
			"component.nz.liquid": `{% import Child from "./child.nz.liquid" %}\n{% render Child {} %}`,
			"child.nz.liquid": `{% props { title: string.requried() } %}<span>{{ props.title }}</span>`,
		},
		async (cwd) => {
			const surfaced = runCli(cwd, "build", "component.nz.liquid");
			const hidden = runCli(
				cwd,
				"build",
				"component.nz.liquid",
				"--dependency-diagnostics=hidden",
			);

			assert.notEqual(surfaced.status, 0);
			assert.equal(hidden.status, 0, hidden.stderr);
			assert.ok(
				JSON.parse(surfaced.stdout).issues.some(
					(issue) => issue.code === "NAZARE_PARSE_TYPE_EXPRESSION",
				),
			);
			assert.ok(
				!JSON.parse(hidden.stdout).issues.some(
					(issue) => issue.code === "NAZARE_PARSE_TYPE_EXPRESSION",
				),
			);
		},
	);
});
