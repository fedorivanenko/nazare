import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

const behavior = `export default island(({ root }) => {
  root.dataset.mounted = "true";
});
`;

function compile(source, readFile = () => behavior) {
	return compileNazareArtifact(source, "components/w/w.nz.liquid", { readFile });
}

function build(source, readFile = () => behavior) {
	const compiled = compile(source, readFile);
	const emitted = emitTheme(source, compiled, { name: "w", readFile });
	return {
		compiled,
		emitted,
		liquid: emitted.files.find((f) => f.path === "snippets/w.liquid")?.contents,
		script: emitted.files.find((f) => f.path === "assets/w.js")?.contents,
	};
}

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

test("island: placement rewrites the attribute and registers under the name", () => {
	const { liquid, script } = build(`{% import counter from "./counter.ts" %}
<div>
  <section island="counter"><button ref="go">+</button></section>
</div>`);
	assert.ok(liquid.includes('data-nz-island="counter"'));
	assert.ok(!liquid.includes(' island="counter"'));
	assert.ok(script.includes('window.Nazare.register("w", "counter",'));
});

test("island: unplaced behavior registers with null placement (mounts at root)", () => {
	const { script } = build(`{% import counter from "./counter.ts" %}
<div ref="root"><button ref="go">+</button></div>`);
	assert.ok(script.includes('window.Nazare.register("w", null,'));
});

test("island: inline scripts always mount at root", () => {
	const { script } = build(`<div ref="root"></div>
{% script %}
export default island(({ root }) => root.remove());
{% endscript %}`);
	assert.ok(script.includes('window.Nazare.register("w", null,'));
});

test("island: island naming no imported behavior is an error", () => {
	const result = compile(`{% import counter from "./counter.ts" %}
<div><section island="toggle"></section></div>`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNKNOWN_ISLAND",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("toggle"));
});

test("island: placing a behavior twice is an error", () => {
	const result = compile(`{% import counter from "./counter.ts" %}
<div>
  <section island="counter"></section>
  <aside island="counter"></aside>
</div>`);
	assert.ok(codes(result).includes("CONSTRAINT_DUPLICATE_ISLAND"));
});

test("island: dynamic island value is ignored with a warning", () => {
	const result = compile(`{% import counter from "./counter.ts" %}
<div><section island="{{ x }}"></section></div>`);
	assert.ok(codes(result).includes("NAZARE_PARSE_REF_ATTRIBUTE"));
	assert.ok(!codes(result).includes("CONSTRAINT_UNKNOWN_ISLAND"));
});

test("island: runtime mounts a placed behavior on its subtree, not the root", () => {
	const { script } = build(`{% import counter from "./counter.ts" %}
<div ref="root">
  <section island="counter"></section>
</div>`);

	// Rebuild a tiny DOM: the placed <section> is where the behavior mounts.
	const section = { dataset: {}, getAttribute: () => "counter" };
	const componentRoot = {
		dataset: {},
		getAttribute: (name) =>
			name === "data-nz-component" ? "w" : null,
		querySelectorAll: (selector) =>
			selector.includes('data-nz-island="counter"') ? [section] : [],
	};
	const documents = {
		w: [componentRoot],
	};
	const context = {
		window: {},
		document: {
			readyState: "complete",
			querySelectorAll: (selector) =>
				selector.includes('data-nz-component="w"') ? documents.w : [],
		},
	};
	// Provide the runtime, then the component script.
	const runtime = build(`{% import counter from "./counter.ts" %}
<div ref="root"><section island="counter"></section></div>`).emitted.files.find(
		(f) => f.path === "assets/nazare-runtime.js",
	).contents;
	vm.runInNewContext(runtime, context);
	vm.runInNewContext(script, context);

	assert.equal(section.dataset.mounted, "true", "placed subtree mounted");
	assert.notEqual(componentRoot.dataset.mounted, "true", "root did not mount");
});
