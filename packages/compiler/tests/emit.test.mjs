import assert from "node:assert/strict";
import { test } from "node:test";
import { compileNazareArtifact, emitTheme } from "../dist/index.js";

function emit(source, options = {}) {
	const compiled = compileNazareArtifact(source, "component.nz.liquid");
	return emitTheme(source, compiled, { name: "widget", ...options });
}

function fileByPath(result, path) {
	return result.files.find((file) => file.path === path);
}

const disclosureLike = `{% props {
  label: string.setting({ label: "Label", default: "Details" }),
} %}

<div ref="root" class="widget">
  <button ref="trigger">{{ section.settings.label }}</button>
</div>

{% script lang="ts" %}
export default island(({ refs }: { refs: any }) => {
  refs.trigger.addEventListener("click", () => refs.root.remove());
});
{% endscript %}`;

test("emit: liquid strips nazare tags and rewrites refs", () => {
	const result = emit(disclosureLike);
	const liquid = fileByPath(result, "snippets/widget.liquid")?.contents;

	assert.ok(liquid);
	assert.ok(!liquid.includes("{% props"));
	assert.ok(!liquid.includes("{% script"));
	assert.ok(!liquid.includes(' ref="'), "authored ref attributes are gone");
	assert.ok(liquid.includes('data-nz-ref="trigger"'));
	assert.ok(liquid.includes('data-nz-component="widget"'));
	assert.ok(liquid.includes("{{ section.settings.label }}"));
	assert.ok(liquid.includes("'widget.js' | asset_url | script_tag"));
});

test("emit: component script is transpiled and registered", () => {
	const result = emit(disclosureLike);
	const script = fileByPath(result, "assets/widget.js")?.contents;

	assert.ok(script);
	assert.ok(script.includes('window.Nazare.register("widget"'));
	assert.ok(!script.includes("export default"));
	assert.ok(!script.includes(": { refs: any }"), "types are stripped");
	assert.ok(fileByPath(result, "assets/nazare-runtime.js"));
});

test("emit: sections embed the generated schema", () => {
	const result = emit(disclosureLike, { kind: "section" });
	const liquid = fileByPath(result, "sections/widget.liquid")?.contents;

	assert.ok(liquid);
	assert.ok(liquid.includes("{% schema %}"));
	assert.ok(liquid.includes('"id": "label"'));
	assert.ok(liquid.includes('"default": "Details"'));
});

test("emit: render sites lower to plain liquid render tags", () => {
	const source = `{% import Link from "@nazare/link" %}
{% render Link {href: section.settings.link, text: "Go"} %}`;
	const result = emit(source);
	const liquid = fileByPath(result, "snippets/widget.liquid")?.contents;

	assert.ok(liquid);
	assert.ok(
		liquid.includes(
			"{% render 'link', href: section.settings.link, text: \"Go\" %}",
		),
	);
	assert.ok(!liquid.includes("import"));
});

test("emit: no script means no js assets", () => {
	const result = emit(`<div>static</div>`);
	assert.deepEqual(
		result.files.map((file) => file.path),
		["snippets/widget.liquid"],
	);
	assert.ok(
		!fileByPath(result, "snippets/widget.liquid")?.contents.includes(
			"script_tag",
		),
	);
});

test("emit: script without a root element warns", () => {
	const result = emit(`{% script %}
export default island(() => {});
{% endscript %}`);
	assert.ok(
		result.issues.some(
			(issue) => issue.code === "EMIT_SCRIPT_WITHOUT_ROOT_ELEMENT",
		),
	);
});

test("emit: script without default export warns", () => {
	const result = emit(`<div ref="root"></div>
{% script %}
island(({ refs }) => refs.root.remove());
{% endscript %}`);
	assert.ok(
		result.issues.some(
			(issue) => issue.code === "EMIT_SCRIPT_WITHOUT_DEFAULT_EXPORT",
		),
	);
});
