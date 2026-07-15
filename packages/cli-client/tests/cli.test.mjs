import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const cli = resolve("packages/cli-client/dist/index.js");

function runCli(cwd, ...args) {
	const env = { ...process.env };
	delete env.NAZARE_REGISTRY;
	return spawnSync(process.execPath, [cli, ...args], {
		cwd,
		encoding: "utf8",
		env,
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

// Build paths are explicit project config now (no defaults). Tests that don't
// pass --out-dir / a source-root arg supply this nazare.theme.json.
const BUILD_MANIFEST = JSON.stringify({
	build: { sourceRoot: "nazare", outDir: ".nazare-out/theme" },
});

test("cli: init scaffolds build config and creates the source dir", async () => {
	// Non-interactive stdin (spawned) → init takes the src/theme defaults.
	await withProject({}, async (cwd) => {
		const out = runCli(cwd, "init");
		assert.equal(out.status, 0, out.stderr);
		const manifest = JSON.parse(
			readFileSync(join(cwd, "nazare.theme.json"), "utf8"),
		);
		assert.deepEqual(manifest.build, { sourceRoot: "src", outDir: "theme" });
		assert.ok(existsSync(join(cwd, "src")));
	});
});

test("cli: init honors flags and merges existing registry config", async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				registry: "local",
				registries: { local: "file:.registry" },
			}),
		},
		async (cwd) => {
			const out = runCli(
				cwd,
				"init",
				"--source-root",
				"app",
				"--out-dir",
				"dist",
			);
			assert.equal(out.status, 0, out.stderr);
			const manifest = JSON.parse(
				readFileSync(join(cwd, "nazare.theme.json"), "utf8"),
			);
			assert.deepEqual(manifest.build, { sourceRoot: "app", outDir: "dist" });
			assert.equal(manifest.registry, "local");
			assert.deepEqual(manifest.registries, { local: "file:.registry" });
		},
	);
});

test("cli: init refuses to overwrite an existing build config without --force", async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: "src", outDir: "theme" },
			}),
		},
		async (cwd) => {
			const blocked = runCli(cwd, "init");
			assert.notEqual(blocked.status, 0);
			assert.match(blocked.stderr, /already has a build config/);

			const forced = runCli(
				cwd,
				"init",
				"--source-root",
				"app",
				"--out-dir",
				"dist",
				"--force",
			);
			assert.equal(forced.status, 0, forced.stderr);
			const manifest = JSON.parse(
				readFileSync(join(cwd, "nazare.theme.json"), "utf8"),
			);
			assert.deepEqual(manifest.build, { sourceRoot: "app", outDir: "dist" });
		},
	);
});

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
			const built = runCli(
				cwd,
				"build",
				"component.nz.liquid",
				"--out-dir",
				"theme",
				"--json",
			);
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

test("cli: build with no path reads the source root from nazare.theme.json", async () => {
	await withProject(
		{
			"nazare.theme.json": BUILD_MANIFEST,
			"nazare/alpha/alpha.nz.liquid": componentWithScript("a"),
			"nazare/beta/beta.nz.liquid": componentWithScript("b"),
			// Not under the configured source root, so the walk must ignore it.
			"stray/stray.nz.liquid": componentWithScript("c"),
		},
		async (cwd) => {
			const built = runCli(cwd, "build", "--json");
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

test("cli: build supports custom output directory", async () => {
	await withProject(
		{
			"nazare.theme.json": BUILD_MANIFEST,
			"nazare/button.nz.liquid": "<button>Button</button>\n",
		},
		async (cwd) => {
			// --out-dir overrides the outDir in nazare.theme.json.
			const built = runCli(cwd, "build", "--out-dir", "theme", "--json");
			assert.equal(built.status, 0, built.stderr);
			const output = JSON.parse(built.stdout);
			assert.ok(output.written.includes("theme/snippets/button.liquid"));
			assert.match(
				readFileSync(join(cwd, "theme/snippets/button.liquid"), "utf8"),
				/<button>Button<\/button>/,
			);
		},
	);
});

test("cli: build loads extension modules from nazare.extensions", async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: "nazare", outDir: "theme" },
				extensions: [
					{
						module: "./nazare.extensions/manifest.js",
						options: { label: "components" },
					},
				],
			}),
			"nazare/button.nz.liquid": "<button>Button</button>\n",
			"nazare.extensions/manifest.js": `export default {
  name: "manifest",
  emit({ components, options }) {
    return {
      files: [{
        path: "assets/extension-manifest.json",
        contents: JSON.stringify({ label: options.label, files: components.map((component) => component.ast.file) })
      }],
      issues: []
    };
  }
};
`,
		},
		async (cwd) => {
			const built = runCli(cwd, "build", "--json");
			assert.equal(built.status, 0, built.stderr);
			const output = JSON.parse(built.stdout);
			assert.ok(
				output.written.includes("theme/assets/extension-manifest.json"),
			);
			assert.deepEqual(
				JSON.parse(
					readFileSync(
						join(cwd, "theme/assets/extension-manifest.json"),
						"utf8",
					),
				),
				{ label: "components", files: ["nazare/button.nz.liquid"] },
			);
		},
	);
});

test("cli: build rejects invalid extension config", async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: "nazare", outDir: "theme" },
				extensions: ["./other/manifest.js"],
			}),
			"nazare/button.nz.liquid": "<button>Button</button>\n",
		},
		async (cwd) => {
			const built = runCli(cwd, "build", "--json");
			assert.notEqual(built.status, 0);
			assert.match(built.stderr, /Extension modules must live under/);
		},
	);
});

