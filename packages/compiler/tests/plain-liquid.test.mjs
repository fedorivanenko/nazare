import assert from "node:assert/strict";
import test from "node:test";
import {
	buildPlainLiquid,
	compileArtifact,
	compileNazareArtifact,
	compilePlainLiquid,
	parsePlainLiquid,
	plainLiquidFrontend,
} from "../dist/index.js";

test("plain Liquid frontend parses schema, settings reads, and static dependencies", () => {
	const source = `<section>
  {% render 'product-card', product: product %}
  {% section "announcement-bar" %}
  {{ section.settings.heading }}
</section>
{% schema %}
{"name":"Main","settings":[{"type":"text","id":"heading"}]}
{% endschema %}`;
	const result = compilePlainLiquid(source, "sections/main-product.liquid");

	assert.equal(result.canEmit, true);
	assert.deepEqual(
		result.dependencies.map((dependency) => ({
			kind: dependency.kind,
			name: dependency.name,
			path: dependency.path,
			static: dependency.static,
		})),
		[
			{
				kind: "snippet",
				name: "product-card",
				path: "snippets/product-card.liquid",
				static: true,
			},
			{
				kind: "section",
				name: "announcement-bar",
				path: "sections/announcement-bar.liquid",
				static: true,
			},
		],
	);
	assert.equal(result.ast.settingsReads[0].name, "heading");
	assert.deepEqual(result.issues, []);
});

test("plain Liquid frontend reports authored schema setting drift", () => {
	const source = `{{ section.settings.missing }}
{% schema %}
{"name":"Main","settings":[{"type":"text","id":"heading"}]}
{% endschema %}`;
	const result = compilePlainLiquid(source, "sections/main-product.liquid");

	assert.equal(result.canEmit, false);
	assert.equal(result.issues[0].code, "CONSTRAINT_UNKNOWN_SETTING_READ");
	assert.equal(result.issues[0].phase, "check");
});

test("plain Liquid frontend keeps dynamic dependencies indexed without paths", () => {
	const ast = parsePlainLiquid(
		"{% render snippet_name %}\n{% layout layout_name %}",
		"templates/page.liquid",
	);

	assert.deepEqual(
		ast.dependencies.map((dependency) => ({
			kind: dependency.kind,
			path: dependency.path,
			static: dependency.static,
		})),
		[
			{ kind: "snippet", path: undefined, static: false },
			{ kind: "layout", path: undefined, static: false },
		],
	);
});

test("plain Liquid build skips emit on errors unless explicitly allowed", () => {
	const source = `{{ section.settings.missing }}
{% schema %}
{"name":"Main","settings":[]}
{% endschema %}`;
	const skipped = buildPlainLiquid(source, "sections/main.liquid");
	assert.equal(skipped.canEmit, false);
	assert.equal(skipped.emittedOnError, false);
	assert.deepEqual(skipped.emitted.files, []);

	const preview = buildPlainLiquid(source, "sections/main.liquid", {
		emitOnError: true,
	});
	assert.equal(preview.canEmit, false);
	assert.equal(preview.emittedOnError, true);
	assert.deepEqual(preview.emitted.files, [
		{ path: "sections/main.liquid", contents: source },
	]);
});

test("plain Liquid frontend records failed parses without derived facts", () => {
	const result = compilePlainLiquid(
		"<div>{% if product %}<span>{{ section.settings.title }}</span>",
		"sections/broken.liquid",
	);

	assert.equal(result.canEmit, false);
	assert.equal(result.ast.factsCollected, false);
	assert.deepEqual(result.ast.dependencies, []);
	assert.deepEqual(result.ast.settingsReads, []);
	assert.ok(
		result.issues.some((issue) => issue.code === "PLAIN_LIQUID_FACTS_SKIPPED"),
	);
});

test("plain Liquid tolerant mode allows editor-style partial files", () => {
	const result = compilePlainLiquid(
		"<div>{% if product %}<span>{{ section.settings.title }}</span>",
		"sections/partial.liquid",
		{ parseMode: "tolerant" },
	);

	assert.equal(result.ast.parseMode, "tolerant");
	assert.equal(result.ast.factsCollected, true);
});

