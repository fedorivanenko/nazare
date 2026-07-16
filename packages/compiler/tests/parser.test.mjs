import assert from "node:assert/strict";
import test from "node:test";
import { parseNazareLiquid } from "../dist/index.js";

test("parser: script raw block ignores endscript inside strings and comments", () => {
	const source = [
		`{% script lang="ts" %}`,
		`const marker = "{% endscript %}";`,
		`const single = '{% endscript %}';`,
		"const template = `{% endscript %}`;",
		`const regex = /{% endscript %}/;`,
		`const returned = () => /{% endscript %}/;`,
		`// {% endscript %}`,
		`/* {% endscript %} */`,
		`export default island(() => {});`,
		`{% endscript %}`,
	].join("\n");
	const ast = parseNazareLiquid(source, "component.nz.liquid");
	const scripts = ast.nodes.filter((node) => node.type === "NazareScript");

	assert.equal(scripts.length, 1);
	assert.equal(scripts[0].source.includes("export default island"), true);
	assert.equal(scripts[0].source.includes("/* {% endscript %} */"), true);
	assert.equal(ast.diagnostics.length, 0);
});

test("parser: stylesheet raw block ignores endstylesheet inside strings and comments", () => {
	const source = `{% stylesheet styles %}
.a::after { content: "{% endstylesheet %}"; }
.b::before { content: '{% endstylesheet %}'; }
/* {% endstylesheet %} */
.c { color: red; }
{% endstylesheet %}`;
	const ast = parseNazareLiquid(source, "component.nz.liquid");
	const styles = ast.nodes.filter((node) => node.type === "NazareStyle");

	assert.equal(styles.length, 1);
	assert.equal(styles[0].source.includes(".c { color: red; }"), true);
	assert.equal(styles[0].source.includes("/* {% endstylesheet %} */"), true);
	assert.equal(ast.diagnostics.length, 0);
});
