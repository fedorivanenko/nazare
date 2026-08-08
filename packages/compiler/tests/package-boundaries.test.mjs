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

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function importsPackage(source, dependency, exact) {
	const suffix = exact ? "" : "(?:/[^\"']*)?";
	return new RegExp(
		`(?:from\\s+|import\\s*(?:\\(|(?=["'])))s*(["'])${escapeRegExp(dependency)}${suffix}\\1`,
	).test(source);
}

async function assertNoPackageImports(
	packageName,
	forbidden,
	directories = ["src"],
) {
	for (const directory of directories) {
		for (const path of await TypeScriptFiles(
			join(root, packageName, directory),
		)) {
			const source = await readFile(path, "utf8");
			for (const dependency of forbidden) {
				const importsDependency = importsPackage(source, dependency, false);
				assert.equal(
					importsDependency,
					false,
					`${path} imports forbidden dependency ${dependency}`,
				);
			}
		}
	}
}

async function assertNoExactPackageImports(
	packageName,
	forbidden,
	directories = ["src"],
) {
	for (const directory of directories) {
		for (const path of await TypeScriptFiles(
			join(root, packageName, directory),
		)) {
			const source = await readFile(path, "utf8");
			for (const dependency of forbidden) {
				const importsDependency = importsPackage(source, dependency, true);
				assert.equal(
					importsDependency,
					false,
					`${path} imports forbidden root entrypoint ${dependency}`,
				);
			}
		}
	}
}

test("package boundary matcher recognizes static, dynamic, and side-effect imports", () => {
	for (const source of [
		'import { product } from "@nazare/compiler/computation";',
		'import("@nazare/compiler/project");',
		'import "@nazare/compiler/source-products";',
	]) {
		assert.equal(importsPackage(source, "@nazare/compiler", false), true);
		assert.equal(importsPackage(source, "@nazare/compiler", true), false);
	}
	assert.equal(
		importsPackage('import "@nazare/compiler";', "@nazare/compiler", true),
		true,
	);
});

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
	await assertNoPackageImports("compiler", [
		"@nazare/target-shopify",
		"@nazare/preview",
		"@nazare/cli-client",
	]);
	await assertNoPackageImports("core", [
		"@nazare/compiler",
		"@nazare/target-shopify",
		"@nazare/preview",
	]);
	await assertNoPackageImports("source", [
		"@nazare/compiler",
		"@nazare/target-shopify",
		"@nazare/preview",
	]);
	await assertNoExactPackageImports(
		"target-shopify",
		["@nazare/compiler"],
		["src", "tests"],
	);
	await assertNoExactPackageImports(
		"preview",
		["@nazare/compiler"],
		["src", "tests"],
	);
	await assertNoExactPackageImports(
		"cli-client",
		["@nazare/compiler"],
		["src", "tests"],
	);
});

test("packages do not import another package's private build paths", async () => {
	const privatePackageImport =
		/(?:from\s+|import\s*(?:\(|(?=["'])))\s*(["'])@nazare\/[^/"']+\/(?:src|dist)(?:\/[^"']*)?\1/;
	for (const packageName of await readdir(root)) {
		for (const directory of ["src", "tests"]) {
			try {
				for (const path of await TypeScriptFiles(
					join(root, packageName, directory),
				)) {
					assert.equal(
						privatePackageImport.test(await readFile(path, "utf8")),
						false,
						`${path} imports a private package path`,
					);
				}
			} catch (error) {
				if (error?.code === "ENOENT") continue;
				throw error;
			}
		}
	}
});