test("plain Liquid frontend covers all dependency tag kinds", () => {
	const source = [
		"{% render 'product-card' %}",
		"{% include 'legacy-card' %}",
		"{% section 'header' %}",
		"{% sections 'footer-group' %}",
		"{% layout 'theme' %}",
		"{% layout 'none' %}",
		"{% layout none %}",
	].join("\n");
	const result = compilePlainLiquid(source, "templates/product.liquid");

	assert.deepEqual(
		result.dependencies.map((dependency) => ({
			kind: dependency.kind,
			name: dependency.name,
			path: dependency.path,
		})),
		[
			{
				kind: "snippet",
				name: "product-card",
				path: "snippets/product-card.liquid",
			},
			{
				kind: "snippet",
				name: "legacy-card",
				path: "snippets/legacy-card.liquid",
			},
			{ kind: "section", name: "header", path: "sections/header.liquid" },
			{
				kind: "section-group",
				name: "footer-group",
				path: "sections/footer-group.json",
			},
			{ kind: "layout", name: "theme", path: "layout/theme.liquid" },
			{ kind: "layout", name: "none", path: undefined },
			{ kind: "layout", name: "none", path: undefined },
		],
	);
});

test("plain Liquid frontend diagnoses invalid static dependency names", () => {
	const result = compilePlainLiquid(
		"{% render '../secret' %}\n{% section 'hero.liquid' %}",
		"templates/product.liquid",
	);

	assert.equal(result.canEmit, false);
	assert.deepEqual(
		result.issues
			.filter((issue) => issue.code === "PLAIN_LIQUID_INVALID_DEPENDENCY_NAME")
			.map((issue) => issue.message),
		[
			'Invalid snippet dependency name "../secret": must not contain traversal or absolute paths',
			'Invalid section dependency name "hero.liquid": must omit theme file extensions',
		],
	);
	assert.deepEqual(
		result.dependencies.map((dependency) => dependency.path),
		[undefined, undefined],
	);
});

test("plain Liquid settings scanner ignores string literals, non-expression text, comments, schema, and raw blocks", () => {
	const source = `<p>section.settings.fake_html</p>
{% comment %}{{ section.settings.fake_comment }}{% endcomment %}
{% raw %}{{ section.settings.fake_raw }}{% endraw %}
{{ "section.settings.fake_string" }}
{% assign x = "block.settings.fake_assign" %}
{{ section.settings.title }}
{% schema %}
{"name":"Main","settings":[{"type":"text","id":"title"}],"info":"section.settings.fake_schema"}
{% endschema %}`;
	const result = compilePlainLiquid(source, "sections/main.liquid");

	assert.equal(result.canEmit, true);
	assert.deepEqual(
		result.ast.settingsReads.map((read) => read.name),
		["title"],
	);
});

test("compileArtifact selects the built-in plain Liquid frontend", () => {
	const compiled = compileArtifact({
		source: "<div>{{ product.title }}</div>",
		file: "snippets/product-title.liquid",
	});

	assert.equal(compiled.ok, true);
	assert.equal(compiled.frontend, "plain-liquid");
	assert.equal(compiled.contractProvenance, "none");
	assert.equal(compiled.frontendSupport.explicitSchemaSyntax, true);
});

test("plainLiquidFrontend does not accept Nazare Liquid files", () => {
	assert.equal(
		plainLiquidFrontend.accepts("components/card.nz.liquid", ""),
		false,
	);
	assert.equal(plainLiquidFrontend.accepts("snippets/card.liquid", ""), true);
});

test("plain Liquid frontend validates frontend options", () => {
	const compiled = compileArtifact({
		source: "<div></div>",
		file: "snippets/card.liquid",
		frontendOptions: { parseMode: "loose" },
	});

	assert.equal(compiled.ok, true);
	assert.equal(compiled.canEmit, false);
	assert.ok(
		compiled.issues.some(
			(issue) => issue.code === "PLAIN_LIQUID_INVALID_FRONTEND_OPTION",
		),
	);
});

test("Nazare Liquid parser ignores settings-looking string literals", () => {
	const source = `{{ "section.settings.fake_string" }}
{{ section.settings.title }}
{% schema %}
{"name":"Main","settings":[{"type":"text","id":"title"}]}
{% endschema %}`;
	const result = compileNazareArtifact(source, "sections/main.nz.liquid");

	assert.equal(result.canEmit, true);
	assert.deepEqual(
		result.ast.settingsReads.map((read) => read.name),
		["title"],
	);
});

test("plain Liquid settings scanner handles range endpoints", () => {
	const source = `{% for i in (section.settings.start..section.settings.end) %}{{ i }}{% endfor %}
{% schema %}
{"name":"Range","settings":[{"type":"number","id":"start"},{"type":"number","id":"end"}]}
{% endschema %}`;
	const result = compilePlainLiquid(source, "sections/range.liquid");

	assert.equal(result.canEmit, true);
	assert.deepEqual(
		result.ast.settingsReads.map((read) => read.name),
		["start", "end"],
	);
	assert.ok(
		!result.issues.some(
			(issue) => issue.code === "LIQUID_UNSCANNED_SETTINGS_EXPRESSION",
		),
	);
});
