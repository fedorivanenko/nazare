import assert from "node:assert/strict";

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import nodeTest from "node:test";
import { pathToFileURL } from "node:url";

const cli = resolve("packages/cli-client/dist/index.js");

const RUN_FULL_CLI_TESTS = process.env.NAZARE_FULL_CLI_TESTS === "1";

function test(name, optionsOrFn, maybeFn) {
	const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
	const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn;
	nodeTest(
		name,
		{
			concurrency: true,
			skip: !RUN_FULL_CLI_TESTS && !options.smoke,
		},
		fn,
	);
}

async function runCli(cwd, ...args) {
	let stdout = "";
	let stderr = "";
	const { main } = await import(pathToFileURL(cli).href);
	const status = await main(args, {
		cwd,
		env: { ...process.env, NAZARE_REGISTRY: undefined },
		output: {
			log: (...values) => {
				stdout += `${values.join(" ")}\n`;
			},
			error: (...values) => {
				stderr += `${values.join(" ")}\n`;
			},
		},
	});
	return { status, stdout, stderr };
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

test("cli: reports its development package version", {
	smoke: true,
}, async () => {
	const out = await runCli(process.cwd(), "--version");
	assert.equal(out.status, 0, out.stderr);
	assert.equal(out.stdout.trim(), "0.0.0");
});

test("cli: preview and inspect expose focused help", {
	smoke: true,
}, async () => {
	for (const { args, usage } of [
		{ args: ["preview", "--help"], usage: "Usage: nazare preview" },
		{ args: ["preview", "serve", "-h"], usage: "Usage: nazare preview" },
		{ args: ["inspect", "--help"], usage: "nazare inspect <ast|ir|graph" },
		{ args: ["help", "inspect"], usage: "nazare inspect <ast|ir|graph" },
	]) {
		const out = await runCli(process.cwd(), ...args);
		assert.equal(out.status, 0, `${args.join(" ")}\n${out.stderr}`);
		assert.ok(out.stderr.includes(usage), out.stderr);
	}
});

test("cli: source analyze emits authoritative plain-Liquid facts", {
	smoke: true,
}, async () => {
	await withProject(
		{ "snippets/card.liquid": "{{ product.title }}" },
		async (cwd) => {
			const out = await runCli(
				cwd,
				"source",
				"analyze",
				"snippets/card.liquid",
			);
			assert.equal(out.status, 0, out.stderr);
			const result = JSON.parse(out.stdout);
			assert.equal(result.schemaVersion, 1);
			assert.equal(result.language, "liquid");
			assert.equal(result.authoritative, true);
			assert.equal(result.syntax.liquid.reads[0].root, "product");
		},
	);
});

test("cli: source analyze fails closed for malformed source", {
	smoke: true,
}, async () => {
	await withProject({ "broken.liquid": "{% if product %}" }, async (cwd) => {
		const out = await runCli(cwd, "source", "analyze", "broken.liquid");
		assert.equal(out.status, 1, out.stderr);
		const result = JSON.parse(out.stdout);
		assert.equal(result.authoritative, false);
		assert.ok(result.issues.length > 0);
		assert.deepEqual(result.syntax.liquid.reads, []);
	});
});

test("cli: source analysis JSON schema matches golden contracts", {
	smoke: true,
}, async () => {
	for (const fixture of [
		{ name: "liquid", file: "input.liquid", args: [], status: 0 },
		{
			name: "nazare",
			file: "input.nz.liquid",
			args: ["--language", "nazare-liquid"],
			status: 0,
		},
		{ name: "malformed", file: "input.liquid", args: [], status: 1 },
	]) {
		const fixtureRoot = resolve(
			"packages/cli-client/tests/fixtures/source-analysis",
			fixture.name,
		);
		const source = readFileSync(join(fixtureRoot, fixture.file), "utf8");
		const expected = JSON.parse(
			readFileSync(join(fixtureRoot, "expected.json"), "utf8"),
		);
		await withProject({ [fixture.file]: source }, async (cwd) => {
			const out = await runCli(
				cwd,
				"source",
				"analyze",
				fixture.file,
				...fixture.args,
			);
			assert.equal(out.status, fixture.status, out.stderr);
			assert.deepEqual(JSON.parse(out.stdout), expected);
		});
	}
});

test("cli: source analyze supports the explicit Nazare grammar", {
	smoke: true,
}, async () => {
	await withProject(
		{ "card.nz.liquid": "{% component snippet %}<div></div>" },
		async (cwd) => {
			const out = await runCli(
				cwd,
				"source",
				"analyze",
				"card.nz.liquid",
				"--language",
				"nazare-liquid",
			);
			assert.equal(out.status, 0, out.stderr);
			const result = JSON.parse(out.stdout);
			assert.equal(result.language, "nazare-liquid");
			assert.equal(result.syntax.nazare[0].kind, "component");
		},
	);
});

test("cli: init scaffolds build config and creates the source dir", {
	smoke: true,
}, async () => {
	// Non-interactive stdin (spawned) → init takes the src/theme defaults.
	await withProject({}, async (cwd) => {
		const out = await runCli(cwd, "init");
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
			const out = await runCli(
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
			const blocked = await runCli(cwd, "init");
			assert.notEqual(blocked.status, 0);
			assert.match(blocked.stderr, /already has a build config/);

			const forced = await runCli(
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
			const strict = await runCli(
				cwd,
				"inspect",
				"artifact",
				"component.nz.liquid",
			);
			const loose = await runCli(
				cwd,
				"inspect",
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

test("cli: build validates dependencies, check looks at the entry only", async () => {
	await withProject(
		{
			"component.nz.liquid": `{% import Child from "./child.nz.liquid" %}\n{% render Child {} %}`,
			"child.nz.liquid": `{% props { title: string.requried() } %}<span>{{ props.title }}</span>`,
		},
		async (cwd) => {
			// build checks imported files, so the child's parse error surfaces.
			const built = await runCli(
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

			// check compiles the entry only — the child is not checked here.
			const validated = await runCli(cwd, "check", "component.nz.liquid");
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

test("cli: build with no path reads the source root from nazare.theme.json", {
	smoke: true,
}, async () => {
	await withProject(
		{
			"nazare.theme.json": BUILD_MANIFEST,
			"nazare/alpha/alpha.nz.liquid": componentWithScript("a"),
			"nazare/beta/beta.nz.liquid": componentWithScript("b"),
			// Not under the configured source root, so the walk must ignore it.
			"stray/stray.nz.liquid": componentWithScript("c"),
		},
		async (cwd) => {
			const built = await runCli(cwd, "build", "--json");
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
			const built = await runCli(cwd, "build", "--out-dir", "theme", "--json");
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
						module: "./nazare.extensions/manifest.mjs",
						options: { label: "components" },
					},
				],
			}),
			"nazare/button.nz.liquid": "<button>Button</button>\n",
			"nazare.extensions/manifest.mjs": `export default {
  name: "manifest",
  emit({ components, options }) {
    return {
      files: [{
        path: "assets/extension-manifest.json",
        contents: JSON.stringify({ label: options.label, files: components.map((component) => component.file) })
      }],
      issues: []
    };
  }
};
`,
		},
		async (cwd) => {
			const built = await runCli(cwd, "build", "--json");
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
			const built = await runCli(cwd, "build", "--json");
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
			const built = await runCli(cwd, "build", "--json");
			assert.notEqual(built.status, 0);
			assert.match(built.stderr, /Extension modules must be .mjs/);
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
			const built = await runCli(cwd, "build", "--json");
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
			const built = await runCli(cwd, "build", "--json");
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
			const built = await runCli(
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
		const built = await runCli(
			cwd,
			"build",
			"does-not-exist",
			"--out-dir",
			"theme",
		);
		assert.notEqual(built.status, 0);
		assert.match(built.stderr, /Source path not found/);
	});
});

test("cli: build errors when no output dir is configured", async () => {
	await withProject(
		{ "nazare/button.nz.liquid": "<button>Button</button>\n" },
		async (cwd) => {
			const built = await runCli(cwd, "build", "nazare");
			assert.notEqual(built.status, 0);
			assert.match(built.stderr, /output directory/);
		},
	);
});

test("cli: build errors when no source root is configured", async () => {
	await withProject({}, async (cwd) => {
		const built = await runCli(cwd, "build", "--out-dir", "theme");
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
			const built = await runCli(cwd, "build");
			assert.equal(built.status, 0, built.stderr);
			// Not JSON, and it leads with a plain summary line.
			assert.throws(() => JSON.parse(built.stdout));
			assert.match(built.stdout, /Built 1 component/);
			assert.match(built.stdout, /Build OK/);
		},
	);
});

test("cli: pack is available on the main nazare command", {
	smoke: true,
}, async () => {
	await withProject(
		{
			"nazare/button/nazare.json": JSON.stringify({
				id: "@acme/button",
				version: "0.1.0",
				entry: "button.ts",
				license: "MIT",
				dependencies: {},
				files: ["button.ts"],
			}),
			"nazare/button/button.ts": "export const button = 1;\n",
		},
		async (cwd) => {
			const packed = await runCli(
				cwd,
				"registry",
				"publish",
				"nazare/button",
				"--pack",
			);
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

test("cli: registry connect/use stores project registry and add reads it", async () => {
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
			const addedRegistry = await runCli(
				cwd,
				"registry",
				"connect",
				"local",
				"file:.registry",
			);
			assert.equal(addedRegistry.status, 0, addedRegistry.stderr);
			assert.equal(JSON.parse(addedRegistry.stdout).current, "local");

			const listed = await runCli(cwd, "registry", "list");
			assert.equal(listed.status, 0, listed.stderr);
			assert.deepEqual(JSON.parse(listed.stdout), {
				current: "local",
				registries: { local: "file:.registry" },
			});

			const installed = await runCli(
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

test("cli: inspect names the view first and rejects an unknown one", async () => {
	await withProject(
		{ "component.nz.liquid": "<div>hi</div>\n" },
		async (cwd) => {
			const ir = await runCli(cwd, "inspect", "ir", "component.nz.liquid");
			assert.equal(ir.status, 0, ir.stderr);
			assert.ok(JSON.parse(ir.stdout).ir);

			const unknown = await runCli(
				cwd,
				"inspect",
				"nope",
				"component.nz.liquid",
			);
			assert.equal(unknown.status, 1);
			assert.match(unknown.stderr, /nazare inspect <ast\|ir\|/);

			// The old top-level spellings are gone, not aliased.
			const removed = await runCli(cwd, "ir", "component.nz.liquid");
			assert.equal(removed.status, 1);
			assert.match(removed.stderr, /Unknown command ir/);
		},
	);
});

test("cli: registry verbs answer under the namespace and at the top level", async () => {
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
			const connected = await runCli(
				cwd,
				"registry",
				"connect",
				"local",
				"file:.registry",
			);
			assert.equal(connected.status, 0, connected.stderr);

			// The namespaced spelling is canonical...
			const namespaced = await runCli(
				cwd,
				"registry",
				"add",
				"@nazare/button",
				"--source-root",
				"nazare",
			);
			assert.equal(namespaced.status, 0, namespaced.stderr);
			assert.ok(existsSync(join(cwd, "nazare/button/button.nz.liquid")));

			// ...and the top-level alias reaches the same command: it sees the
			// install the namespaced spelling just recorded, and skips it.
			const aliased = await runCli(
				cwd,
				"add",
				"@nazare/button",
				"--source-root",
				"nazare",
			);
			assert.equal(aliased.status, 0, aliased.stderr);
			assert.deepEqual(JSON.parse(aliased.stdout).skipped, [
				{ id: "@nazare/button", version: "0.1.0" },
			]);
		},
	);
});

test("cli: a successful build prints the Shopify CLI handoff", async () => {
	await withProject(
		{
			"nazare/component.nz.liquid": "<div>hi</div>\n",
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: "nazare", outDir: "theme" },
			}),
		},
		async (cwd) => {
			const built = await runCli(cwd, "build");
			assert.equal(built.status, 0, built.stderr);
			// Nazare stops at the theme directory; the Shopify CLI uploads it.
			assert.match(built.stdout, /shopify theme push --path theme/);
		},
	);
});

test("cli: inspect impact answers what a file can affect", async () => {
	await withProject(
		{
			"templates/product.json": JSON.stringify({
				sections: { main: { type: "main" } },
			}),
			"sections/main.liquid": "{% render 'card' %}",
			"snippets/card.liquid": "{% render 'money' %}",
			"snippets/money.liquid": "{{ amount }}",
		},
		async (cwd) => {
			const text = await runCli(
				cwd,
				"inspect",
				"impact",
				"snippets/card.liquid",
				".",
			);
			assert.equal(text.status, 0, text.stderr);
			assert.deepEqual(text.stdout.trim().split("\n"), [
				"Impact: snippets/card.liquid",
				"Kind snippet · usage used · certainty complete",
				"Dependencies (1):",
				"- snippets/money.liquid",
				"Dependents (1):",
				"- sections/main.liquid",
				"Affected pages (1):",
				"- templates/product.json",
				"Uncertainty: none",
				"Issues: none",
			]);
			const cachePath = join(cwd, ".nazare-out", "inspect-cache-v4.json");
			const coldCache = readFileSync(cachePath, "utf8");
			const coldCacheInode = statSync(cachePath).ino;

			const json = await runCli(
				cwd,
				"inspect",
				"impact",
				"snippets/card.liquid",
				".",
				"--format",
				"json",
			);
			assert.equal(json.status, 0, json.stderr);
			const impact = JSON.parse(json.stdout);
			assert.equal(impact.version, 1);
			assert.deepEqual(impact.affectedPages, ["templates/product.json"]);
			assert.equal(readFileSync(cachePath, "utf8"), coldCache);
			assert.equal(
				statSync(cachePath).ino,
				coldCacheInode,
				"a warm impact query must not rewrite its cache",
			);

			writeFileSync(join(cwd, "sections/main.liquid"), "<section></section>");
			const changed = await runCli(
				cwd,
				"inspect",
				"impact",
				"snippets/card.liquid",
				".",
				"--format",
				"json",
			);
			assert.equal(changed.status, 0, changed.stderr);
			const changedImpact = JSON.parse(changed.stdout);
			assert.equal(changedImpact.usage, "unused");
			assert.deepEqual(changedImpact.dependents, []);
			assert.notEqual(statSync(cachePath).ino, coldCacheInode);
		},
	);
});

test("cli: inspect metafield reports definition, readers, and affected pages", async () => {
	await withProject(
		{
			".shopify/metafields.json": JSON.stringify({
				product: [
					{
						namespace: "custom",
						key: "subtitle",
						type: { name: "single_line_text_field" },
					},
				],
			}),
			"templates/product.json": JSON.stringify({
				sections: {
					main: {
						type: "main",
						settings: {
							source: "{{ product.metafields.custom.subtitle }}",
						},
					},
				},
			}),
		},
		async (cwd) => {
			const text = await runCli(
				cwd,
				"inspect",
				"metafield",
				"product.custom.subtitle",
				".",
			);
			assert.equal(text.status, 0, text.stderr);
			assert.match(text.stdout, /Metafield: product\.custom\.subtitle/);
			assert.match(text.stdout, /Definition: single_line_text_field/);
			assert.match(text.stdout, /- templates\/product\.json \(1 read\)/);
			assert.match(text.stdout, /- templates\/product\.json/);
			assert.match(text.stdout, /Certainty: complete/);

			const json = await runCli(
				cwd,
				"inspect",
				"metafield",
				"product.custom.subtitle",
				".",
				"--format",
				"json",
			);
			assert.equal(json.status, 0, json.stderr);
			const impact = JSON.parse(json.stdout);
			assert.equal(impact.version, 1);
			assert.equal(impact.definition.type, "single_line_text_field");
			assert.deepEqual(impact.affectedSources, ["templates/product.json"]);
			assert.deepEqual(impact.affectedPages, ["templates/product.json"]);
			assert.equal(impact.snapshot.state, "present");
			assert.equal(impact.certainty, "complete");
			assert.deepEqual(impact.uncertainty, []);
			assert.deepEqual(impact.uncertainSources, []);

			const malformed = await runCli(
				cwd,
				"inspect",
				"metafield",
				"custom.subtitle",
				".",
			);
			assert.equal(malformed.status, 1);
			assert.match(malformed.stderr, /expected owner\.namespace\.key/);
		},
	);
});

test("cli: warm impact cache preserves analysis error status", async () => {
	await withProject(
		{
			"sections/broken.liquid": `{% schema %}{"name":"Broken","settings":[]}{% endschema %}
{{ section.settings.missing }}`,
		},
		async (cwd) => {
			for (let run = 0; run < 2; run += 1) {
				const result = await runCli(
					cwd,
					"inspect",
					"impact",
					"sections/broken.liquid",
					".",
					"--format",
					"json",
				);
				assert.equal(result.status, 1, result.stderr);
				assert.ok(
					JSON.parse(result.stdout).issues.some(
						(issue) => issue.code === "CONSTRAINT_UNKNOWN_SETTING_READ",
					),
				);
			}
		},
	);
});

test("cli: inspect can render a concise human report", async () => {
	await withProject(
		{
			"sections/main.liquid": "{% render 'card' %}",
			"snippets/card.liquid": "{{ product.title }}",
		},
		async (cwd) => {
			const result = await runCli(
				cwd,
				"inspect",
				"theme",
				".",
				"--format",
				"text",
			);
			assert.equal(result.status, 0);
			assert.deepEqual(result.stdout.trim().split("\n"), [
				"Theme graph: 2 files",
				"Pages 0 · sections 1 · snippets 1 · components 0",
				"Unresolved 0 · metafield reads without definitions 0",
				"Affected pages 0",
				"Issues 0 (0 errors, 0 warnings)",
			]);
		},
	);
});

test("cli: inspect reports migration from the legacy cache", async () => {
	await withProject(
		{
			"snippets/card.liquid": "{{ product.title }}",
			".nazare-out/inspect-cache-v3.json": "{}",
		},
		async (cwd) => {
			const result = await runCli(
				cwd,
				"inspect",
				"impact",
				"snippets/card.liquid",
				".",
				"--format",
				"json",
			);
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, /Ignored legacy theme analysis cache/);
			assert.equal(
				existsSync(join(cwd, ".nazare-out", "inspect-cache-v4.json")),
				true,
			);
		},
	);
});

test("cli: inspect discards a malformed cache and analyzes from source", async () => {
	await withProject(
		{
			"snippets/card.liquid": "{{ product.title }}",
			".nazare-out/inspect-cache-v4.json": "{invalid",
		},
		async (cwd) => {
			const result = await runCli(
				cwd,
				"inspect",
				"theme",
				".",
				"--format",
				"json",
			);
			// A cache is an optimization. An unusable one is reported and replaced,
			// never a reason to fail the command.
			assert.equal(result.status, 0, result.stderr);
			assert.match(result.stderr, /Discarded theme inspection cache/);
			assert.match(result.stderr, /invalid JSON/);
			const graph = JSON.parse(result.stdout);
			assert.ok(
				graph.nodes.some((node) => node.id === "file:snippets/card.liquid"),
			);
		},
	);
});

test("cli: inspect discards cache facts owned by another source", async () => {
	await withProject({ "snippets/card.liquid": "{{ title }}" }, async (cwd) => {
		const first = await runCli(
			cwd,
			"inspect",
			"theme",
			".",
			"--format",
			"json",
		);
		assert.equal(first.status, 0, first.stderr);
		const cachePath = join(cwd, ".nazare-out", "inspect-cache-v4.json");
		const cache = JSON.parse(readFileSync(cachePath, "utf8"));
		cache.entries["snippets/card.liquid"].facts = [
			{ kind: "file", path: "snippets/other.liquid", fileKind: "snippet" },
		];
		writeFileSync(cachePath, JSON.stringify(cache));

		const second = await runCli(
			cwd,
			"inspect",
			"theme",
			".",
			"--format",
			"json",
		);
		// Ownership validation still rejects the entry; it just costs a cold
		// rebuild rather than the whole command.
		assert.equal(second.status, 0, second.stderr);
		assert.match(second.stderr, /Discarded theme inspection cache/);
		assert.match(second.stderr, /snippets\/card\.liquid/);
		const graph = JSON.parse(second.stdout);
		assert.ok(
			graph.nodes.some((node) => node.id === "file:snippets/card.liquid"),
		);
		// The discarded cache is replaced by a valid one, so the next run is warm
		// and every cached fact belongs to the file that owns the entry.
		const rewritten = JSON.parse(readFileSync(cachePath, "utf8"));
		const entry = rewritten.entries["snippets/card.liquid"];
		assert.ok(entry.facts.length > 0);
		for (const fact of entry.facts) {
			assert.equal(fact.path ?? fact.fromPath, "snippets/card.liquid");
		}
	});
});

test("cli: inspect honors inspect.exclude and reports every excluded file", async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: ".", outDir: ".nazare-out/theme" },
				inspect: { exclude: ["snippets/reploChunk.*.liquid"] },
			}),
			"sections/main.liquid": "{% render 'card' %}",
			"snippets/card.liquid": "{{ product.title }}",
			"snippets/reploChunk.abc.0.liquid": "<div>generated</div>",
		},
		async (cwd) => {
			const result = await runCli(
				cwd,
				"inspect",
				"theme",
				".",
				"--format",
				"json",
			);
			assert.equal(result.status, 0);
			const graph = JSON.parse(result.stdout);

			const excluded = graph.issues.filter(
				(issue) => issue.code === "THEME_FILE_EXCLUDED",
			);
			assert.equal(excluded.length, 1);
			assert.equal(excluded[0].span.file, "snippets/reploChunk.abc.0.liquid");
			assert.equal(
				graph.nodes.some((node) => node.id.includes("reploChunk")),
				false,
			);
			assert.equal(
				graph.nodes.some((node) => node.id.includes("snippets/card.liquid")),
				true,
			);
		},
	);
});

test("cli: inspect loads metafield snapshot and reports graph queries", {
	smoke: true,
}, async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: ".", outDir: ".nazare-out/theme" },
			}),
			"snippets/card.liquid": "{{ product.metafields.custom.subtitle }}",
			".shopify/metafields.json": JSON.stringify([
				{ owner: "product", namespace: "custom", key: "subtitle" },
			]),
		},
		async (cwd) => {
			const result = await runCli(
				cwd,
				"inspect",
				"theme",
				".",
				"--format",
				"json",
			);
			assert.equal(result.status, 0);
			const graph = JSON.parse(result.stdout);
			assert.equal(graph.metafields.state, "present");
			assert.equal(graph.metafields.consumedDefinitionIds.length, 1);
		},
	);
});

