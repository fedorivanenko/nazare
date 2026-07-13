import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
			const full = join(cwd, path);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, contents);
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

test("cli: build validates dependencies, validate checks only the entry", async () => {
	await withProject(
		{
			"component.nz.liquid": `{% import Child from "./child.nz.liquid" %}\n{% render Child {} %}`,
			"child.nz.liquid": `{% props { title: string.requried() } %}<span>{{ props.title }}</span>`,
		},
		async (cwd) => {
			// build checks imported files, so the child's parse error surfaces.
			const built = runCli(cwd, "build", "component.nz.liquid");
			assert.notEqual(built.status, 0);
			assert.ok(
				JSON.parse(built.stdout).issues.some(
					(issue) => issue.code === "NAZARE_PARSE_TYPE_EXPRESSION",
				),
			);

			// validate compiles the entry only — the child is not checked here.
			const validated = runCli(cwd, "validate", "component.nz.liquid");
			assert.equal(validated.status, 0, validated.stderr);
			assert.ok(
				!JSON.parse(validated.stdout).issues.some(
					(issue) => issue.code === "NAZARE_PARSE_TYPE_EXPRESSION",
				),
			);
		},
	);
});

const componentWithScript = (ref) =>
	`<div ref="${ref}"></div>\n{% script %}\nexport default island(({ refs }) => refs.${ref});\n{% endscript %}`;

test("cli: build with no path walks the default nazare/ source root", async () => {
	await withProject(
		{
			"nazare/alpha/alpha.nz.liquid": componentWithScript("a"),
			"nazare/beta/beta.nz.liquid": componentWithScript("b"),
			// Not under nazare/, so it must be ignored by the default walk.
			"stray/stray.nz.liquid": componentWithScript("c"),
		},
		async (cwd) => {
			const built = runCli(cwd, "build");
			assert.equal(built.status, 0, built.stderr);
			const output = JSON.parse(built.stdout);

			assert.deepEqual(output.components.sort(), [
				"nazare/alpha/alpha.nz.liquid",
				"nazare/beta/beta.nz.liquid",
			]);
			assert.equal(output.conflicts.length, 0);
			// The shared runtime asset is emitted by both but written exactly once.
			assert.equal(
				output.written.filter((path) => path.endsWith("nazare-runtime.js"))
					.length,
				1,
			);
			assert.ok(
				output.written.some((path) => path.endsWith("snippets/alpha.liquid")),
			);
			assert.ok(
				output.written.some((path) => path.endsWith("snippets/beta.liquid")),
			);
		},
	);
});

test("cli: build reports a conflict when two components emit the same path", async () => {
	await withProject(
		{
			"nazare/one/widget.nz.liquid": "<div>one</div>",
			"nazare/two/widget.nz.liquid": "<div>two</div>",
		},
		async (cwd) => {
			const built = runCli(cwd, "build", "nazare");
			assert.notEqual(built.status, 0);
			const output = JSON.parse(built.stdout);
			assert.equal(output.conflicts.length, 1);
			assert.match(output.conflicts[0], /snippets\/widget\.liquid/);
		},
	);
});

test("cli: build errors when the source root is missing", async () => {
	await withProject({}, async (cwd) => {
		const built = runCli(cwd, "build", "does-not-exist");
		assert.notEqual(built.status, 0);
		assert.match(built.stderr, /Source path not found/);
	});
});