test("cli: build rejects invalid extension module extensions", async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: "nazare", outDir: "theme" },
				extensions: ["./nazare.extensions/manifest.ts"],
			}),
			"nazare/button.nz.liquid": "<button>Button</button>\n",
		},
		async (cwd) => {
			const built = runCli(cwd, "build", "--json");
			assert.notEqual(built.status, 0);
			assert.match(built.stderr, /Extension modules must be .js or .mjs/);
		},
	);
});

test("cli: build rejects malformed nazare.theme.json", async () => {
	await withProject(
		{
			"nazare.theme.json": "{ nope",
			"nazare/button.nz.liquid": "<button>Button</button>\n",
		},
		async (cwd) => {
			const built = runCli(cwd, "build", "--json");
			assert.notEqual(built.status, 0);
			assert.match(built.stderr, /nazare.theme.json is not valid JSON/);
		},
	);
});

test("cli: build rejects invalid build config types", async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: 123, outDir: "theme" },
			}),
			"nazare/button.nz.liquid": "<button>Button</button>\n",
		},
		async (cwd) => {
			const built = runCli(cwd, "build", "--json");
			assert.notEqual(built.status, 0);
			assert.match(built.stderr, /build.sourceRoot must be a string/);
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
			const built = runCli(
				cwd,
				"build",
				"nazare",
				"--out-dir",
				".nazare-out/theme",
				"--json",
			);
			assert.notEqual(built.status, 0);
			const output = JSON.parse(built.stdout);
			assert.equal(output.conflicts.length, 1);
			assert.match(output.conflicts[0], /snippets\/widget\.liquid/);
		},
	);
});

test("cli: build errors when the source root is missing", async () => {
	await withProject({}, async (cwd) => {
		const built = runCli(cwd, "build", "does-not-exist", "--out-dir", "theme");
		assert.notEqual(built.status, 0);
		assert.match(built.stderr, /Source path not found/);
	});
});

test("cli: build errors when no output dir is configured", async () => {
	await withProject(
		{ "nazare/button.nz.liquid": "<button>Button</button>\n" },
		async (cwd) => {
			const built = runCli(cwd, "build", "nazare");
			assert.notEqual(built.status, 0);
			assert.match(built.stderr, /output directory/);
		},
	);
});

test("cli: build errors when no source root is configured", async () => {
	await withProject({}, async (cwd) => {
		const built = runCli(cwd, "build", "--out-dir", "theme");
		assert.notEqual(built.status, 0);
		assert.match(built.stderr, /source root/);
	});
});

test("cli: build prints a human-readable summary by default", async () => {
	await withProject(
		{
			"nazare.theme.json": BUILD_MANIFEST,
			"nazare/button.nz.liquid": "<button>Button</button>\n",
		},
		async (cwd) => {
			const built = runCli(cwd, "build");
			assert.equal(built.status, 0, built.stderr);
			// Not JSON, and it leads with a plain summary line.
			assert.throws(() => JSON.parse(built.stdout));
			assert.match(built.stdout, /Built 1 component/);
			assert.match(built.stdout, /Build OK/);
		},
	);
});

test("cli: pack is available on the main nazare command", async () => {
	await withProject(
		{
			"nazare/button/nazare.json": JSON.stringify({
				id: "@acme/button",
				version: "0.1.0",
				entry: "button.ts",
				dependencies: {},
				files: ["button.ts"],
			}),
			"nazare/button/button.ts": "export const button = 1;\n",
		},
		async (cwd) => {
			const packed = runCli(cwd, "pack", "nazare/button");
			assert.equal(packed.status, 0, packed.stderr);
			const output = JSON.parse(packed.stdout);
			assert.deepEqual(output.packed, {
				id: "@acme/button",
				version: "0.1.0",
			});
			const payload = JSON.parse(readFileSync(join(cwd, output.path), "utf8"));
			assert.equal(payload.id, "@acme/button");
		},
	);
});

test("cli: registry add/use stores project registry and add reads it", async () => {
	await withProject(
		{
			".registry/nazare/button/0.1.0.json": JSON.stringify({
				id: "@nazare/button",
				version: "0.1.0",
				dependencies: {},
				files: {
					"nazare.json": JSON.stringify({
						id: "@nazare/button",
						version: "0.1.0",
					}),
					"button.nz.liquid": "<button>Button</button>\n",
				},
			}),
		},
		async (cwd) => {
			const addedRegistry = runCli(
				cwd,
				"registry",
				"add",
				"local",
				"file:.registry",
			);
			assert.equal(addedRegistry.status, 0, addedRegistry.stderr);
			assert.equal(JSON.parse(addedRegistry.stdout).current, "local");

			const listed = runCli(cwd, "registry", "list");
			assert.equal(listed.status, 0, listed.stderr);
			assert.deepEqual(JSON.parse(listed.stdout), {
				current: "local",
				registries: { local: "file:.registry" },
			});

			const installed = runCli(
				cwd,
				"add",
				"@nazare/button",
				"--source-root",
				"nazare",
			);
			assert.equal(installed.status, 0, installed.stderr);
			assert.equal(
				readFileSync(join(cwd, "nazare/button/button.nz.liquid"), "utf8"),
				"<button>Button</button>\n",
			);
			const manifest = JSON.parse(
				readFileSync(join(cwd, "nazare.theme.json"), "utf8"),
			);
			assert.deepEqual(manifest.registry, "local");
			assert.deepEqual(manifest.registries, { local: "file:.registry" });
			assert.deepEqual(manifest.installed, { "@nazare/button": "0.1.0" });
			assert.ok(manifest.installedFiles["@nazare/button"]["button.nz.liquid"]);
		},
	);
});
