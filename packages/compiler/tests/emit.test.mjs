// The output-as-spec: compile a component and snapshot the theme files it
// actually emits (Liquid, CSS, JS), which is the thing that ships. Readable
// snapshots double as documentation of provenance lowering, css scoping,
// hoisting, schema, blocks, islands, and the data descriptor — so a diff
// means a real change to shipped output. The constant runtime asset is
// excluded. Refresh with UPDATE_SNAPSHOTS=1.
import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	compileNazareArtifact,
	compilePlainLiquid,
	emitTheme,
	validateArtifactIR,
} from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");
const snapshotsDir = join(here, "__snapshots__");
const updateSnapshots = process.env.UPDATE_SNAPSHOTS === "1";

function snapshotEmit(name, source, file, readFile) {
	const compiled = compileNazareArtifact(source, file, { readFile });
	const emitted = emitTheme(source, compiled, { name, readFile });
	const errors = [...compiled.issues, ...emitted.issues].filter(
		(issue) => issue.severity === "error",
	);
	const body = emitted.files
		.filter((f) => f.path !== "assets/nazare-runtime.js")
		.map((f) => `=== ${f.path} ===\n${f.contents}`)
		.join("\n");
	const errorLines = errors.length
		? `=== errors ===\n${errors.map((e) => `${e.code}: ${e.message}`).join("\n")}\n`
		: "";
	const actual = `${errorLines}${body}\n`;

	const path = join(snapshotsDir, `${name}.emit.snap`);
	if (updateSnapshots) {
		mkdirSync(snapshotsDir, { recursive: true });
		writeFileSync(path, actual);
		return;
	}
	let expected;
	try {
		expected = readFileSync(path, "utf8");
	} catch {
		assert.fail(`Missing snapshot ${name}.emit.snap; run UPDATE_SNAPSHOTS=1`);
	}
	assert.equal(actual, expected);
}

// Every curated registry component: the emitted theme files, end to end.
const readProject = (path) => {
	try {
		return readFileSync(join(repoRoot, path), "utf8");
	} catch {
		return undefined;
	}
};
const componentsDir = join(repoRoot, "registry", "components");
for (const entry of readdirSync(componentsDir, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const manifest = JSON.parse(
		readFileSync(join(componentsDir, entry.name, "nazare.json"), "utf8"),
	);
	if (!manifest.entry.endsWith(".nz.liquid")) continue;
	const entryPath = join(componentsDir, entry.name, manifest.entry);
	const file = relative(repoRoot, entryPath);
	test(`emit: ${entry.name}`, () => {
		snapshotEmit(
			entry.name,
			readFileSync(entryPath, "utf8"),
			file,
			readProject,
		);
	});
}

// Synthetic cases for output shapes the examples don't exercise.
test("emit: island placement scopes the behavior to a subtree", () => {
	const files = {
		"components/w/behavior.ts": `export default island(({ root }) => {\n  root.dataset.ready = "true";\n});\n`,
	};
	snapshotEmit(
		"island-placement",
		`{% import behavior from "./behavior.ts" %}\n<div ref="root">\n  <section island="behavior"><button ref="go">+</button></section>\n</div>`,
		"components/w/w.nz.liquid",
		(path) => files[path],
	);
});

test("emit: multiple inline behaviors register in declaration order", () => {
	snapshotEmit(
		"multi-behavior",
		`<div ref="root"></div>\n{% script %}\nexport default island(({ refs }) => refs.root.classList.add("a"));\n{% endscript %}\n{% script %}\nexport default island(({ refs }) => refs.root.classList.add("b"));\n{% endscript %}`,
		"components/w/w.nz.liquid",
		undefined,
	);
});

test("emit: snippet defaults preserve false, zero, and quoted strings", () => {
	const source = `{% props {
  enabled: boolean.default(false),
  count: number.default(0),
  label: string.default("say \\"hi\\""),
} %}
<span>{{ props.enabled }} {{ props.count }} {{ props.label }}</span>`;
	const compiled = compileNazareArtifact(source, "components/status.nz.liquid");
	const emitted = emitTheme(source, compiled, { name: "status" });
	assert.deepEqual(
		emitted.issues.filter((issue) => issue.severity === "error"),
		[],
	);
	const liquid = emitted.files.find(
		(file) => file.path === "snippets/status.liquid",
	)?.contents;
	assert.ok(liquid);
	assert.match(
		liquid,
		/{% if enabled == nil %}\n {2}{% assign enabled = false %}\n{% endif %}/,
	);
	assert.match(
		liquid,
		/{% if count == nil %}\n {2}{% assign count = 0 %}\n{% endif %}/,
	);
	assert.ok(
		liquid.includes(
			`{% assign label = "say " | append: '"' | append: "hi" | append: '"' %}`,
		),
	);
	assert.equal(
		compilePlainLiquid(liquid, "snippets/status.liquid").issues.some(
			(issue) => issue.severity === "error",
		),
		false,
	);
});

test("emit: section defaults remain owned by Shopify schema", () => {
	const source = `{% component section %}
{% props { enabled: boolean.setting({ label: "Enabled", default: false }) } %}
<div>{{ props.enabled }}</div>`;
	const compiled = compileNazareArtifact(source, "components/status.nz.liquid");
	const emitted = emitTheme(source, compiled, { name: "status" });
	const liquid = emitted.files.find(
		(file) => file.path === "sections/status.liquid",
	)?.contents;
	assert.ok(liquid);
	assert.equal(liquid.includes("{% if enabled == nil %}"), false);
	assert.match(liquid, /"default": false/);
});

test("emit: malformed default contracts fail explicitly", () => {
	const source = `{% props { enabled: boolean.default(false) } %}
<span>{{ props.enabled }}</span>`;
	const compiled = compileNazareArtifact(source, "components/status.nz.liquid");
	const prop = compiled.ir.syntax.find(
		(node) => node.kind === "prop-declaration" && node.name === "enabled",
	);
	assert.ok(prop);
	delete prop.typeInfo.defaultValue;
	assert.equal(
		validateArtifactIR(compiled.ir)[0]?.code,
		"IR_PROP_DEFAULT_INVALID",
	);
	const emitted = emitTheme(source, compiled, { name: "status" });
	assert.deepEqual(emitted.files, []);
	assert.equal(emitted.issues[0]?.code, "IR_PROP_DEFAULT_INVALID");
});

test("emit: a component with a script emits the shared runtime asset once", () => {
	const source = `<div ref="root"></div>\n{% script %}\nexport default island(({ refs }) => refs.root.remove());\n{% endscript %}`;
	const compiled = compileNazareArtifact(source, "w.nz.liquid");
	const emitted = emitTheme(source, compiled, { name: "w" });
	assert.equal(
		emitted.files.filter((f) => f.path === "assets/nazare-runtime.js").length,
		1,
	);
});
