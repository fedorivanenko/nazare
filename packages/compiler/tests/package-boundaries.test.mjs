import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve("packages");

async function TypeScriptFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await TypeScriptFiles(path)));
		else if (
			entry.isFile() &&
			(entry.name.endsWith(".ts") || entry.name.endsWith(".mjs"))
		)
			files.push(path);
	}
	return files;
}

async function assertNoImports(packageName, forbidden, directories = ["src"]) {
	for (const directory of directories) {
		for (const path of await TypeScriptFiles(
			join(root, packageName, directory),
		)) {
			const source = await readFile(path, "utf8");
			for (const dependency of forbidden) {
				const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const importsDependency = new RegExp(
					`(?:from\\s+|import\\s*\\()(["'])${escaped}\\1`,
				).test(source);
				assert.equal(
					importsDependency,
					false,
					`${path} imports forbidden dependency ${dependency}`,
				);
			}
		}
	}
}

test("package dependencies preserve the compiler architecture direction", async () => {
	const compiler = JSON.parse(
		await readFile(join(root, "compiler/package.json"), "utf8"),
	);
	assert.deepEqual(
		Object.keys(compiler.dependencies)
			.filter((name) => name.startsWith("@nazare/"))
			.sort(),
		["@nazare/core", "@nazare/source"],
	);
	await assertNoImports("compiler", [
		"@nazare/target-shopify",
		"@nazare/preview",
		"@nazare/cli-client",
	]);
	await assertNoImports("core", [
		"@nazare/compiler",
		"@nazare/target-shopify",
		"@nazare/preview",
	]);
	await assertNoImports("source", [
		"@nazare/compiler",
		"@nazare/target-shopify",
		"@nazare/preview",
	]);
	await assertNoImports(
		"target-shopify",
		["@nazare/compiler"],
		["src", "tests"],
	);
	await assertNoImports("preview", ["@nazare/compiler"], ["src", "tests"]);
	await assertNoImports("cli-client", ["@nazare/compiler"], ["src", "tests"]);
});
