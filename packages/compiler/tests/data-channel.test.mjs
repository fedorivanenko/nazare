import assert from "node:assert/strict";
import { test } from "node:test";
import {
	checkComponentScripts,
	compileNazareArtifact,
	emitTheme,
} from "../dist/index.js";

const counter = `{% props {
  step: number.default(1),
  currency: string.setting({ label: "Currency" }),
} %}

<div ref="root" data-currency="{{ props.currency }}">
  <button ref="increment" data-step="{{ props.step }}">+</button>
</div>

{% script lang="ts" %}
export default island(({ refs, data }) => {
  let total = 0;
  refs.increment.addEventListener("click", () => {
    total += data.increment.step;
    refs.root.textContent = data.root.currency + total.toFixed(2);
  });
});
{% endscript %}`;

function compile(source) {
	return compileNazareArtifact(source, "component.nz.liquid");
}

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

test("data: valid channel compiles with no data diagnostics", () => {
	const result = compile(counter);
	assert.deepEqual(
		codes(result).filter((code) => code.includes("DATA")),
		[],
	);
});

test("data: bindings are typed in the script check", () => {
	// data.increment.step is number: arithmetic ok, string method is an error
	const bad = compile(counter.replace("total += data.increment.step", "data.increment.step.toUpperCase()"));
	const issues = checkComponentScripts(bad.ir);
	assert.ok(
		issues.some(
			(issue) =>
				issue.code === "SCRIPT_TYPE_ERROR" &&
				issue.message.includes("toUpperCase"),
		),
	);

	const good = compile(counter);
	assert.deepEqual(checkComponentScripts(good.ir), []);
});

test("data: reading an unbound property is an error", () => {
	const result = compile(`<div ref="root"></div>
{% script %}
export default island(({ data }) => {
  console.log(data.root.ghost);
});
{% endscript %}`);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_UNKNOWN_DATA_ACCESS",
	);
	assert.equal(issue?.severity, "error");
	assert.ok(issue.message.includes("ghost"));
});

test("data: unread binding warns when a script exists", () => {
	const result = compile(`{% props { step: number.default(1) } %}
<div ref="root" data-step="{{ props.step }}"></div>
{% script %}
export default island(({ refs }) => refs.root.remove());
{% endscript %}`);
	assert.ok(codes(result).includes("CONSTRAINT_UNUSED_DATA_BINDING"));
});

test("data: binding an undeclared prop is an error", () => {
	const result = compile(`<div ref="root" data-step="{{ props.ghost }}"></div>
{% script %}
export default island(({ data }) => console.log(data.root.step));
{% endscript %}`);
	assert.ok(codes(result).includes("CONSTRAINT_UNKNOWN_PROPS_REFERENCE"));
});

test("data: kebab-case attributes become camelCase properties", () => {
	const result = compile(`{% props { max_count: number.default(9) } %}
<div ref="root" data-max-count="{{ props.max_count }}"></div>
{% script %}
export default island(({ data }) => console.log(data.root.maxCount));
{% endscript %}`);
	assert.deepEqual(
		codes(result).filter((code) => code.includes("DATA")),
		[],
	);
});

test("data: emitted asset carries the parse descriptor per behavior", () => {
	const result = compile(counter);
	const emitted = emitTheme(counter, result, { name: "counter" });
	const script = emitted.files.find((f) => f.path === "assets/counter.js");
	assert.ok(script);
	assert.ok(
		script.contents.includes(
			'{"root":{"currency":"string"},"increment":{"step":"number"}}',
		),
	);
	assert.ok(
		script.contents.includes('window.Nazare.register("counter", __module.default, __data)'),
	);
});

test("data: multiple behaviors each register once", () => {
	const source = `<div ref="root"></div>
{% script %}
export default island(({ refs }) => refs.root.classList.add("a"));
{% endscript %}
{% script %}
export default island(({ refs }) => refs.root.classList.add("b"));
{% endscript %}`;
	const result = compile(source);
	const emitted = emitTheme(source, result, { name: "widget" });
	const script = emitted.files.find((f) => f.path === "assets/widget.js");
	const registrations = script.contents.match(/window\.Nazare\.register\(/g);
	assert.equal(registrations?.length, 2);
	assert.ok(script.contents.indexOf('add("a")') < script.contents.indexOf('add("b")'));
});
