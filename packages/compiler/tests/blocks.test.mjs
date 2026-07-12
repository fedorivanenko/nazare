import assert from "node:assert/strict";
import { test } from "node:test";
import {
	compileNazareArtifact,
	emitTheme,
	themeSchemaFromIR,
} from "../dist/index.js";

const noticeSource = `{% props {
  message: string.setting({ label: "Message", default: "Heads up!" }),
} %}
<div class="notice">{{ props.message }}</div>`;

function codes(result) {
	return result.issues.map((issue) => issue.code);
}

test("blocks: block components emit to blocks/ with schema, preset, and shopify_attributes", () => {
	const compiled = compileNazareArtifact(noticeSource, "notice.nz.liquid", {
		kind: "block",
	});
	const emitted = emitTheme(noticeSource, compiled, {
		name: "notice",
		kind: "block",
	});
	const liquid = emitted.files.find(
		(file) => file.path === "blocks/notice.liquid",
	)?.contents;

	assert.ok(liquid);
	assert.ok(liquid.includes("{{ block.shopify_attributes }}"));
	assert.ok(liquid.includes("{{ block.settings.message }}"));
	assert.ok(liquid.includes('"presets"'));
	assert.ok(liquid.includes('"name": "Notice"'));
	assert.ok(liquid.includes('"id": "message"'));
});

test("blocks: block props lower to block.settings, not section.settings", () => {
	const compiled = compileNazareArtifact(noticeSource, "notice.nz.liquid", {
		kind: "block",
	});
	const liquid = emitTheme(noticeSource, compiled, {
		name: "notice",
		kind: "block",
	}).files[0].contents;
	assert.ok(!liquid.includes("section.settings"));
});

test("blocks: block kind requires setting props", () => {
	const result = compileNazareArtifact(
		`{% props { text: string.required() } %}\n<div>{{ props.text }}</div>`,
		"c.nz.liquid",
		{ kind: "block" },
	);
	const issue = result.issues.find(
		(candidate) => candidate.code === "CONSTRAINT_SECTION_PROP_NOT_SETTING",
	);
	assert.ok(issue?.message.startsWith("Block components"));
});

test("blocks: section slot lowers to content_for and the schema blocks array", () => {
	const source = `{% props { heading: string.setting({ label: "H" }) } %}
<section><h2>{{ props.heading }}</h2>
{% blocks "notice", "quote" %}
</section>`;
	const compiled = compileNazareArtifact(source, "board.nz.liquid", {
		kind: "section",
	});
	assert.deepEqual(
		codes(compiled).filter((code) => code.startsWith("CONSTRAINT")),
		[],
	);

	const liquid = emitTheme(source, compiled, {
		name: "board",
		kind: "section",
	}).files[0].contents;
	assert.ok(liquid.includes("{% content_for 'blocks' %}"));
	assert.ok(!liquid.includes("{% blocks"));

	const schema = themeSchemaFromIR(compiled.ir, {
		name: "board",
		kind: "section",
	});
	assert.deepEqual(schema.blocks, [{ type: "notice" }, { type: "quote" }]);
});

test("blocks: bare slot accepts any theme block", () => {
	const source = `<section>{% blocks %}</section>`;
	const compiled = compileNazareArtifact(source, "board.nz.liquid", {
		kind: "section",
	});
	const schema = themeSchemaFromIR(compiled.ir, {
		name: "board",
		kind: "section",
	});
	assert.deepEqual(schema.blocks, [{ type: "@theme" }]);
});

test("blocks: slot outside a section is an error", () => {
	const result = compileNazareArtifact(
		`<div>{% blocks %}</div>`,
		"c.nz.liquid",
		{ kind: "block" },
	);
	assert.ok(codes(result).includes("CONSTRAINT_BLOCKS_SLOT_OUTSIDE_SECTION"));
});

test("blocks: more than one slot is an error", () => {
	const result = compileNazareArtifact(
		`<section>{% blocks %}{% blocks %}</section>`,
		"board.nz.liquid",
		{ kind: "section" },
	);
	assert.ok(codes(result).includes("CONSTRAINT_MULTIPLE_BLOCKS_SLOTS"));
});

test("blocks: malformed slot markup is a parse error", () => {
	const result = compileNazareArtifact(
		`<section>{% blocks notice %}</section>`,
		"board.nz.liquid",
	);
	assert.ok(codes(result).includes("NAZARE_PARSE_BLOCKS_SLOT"));
});
