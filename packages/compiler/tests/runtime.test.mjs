// Behavioral tests: run the emitted JS in a sandbox and observe the effect.
// These are the only tests that prove the whole emit -> bundle -> runtime
// chain works, not just that it produced the right text.
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

function build(source, file, readFile) {
	const compiled = compileNazareArtifact(source, file, { readFile });
	const emitted = emitTheme(source, compiled, { name: "w", readFile });
	return {
		emitted,
		runtime: emitted.files.find((f) => f.path === "assets/nazare-runtime.js")
			?.contents,
		script: emitted.files.find((f) => f.path === "assets/w.js")?.contents,
	};
}

test("runtime: a bundled relative module graph executes", () => {
	const files = {
		"components/w/w.js": `import { clamp } from "./utils.js";\nexport default island(({ refs }) => {\n  refs.root.dataset.value = String(clamp(150, 0, 100));\n});\n`,
		"components/w/utils.js": `export function clamp(v, lo, hi) {\n  return Math.max(lo, Math.min(v, hi));\n}\n`,
	};
	const { script } = build(
		`{% import w from "./w.js" %}\n<div ref="root"></div>`,
		"components/w/w.nz.liquid",
		(p) => files[p],
	);
	assert.ok(!script.includes('from "./utils.js"'), "imports inlined");

	const element = {
		dataset: {},
		getAttribute: () => null,
		querySelector: () => element,
	};
	const registered = [];
	vm.runInNewContext(script, {
		window: {
			Nazare: {
				island: (s) => s,
				register: (_n, _p, setup) => registered.push(setup),
			},
		},
	});
	assert.equal(registered.length, 1);
	registered[0]({ root: element, refs: { root: element }, data: {} });
	assert.equal(element.dataset.value, "100", "clamp(150,0,100) ran");
});

test("runtime: a sibling-directory import resolves and executes", () => {
	const cn = `export function cn(...values) {\n  const out = [];\n  for (const v of values) {\n    if (!v) continue;\n    if (typeof v === "string") { out.push(v); continue; }\n    for (const [k, on] of Object.entries(v)) if (on) out.push(k);\n  }\n  return out.join(" ");\n}\n`;
	const { script } = build(
		`<div ref="root"></div>\n{% script lang="js" %}\nimport { cn } from "../cn/cn.js";\nexport default island(({ root }) => { root.className = cn("a", { b: true, c: false }); });\n{% endscript %}`,
		"components/w/w.nz.liquid",
		(p) => (p === "components/cn/cn.js" ? cn : undefined),
	);
	const element = { className: "", getAttribute: () => null };
	const registered = [];
	vm.runInNewContext(script, {
		window: {
			Nazare: {
				island: (s) => s,
				register: (_n, _p, setup) => registered.push(setup),
			},
		},
	});
	registered[0]({ root: element, refs: {}, data: {} });
	assert.equal(element.className, "a b");
});

test("runtime: authored names cannot collide with generated module bindings", () => {
	const files = {
		"components/w/value.js": `export const value = "ready";`,
	};
	const { script } = build(
		`<div ref="root"></div>\n{% script %}\nimport { value } from "./value.js";\nconst __nazareExports = "authored";\nconst __nazareRequire = "authored";\nconst __nazareModules = "authored";\nconst __nazareModuleCache = "authored";\nconst __nazareLoadModule = "authored";\nexport default island(({ root }) => { root.dataset.value = value + __nazareExports + __nazareRequire + __nazareModules + __nazareModuleCache + __nazareLoadModule; });\n{% endscript %}`,
		"components/w/w.nz.liquid",
		(path) => files[path],
	);
	const element = { dataset: {}, getAttribute: () => null };
	const registered = [];
	vm.runInNewContext(script, {
		window: {
			Nazare: {
				island: (setup) => setup,
				register: (_name, _placement, setup) => registered.push(setup),
			},
		},
	});
	registered[0]({ root: element, refs: {}, data: {} });
	assert.equal(
		element.dataset.value,
		"readyauthoredauthoredauthoredauthoredauthored",
	);
});

test("runtime: a placed island mounts on its subtree, not the component root", () => {
	const files = {
		"components/w/behavior.js": `export default island(({ root }) => { root.dataset.mounted = "true"; });\n`,
	};
	const { runtime, script } = build(
		`{% import behavior from "./behavior.js" %}\n<div ref="root">\n  <section island="behavior"></section>\n</div>`,
		"components/w/w.nz.liquid",
		(p) => files[p],
	);

	const section = { dataset: {}, getAttribute: () => "behavior" };
	const componentRoot = {
		dataset: {},
		getAttribute: (n) => (n === "data-nz-component" ? "w" : null),
		querySelectorAll: (sel) =>
			sel.includes('data-nz-island="behavior"') ? [section] : [],
	};
	const context = {
		window: {},
		document: {
			readyState: "complete",
			querySelectorAll: (sel) =>
				sel.includes('data-nz-component="w"') ? [componentRoot] : [],
		},
	};
	vm.runInNewContext(runtime, context);
	vm.runInNewContext(script, context);

	assert.equal(section.dataset.mounted, "true", "placed subtree mounted");
	assert.notEqual(componentRoot.dataset.mounted, "true", "root did not mount");
});
