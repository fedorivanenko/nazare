import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FileSystemRegistry } from "@nazare/registry";
import { installComponent, updateAll } from "../dist/install.js";

const component = (id, version, dependencies = {}, files = {}) => ({
	id,
	version,
	dependencies,
	files: {
		"nazare.json": JSON.stringify({ id, version }),
		"marker.txt": `${id}@${version}`,
		...files,
	},
});

// A project with a filesystem registry preloaded with `components`.
async function withProject(components, fn) {
	const registryDir = mkdtempSync(join(tmpdir(), "nazare-reg-"));
	const projectRoot = mkdtempSync(join(tmpdir(), "nazare-proj-"));
	const registry = new FileSystemRegistry(registryDir);
	try {
		for (const each of components) await registry.publish(each, "t");
		const options = { client: registry, projectRoot, sourceRoot: "nazare" };
		await fn({ registry, projectRoot, options });
	} finally {
		await rm(registryDir, { recursive: true, force: true });
		await rm(projectRoot, { recursive: true, force: true });
	}
}

const marker = (projectRoot, name) =>
	readFileSync(join(projectRoot, "nazare", name, "marker.txt"), "utf8");
const themeManifest = (projectRoot) =>
	JSON.parse(readFileSync(join(projectRoot, "nazare.theme.json"), "utf8"));

test("add fetches a component and its transitive deps as siblings", async () => {
	await withProject(
		[
			component("@nazare/cn", "0.1.0"),
			component("@nazare/counter", "0.1.0", { "@nazare/cn": "0.1.0" }),
		],
		async ({ projectRoot, options }) => {
			const outcome = await installComponent(
				"@nazare/counter",
				"latest",
				"add",
				options,
			);

			assert.deepEqual(outcome.installed.map((c) => c.id).sort(), [
				"@nazare/cn",
				"@nazare/counter",
			]);
			assert.equal(marker(projectRoot, "counter"), "@nazare/counter@0.1.0");
			assert.equal(marker(projectRoot, "cn"), "@nazare/cn@0.1.0");
			assert.deepEqual(themeManifest(projectRoot).installed, {
				"@nazare/cn": "0.1.0",
				"@nazare/counter": "0.1.0",
			});
		},
	);
});

test("re-adding an installed component at the same version is a no-op", async () => {
	await withProject(
		[component("@nazare/link", "0.1.0")],
		async ({ options }) => {
			await installComponent("@nazare/link", "latest", "add", options);
			const again = await installComponent(
				"@nazare/link",
				"latest",
				"add",
				options,
			);
			assert.deepEqual(again.installed, []);
			assert.deepEqual(again.skipped, [
				{ id: "@nazare/link", version: "0.1.0" },
			]);
			assert.deepEqual(again.warnings, []);
		},
	);
});

test("add keeps an existing different-version install and warns", async () => {
	await withProject(
		[component("@nazare/link", "0.1.0"), component("@nazare/link", "0.2.0")],
		async ({ projectRoot, options }) => {
			await installComponent("@nazare/link", "0.1.0", "add", options);
			const outcome = await installComponent(
				"@nazare/link",
				"0.2.0",
				"add",
				options,
			);

			assert.deepEqual(outcome.installed, []);
			assert.equal(outcome.warnings.length, 1);
			assert.match(outcome.warnings[0], /already installed at 0\.1\.0/);
			// The on-disk copy and the record are untouched.
			assert.equal(marker(projectRoot, "link"), "@nazare/link@0.1.0");
			assert.equal(
				themeManifest(projectRoot).installed["@nazare/link"],
				"0.1.0",
			);
		},
	);
});

test("update overwrites installed components to latest", async () => {
	await withProject(
		[component("@nazare/link", "0.1.0"), component("@nazare/link", "0.2.0")],
		async ({ projectRoot, options }) => {
			await installComponent("@nazare/link", "0.1.0", "add", options);
			const outcome = await updateAll(options);

			assert.deepEqual(outcome.installed, [
				{ id: "@nazare/link", version: "0.2.0" },
			]);
			assert.equal(marker(projectRoot, "link"), "@nazare/link@0.2.0");
			assert.equal(
				themeManifest(projectRoot).installed["@nazare/link"],
				"0.2.0",
			);
		},
	);
});

test("a folder-name collision across scopes is a hard error", async () => {
	await withProject(
		[component("@alpha/widget", "0.1.0"), component("@beta/widget", "0.1.0")],
		async ({ projectRoot, options }) => {
			await installComponent("@alpha/widget", "0.1.0", "add", options);
			await assert.rejects(
				installComponent("@beta/widget", "0.1.0", "add", options),
				/collision/,
			);
			// The first install is intact; the second wrote nothing.
			assert.equal(marker(projectRoot, "widget"), "@alpha/widget@0.1.0");
		},
	);
});

test("adding an unknown component fails", async () => {
	await withProject([], async ({ options }) => {
		await assert.rejects(
			installComponent("@nazare/missing", "latest", "add", options),
			/not found/,
		);
		assert.equal(existsSync(join(options.projectRoot, "nazare")), false);
	});
});