test("cli: inspect rejects a malformed inspect.exclude instead of ignoring it", async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: ".", outDir: ".nazare-out/theme" },
				inspect: { exclude: "snippets/*.liquid" },
			}),
			"snippets/card.liquid": "{{ product.title }}",
		},
		async (cwd) => {
			const result = await runCli(
				cwd,
				"inspect",
				"theme",
				".",
				"--format",
				"json",
			);
			assert.equal(result.status, 1);
			assert.match(result.stderr, /inspect\.exclude/);
		},
	);
});

test("cli: inspect rejects roots whose symlink target escapes the project", async () => {
	const outside = mkdtempSync(join(tmpdir(), "nazare-cli-outside-"));
	try {
		writeFileSync(join(outside, "secret.liquid"), "outside");
		await withProject({}, async (cwd) => {
			symlinkSync(outside, join(cwd, "linked-theme"), "dir");
			const result = await runCli(
				cwd,
				"inspect",
				"theme",
				"linked-theme",
				"--format",
				"json",
			);

			assert.equal(result.status, 1);
			assert.match(result.stderr, /resolves outside the project root/);
			assert.doesNotMatch(result.stdout, /secret/);
		});
	} finally {
		await rm(outside, { recursive: true, force: true });
	}
});

test("cli: inspect treats missing external artifacts as unknown", {
	smoke: true,
}, async () => {
	await withProject(
		{
			"nazare.theme.json": JSON.stringify({
				build: { sourceRoot: ".", outDir: ".nazare-out/theme" },
			}),
			"snippets/card.liquid": "{{ product.metafields.custom.subtitle }}",
		},
		async (cwd) => {
			const result = await runCli(
				cwd,
				"inspect",
				"theme",
				".",
				"--format",
				"json",
			);
			assert.equal(result.status, 0);
			assert.equal(JSON.parse(result.stdout).metafields.state, "unknown");
		},
	);
});
