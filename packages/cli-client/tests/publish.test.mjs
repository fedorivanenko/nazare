import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { FileSystemRegistry } from "@nazare/registry";
import {
	buildRegistryComponent,
	packComponent,
	publishComponent,
} from "../dist/publish.js";

// Writes a component folder: { "nazare.json": {...}, "<path>": "<contents>" }.
async function withComponent(files, fn) {
	const dir = mkdtempSync(join(tmpdir(), "nazare-pub-"));
	try {
		for (const [path, contents] of Object.entries(files)) {
			const full = join(dir, path);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(
				full,
				typeof contents === "string" ? contents : JSON.stringify(contents),
			);
		}
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const manifest = (overrides) => ({
	id: "@nazare/counter",
	version: "0.1.0",
	entry: "counter.ts",
	dependencies: {},
	files: ["counter.ts"],
	...overrides,
});

test("buildRegistryComponent assembles the folder with nazare.json inline", async () => {
	await withComponent(
		{
			"nazare.json": manifest({ files: ["counter.ts", "counter.css"] }),
			"counter.ts": "export const counter = 1;\n",
			"counter.css": ".x{}",
		},
		async (dir) => {
			const component = await buildRegistryComponent(dir);
			assert.equal(component.id, "@nazare/counter");
			assert.equal(component.version, "0.1.0");
			assert.deepEqual(Object.keys(component.files).sort(), [
				"counter.css",
				"counter.ts",
				"nazare.json",
			]);
		},
	);
});

test("a declared dependency that matches an import passes", async () => {
	await withComponent(
		{
			"nazare.json": manifest({ dependencies: { "@nazare/cn": "0.1.0" } }),
			"counter.ts": 'import { cn } from "../cn/cn.ts";\n',
		},
		async (dir) => {
			const component = await buildRegistryComponent(dir);
			assert.deepEqual(component.dependencies, { "@nazare/cn": "0.1.0" });
		},
	);
});

test("dependency scanner sees side-effect, dynamic, and CommonJS imports", async () => {
	await withComponent(
		{
			"nazare.json": manifest({ dependencies: { "@nazare/cn": "0.1.0" } }),
			"counter.ts":
				'import "../cn/cn.css";\nawait import("../cn/cn.ts");\nrequire("../cn/cn.cjs");\n',
		},
		async (dir) => {
			const component = await buildRegistryComponent(dir);
			assert.deepEqual(component.dependencies, { "@nazare/cn": "0.1.0" });
		},
	);
});

test("an import with no declared dependency is refused", async () => {
	await withComponent(
		{
			"nazare.json": manifest({ dependencies: {} }),
			"counter.ts": 'import { cn } from "../cn/cn.ts";\n',
		},
		async (dir) => {
			await assert.rejects(buildRegistryComponent(dir), /imports \.\.\/cn\//);
		},
	);
});

test("a declared dependency that is never imported is refused", async () => {
	await withComponent(
		{
			"nazare.json": manifest({ dependencies: { "@nazare/cn": "0.1.0" } }),
			"counter.ts": "export const counter = 1;\n",
		},
		async (dir) => {
			await assert.rejects(
				buildRegistryComponent(dir),
				/never imports \.\.\/cn\//,
			);
		},
	);
});

test("a missing declared file is refused", async () => {
	await withComponent(
		{
			"nazare.json": manifest({ files: ["counter.ts", "gone.ts"] }),
			"counter.ts": "x",
		},
		async (dir) => {
			await assert.rejects(buildRegistryComponent(dir), /gone\.ts" is missing/);
		},
	);
});

test("an entry not listed in files[] is refused", async () => {
	await withComponent(
		{ "nazare.json": manifest({ entry: "counter.ts", files: [] }) },
		async (dir) => {
			await assert.rejects(
				buildRegistryComponent(dir),
				/entry .* is not listed/,
			);
		},
	);
});

test("pack writes a registry-shaped payload that reads back as the component", async () => {
	const outputRoot = mkdtempSync(join(tmpdir(), "nazare-pack-"));
	try {
		await withComponent(
			{
				"nazare.json": manifest(),
				"counter.ts": "export const counter = 1;\n",
			},
			async (dir) => {
				const { component, path } = await packComponent(dir, outputRoot);
				assert.equal(path, join(outputRoot, "nazare", "counter", "0.1.0.json"));
				const onDisk = JSON.parse(readFileSync(path, "utf8"));
				assert.deepEqual(onDisk, component);

				// Re-packing the same version overwrites, no conflict.
				await packComponent(dir, outputRoot);
			},
		);
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
});

test("pack runs the same dependency guard as publish", async () => {
	const outputRoot = mkdtempSync(join(tmpdir(), "nazare-pack-"));
	try {
		await withComponent(
			{
				"nazare.json": manifest({ dependencies: {} }),
				"counter.ts": 'import { cn } from "../cn/cn.ts";\n',
			},
			async (dir) => {
				await assert.rejects(
					packComponent(dir, outputRoot),
					/imports \.\.\/cn\//,
				);
			},
		);
	} finally {
		await rm(outputRoot, { recursive: true, force: true });
	}
});

test("publish uploads, then a second publish of the same version conflicts", async () => {
	const registryDir = mkdtempSync(join(tmpdir(), "nazare-reg-"));
	const registry = new FileSystemRegistry(registryDir);
	try {
		await withComponent(
			{
				"nazare.json": manifest(),
				"counter.ts": "export const counter = 1;\n",
			},
			async (dir) => {
				const first = await publishComponent(dir, {
					client: registry,
					token: "",
				});
				assert.equal(first.result.ok, true);

				// The published component round-trips through the registry.
				const fetched = await registry.fetchComponent(
					"@nazare/counter",
					"0.1.0",
				);
				assert.deepEqual(fetched.files, first.component.files);

				const second = await publishComponent(dir, {
					client: registry,
					token: "",
				});
				assert.equal(second.result.ok, false);
				assert.equal(second.result.code, "VERSION_EXISTS");
			},
		);
	} finally {
		await rm(registryDir, { recursive: true, force: true });
	}
});
