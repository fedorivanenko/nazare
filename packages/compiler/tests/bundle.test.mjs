import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

const sidecars = {
	"./widget.ts": `import { clamp } from "./utils.ts";
export default island(({ refs }) => {
  refs.root.dataset.value = String(clamp(150, 0, 100));
});
`,
	"./utils.ts": `import { max } from "./lib/math.ts";
export function clamp(value: number, low: number, high: number): number {
  return max(low, Math.min(value, high));
}
`,
	"./lib/math.ts": `export function max(a: number, b: number): number {
  return a > b ? a : b;
}
`,
};

function build(source, readAsset = (path) => sidecars[path]) {
	const compiled = compileNazareArtifact(source, "components/widget/widget.nz.liquid", {
		readAsset,
	});
	const emitted = emitTheme(source, compiled, { name: "widget", readAsset });
	return {
		compiled,
		emitted,
		script: emitted.files.find((f) => f.path === "assets/widget.js")?.contents,
	};
}

test("bundle: relative imports are inlined into the emitted asset", () => {
	const { emitted, script } = build(`{% import "./widget.ts" %}
<div ref="root"></div>`);
	assert.deepEqual(
		emitted.issues.filter((i) => i.severity === "error"),
		[],
	);
	assert.ok(script.includes("function clamp"));
	assert.ok(script.includes("function max"));
	assert.ok(!script.includes('from "./utils.ts"'), "no ESM imports remain");
});

test("bundle: the emitted asset actually executes", () => {
	const { script } = build(`{% import "./widget.ts" %}
<div ref="root"></div>`);

	// Minimal DOM double: run the asset, mount the island, observe the effect.
	const element = {
		dataset: {},
		getAttribute: () => null,
		querySelector: () => element,
	};
	const registered = [];
	const context = {
		window: {
			Nazare: {
				island: (setup) => setup,
				register: (name, setup, data) => registered.push({ name, setup, data }),
			},
		},
	};
	vm.runInNewContext(script, context);

	assert.equal(registered.length, 1);
	registered[0].setup({ root: element, refs: { root: element }, data: {} });
	assert.equal(element.dataset.value, "100", "clamp(150, 0, 100) ran");
});

test("bundle: inline scripts can import relative files too", () => {
	const { script, emitted } = build(`<div ref="root"></div>
{% script lang="ts" %}
import { clamp } from "./utils.ts";
export default island(({ refs }) => {
  refs.root.dataset.v = String(clamp(5, 0, 3));
});
{% endscript %}`);
	assert.deepEqual(
		emitted.issues.filter((i) => i.severity === "error"),
		[],
	);
	assert.ok(script.includes("function clamp"));
});

test("bundle: a script without imports stays loader-free", () => {
	const { script } = build(`<div ref="root"></div>
{% script %}
export default island(({ refs }) => refs.root.remove());
{% endscript %}`);
	assert.ok(!script.includes("__load"));
	assert.ok(script.includes("window.Nazare.register"));
});

test("bundle: missing module is an emit error", () => {
	const { emitted } = build(`{% import "./widget.ts" %}
<div ref="root"></div>`, (path) =>
		path === "./widget.ts"
			? `import { gone } from "./missing.ts";\nexport default island(() => {});\n`
			: undefined,
	);
	assert.ok(
		emitted.issues.some((i) => i.code === "SCRIPT_IMPORT_NOT_FOUND"),
	);
});

test("bundle: import cycles are an emit error", () => {
	const cyclic = {
		"./widget.ts": `import "./a.ts";\nexport default island(() => {});\n`,
		"./a.ts": `import "./b.ts";\nexport const a = 1;\n`,
		"./b.ts": `import "./a.ts";\nexport const b = 2;\n`,
	};
	const { emitted } = build(`{% import "./widget.ts" %}
<div ref="root"></div>`, (path) => cyclic[path]);
	assert.ok(emitted.issues.some((i) => i.code === "SCRIPT_IMPORT_CYCLE"));
});

test("bundle: escaping the component directory is an emit error", () => {
	const { emitted } = build(`{% import "./widget.ts" %}
<div ref="root"></div>`, (path) =>
		path === "./widget.ts"
			? `import { x } from "../../shared.ts";\nexport default island(() => {});\n`
			: undefined,
	);
	assert.ok(emitted.issues.some((i) => i.code === "SCRIPT_IMPORT_INVALID"));
});
