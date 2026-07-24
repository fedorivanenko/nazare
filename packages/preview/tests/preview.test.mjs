import assert from "node:assert/strict";
import test from "node:test";
import {
	createPreviewEngine,
	galleryPage,
	generatedStories,
	previewComponentFromSource,
	renderComponentStories,
	renderPreview,
} from "../dist/index.js";

const BUTTON = `{% component snippet %}

{% props {
  label: string.required(),
  scheme: string.enum("solid", "outline", "ghost").default("solid"),
  size: string.enum("sm", "md").default("md"),
} %}

{% assign button_scheme = "solid" %}
{% if scheme == "outline" or scheme == "ghost" %}
  {% assign button_scheme = scheme %}
{% endif %}
<a class="btn btn--{{ button_scheme }}">{{ label }}</a>

{% stylesheet %}
.btn { display: inline-flex; }
{% endstylesheet %}
`;

const SECTION = `{% component section %}

{% props {
  heading: string.setting({ label: "Heading", default: "Sale" }),
  columns: number.min(1).max(4).step(1).setting({ label: "Columns", default: 2 }),
  featured: boolean.setting({ label: "Featured", default: false }),
} %}

<section data-columns="{{ columns }}"><h2>{{ heading }}</h2></section>
`;

test("controls come from the contract, not from hand-written argTypes", () => {
	const component = previewComponentFromSource(SECTION, "grid.nz.liquid");
	const byName = Object.fromEntries(
		component.controls.map((control) => [control.name, control]),
	);

	assert.equal(byName.heading.kind, "text");
	assert.equal(byName.heading.label, "Heading");
	assert.equal(byName.heading.value, "Sale");

	assert.equal(byName.columns.kind, "number");
	assert.deepEqual(byName.columns.range, { min: 1, max: 4, step: 1 });
	assert.equal(byName.columns.value, 2);

	assert.equal(byName.featured.kind, "boolean");
	assert.equal(byName.featured.value, false);
});

test("an enum prop becomes a select carrying its members", () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const scheme = component.controls.find(
		(control) => control.name === "scheme",
	);

	assert.equal(scheme.kind, "select");
	assert.deepEqual(scheme.options, ["solid", "outline", "ghost"]);
	assert.equal(scheme.value, "solid");
	// `.default()` fills the value, so the prop is not required of the viewer.
	assert.equal(scheme.required, false);
	assert.equal(
		component.controls.find((control) => control.name === "label").required,
		true,
	);
});

test("the previewed template is the emitted one, not the source", () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");

	assert.equal(component.frontend, "nazare");
	assert.equal(component.componentKind, "snippet");
	// props.x is lowered to a bare variable on emit; Nazare-only tags are gone.
	assert.ok(!component.template.includes("{% props"));
	assert.ok(component.template.includes("{{ label }}"));
	assert.ok(
		component.assets.some((asset) => asset.path.endsWith("button.css")),
		"the scoped stylesheet is emitted as an asset",
	);
});

test("generated stories cover the defaults plus every enum member", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const stories = generatedStories(component);

	assert.deepEqual(
		stories.map((story) => story.name),
		["default", "scheme: outline", "scheme: ghost", "size: sm"],
	);

	const rendered = await renderComponentStories(component, stories);
	const html = Object.fromEntries(
		rendered.stories.map((entry) => [entry.story.name, entry.html]),
	);
	assert.ok(html.default.includes('class="btn btn--solid"'));
	assert.ok(html["scheme: outline"].includes('class="btn btn--outline"'));
	assert.equal(rendered.stories[1].changed.join(","), "scheme");
});

test("plain Liquid previews with no controls to derive", async () => {
	const component = previewComponentFromSource(
		"{% doc %}\n  @param {string} label\n{% enddoc %}\n<a>{{ label }}</a>\n",
		"snippets/c-button.liquid",
	);

	assert.equal(component.frontend, "plain");
	assert.deepEqual(component.controls, []);

	const rendered = await renderComponentStories(component, [
		{ name: "default", props: { label: "Shop" } },
	]);
	// The Shopify-only {% doc %} block is dropped rather than rendered.
	assert.equal(rendered.stories[0].html, "<a>Shop</a>");
});

test("a composing component renders against the emitted snippets", async () => {
	const engine = createPreviewEngine({
		snippets: { button: '<a class="btn">{{ label }}</a>' },
	});

	assert.equal(
		await renderPreview(engine, "{% render 'button', label: 'Go' %}", {}),
		'<a class="btn">Go</a>',
	);
});

test("a story that fails to render is reported, not swallowed", async () => {
	const component = previewComponentFromSource(
		"{% render 'missing' %}",
		"snippets/composed.liquid",
	);
	const rendered = await renderComponentStories(component, [
		{ name: "default", props: {} },
	]);

	assert.match(rendered.stories[0].error, /missing/);
	assert.equal(rendered.stories[0].html, "");
});

test("the gallery page carries the stories, the controls, and the caveat", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid", {
		packageId: "@nazare/button",
	});
	const rendered = await renderComponentStories(component);
	const page = galleryPage([rendered], {
		title: "Buttons",
		stylesheets: ["./assets/button.css"],
	});

	assert.ok(page.includes("<title>Buttons</title>"));
	assert.ok(page.includes('href="./assets/button.css"'));
	assert.ok(page.includes("btn--ghost"));
	// Controls ship as JSON so an interactive panel can be layered on later.
	assert.ok(page.includes('class="controls-json"'));
	assert.ok(page.includes("workbench"), "the liquidjs caveat is on the page");
	// The install command is copyable, as on a shadcn registry page.
	assert.ok(page.includes("nazare add @nazare/button"));
	assert.ok(page.includes('data-copy="nazare add @nazare/button"'));
});

test("each component gets a props table and a code tab of the emitted Liquid", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const page = galleryPage([await renderComponentStories(component)]);

	// Tabs are radio inputs, so Preview/Code works without JavaScript.
	assert.ok(page.includes('name="tabs-button"'));
	assert.ok(page.includes("tab-panel--code"));
	// The Code tab shows the emitted template, escaped.
	assert.ok(page.includes("{{ label }}"));
	assert.ok(page.includes("<th>Default</th>"));
	// Both the enum members and the derived default reach the table.
	assert.ok(page.includes("&quot;solid&quot; | &quot;outline&quot;"));
	assert.ok(page.includes("badge--required"));
});
