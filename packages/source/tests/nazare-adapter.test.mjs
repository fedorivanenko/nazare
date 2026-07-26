import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseNazareLiquid } from "../../compiler/dist/index.js";
import {
	createDefaultSourceParserRegistry,
	nazareSyntaxFacts,
	parseSourceDocument,
} from "../dist/index.js";

const registry = createDefaultSourceParserRegistry();

function offsetAt(source, position) {
	let offset = 0;
	for (let line = 1; line < position.line; line += 1) {
		offset = source.indexOf("\n", offset) + 1;
	}
	return offset + position.column - 1;
}

function filesUnder(directory) {
	const files = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...filesUnder(path));
		else if (path.endsWith(".nz.liquid")) files.push(path);
	}
	return files;
}

test("all committed Nazare corpus files produce authoritative CST facts", () => {
	const roots = [
		fileURLToPath(new URL("../../../fixtures/", import.meta.url)),
		fileURLToPath(new URL("../../../examples/", import.meta.url)),
	];
	const files = roots.flatMap(filesUnder);
	assert.ok(files.length > 0);
	for (const file of files) {
		const source = readFileSync(file, "utf8");
		const document = parseSourceDocument(
			registry,
			file,
			"nazare-liquid",
			source,
		);
		assert.deepEqual(document.issues, [], `Tree-sitter rejected ${file}`);
		assert.equal(nazareSyntaxFacts(document).authoritative, true);
	}
});

test("Nazare declaration and reference facts match legacy parser", () => {
	const source = `{% component section %}
{% import Card from "./card.nz.liquid" %}
{% import behavior from "./behavior.ts" %}
{% props { title: string.required(), count: number } %}
{% if enabled %}{% render Card { title: props.title, class: styles.card } %}{% endif %}
{% blocks Card, Banner %}
<div ref="root" nz-root data-count="{{ props.count }}">{{ props.title }}<section island="behavior"></section></div>
{% script lang="ts" %}const marker = "{% endscript %}";{% endscript %}
{% stylesheet styles %}.card { color: red; }{% endstylesheet %}`;
	const document = parseSourceDocument(
		registry,
		"x.nz.liquid",
		"nazare-liquid",
		source,
	);
	assert.deepEqual(document.issues, []);
	const actual = nazareSyntaxFacts(document);
	assert.equal(actual.authoritative, true);
	const legacy = parseNazareLiquid(source, "x.nz.liquid");
	assert.deepEqual(legacy.diagnostics, []);

	const component = actual.facts.find((fact) => fact.kind === "component");
	assert.equal(component.componentKind, "section");
	assert.deepEqual(
		actual.facts
			.filter((fact) => fact.kind === "import")
			.map((fact) => [fact.localName, fact.specifier]),
		[
			["Card", "./card.nz.liquid"],
			["behavior", "./behavior.ts"],
		],
	);
	const render = actual.facts.find((fact) => fact.kind === "render");
	assert.equal(render.target, "Card");
	assert.equal(render.reachability, "conditional-unmodeled");
	assert.match(render.payload, /props\.title/);
	assert.deepEqual(
		actual.facts.filter((fact) => fact.kind === "blocks")[0].blockNames,
		["Card", "Banner"],
	);
	assert.equal(
		actual.facts.find((fact) => fact.kind === "script").language,
		"typescript",
	);
	assert.match(
		actual.facts.find((fact) => fact.kind === "script").body,
		/marker/,
	);
	assert.equal(
		actual.facts.find((fact) => fact.kind === "stylesheet").bindingName,
		"styles",
	);
	const elementRef = actual.facts.find((fact) => fact.kind === "element-ref");
	assert.deepEqual(
		{
			name: elementRef.name,
			tagName: elementRef.tagName,
			dataBindings: elementRef.dataBindings.map((binding) => [
				binding.attribute,
				binding.property,
				binding.expression,
			]),
		},
		{
			name: "root",
			tagName: "div",
			dataBindings: [["count", "count", "props.count"]],
		},
	);
	assert.equal(
		actual.facts.find((fact) => fact.kind === "root-marker").tagName,
		"div",
	);
	assert.deepEqual(
		actual.facts
			.filter((fact) => fact.kind === "island")
			.map((fact) => [fact.name, fact.tagName]),
		[["behavior", "section"]],
	);

	const projectReference = (fact) => [
		fact.target,
		fact.binding,
		fact.name,
		fact.form,
		fact.range.start,
		fact.range.end,
	];
	assert.deepEqual(
		actual.facts
			.filter((fact) => fact.kind === "reference")
			.map(projectReference),
		legacy.nodes
			.filter((node) => node.type === "NazareReference")
			.map((node) => [
				node.target,
				node.binding,
				node.name,
				node.form,
				offsetAt(source, node.span.start),
				offsetAt(source, node.span.end),
			]),
	);
});

test("invalid Nazare CST never produces authoritative facts", () => {
	const document = parseSourceDocument(
		registry,
		"x.nz.liquid",
		"nazare-liquid",
		"{% props { title: %}",
	);
	assert.ok(document.issues.length > 0);
	const facts = nazareSyntaxFacts(document);
	assert.equal(facts.authoritative, false);
	assert.deepEqual(facts.facts, []);
	assert.equal(facts.liquid.authoritative, false);
});
