import assert from "node:assert/strict";
import test from "node:test";
import {
	createPreviewEngine,
	galleryPage,
	parseStoryFile,
	previewComponentFromSource,
	renderCall,
	renderComponentStories,
	renderPreview,
	resolveFixtures,
	scaffoldStories,
	snippetLibrary,
	storiesFor,
	storyDocument,
	storyDocuments,
	storyId,
	workbenchPage,
} from "../dist/index.js";

/** The one story every component has when the test only needs a render. */
const DEFAULT_ONLY = [{ name: "default", props: {} }];

const PRICE = `{% props {
  price: Money.required(),
  compare_at_price: Money.optional(),
  show_compare_at: boolean.default(true),
} %}

<span class="price">
  <span class="price__current">{{ props.price | money }}</span>
  {% if props.show_compare_at and props.compare_at_price and props.compare_at_price > props.price %}
    <s class="price__compare">{{ props.compare_at_price | money }}</s>
  {% endif %}
</span>
`;

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

<section data-columns="{{ props.columns }}"><h2>{{ props.heading }}</h2></section>
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

test("a scaffolded draft covers the defaults plus every enum member", async () => {
	// What `scaffold` writes to a story file for an author to edit — never what
	// the preview renders on its own.
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const stories = scaffoldStories(component);

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

test("a section's props render as section.settings, not as bare variables", async () => {
	const component = previewComponentFromSource(SECTION, "grid.nz.liquid");
	const rendered = await renderComponentStories(component, DEFAULT_ONLY);

	// Emit lowers a section's props to section.settings.*, so props handed to a
	// story have to arrive shaped that way or every setting reads blank.
	assert.ok(component.template.includes("section.settings.heading"));
	assert.ok(rendered.stories[0].html.includes('data-columns="2"'));
	assert.ok(rendered.stories[0].html.includes("<h2>Sale</h2>"));
});

test("plain Liquid takes its controls from {% doc %} @param lines", async () => {
	const component = previewComponentFromSource(
		`{% doc %}
  @param {string} label - Button text
  @param {string} [url] - Destination
  @param {boolean} [wide] - Full width
  @param {product} [product] - The product shown
{% enddoc %}
<a href="{{ url }}">{{ label }}</a>
`,
		"snippets/c-button.liquid",
	);
	const byName = Object.fromEntries(
		component.controls.map((control) => [control.name, control]),
	);

	assert.equal(component.frontend, "plain");
	// The directory says what a theme file is, and the kind decides the scope.
	assert.equal(component.componentKind, "snippet");
	// The bracket convention is the author's own statement of what is optional.
	assert.equal(byName.label.required, true);
	assert.equal(byName.url.required, false);
	assert.equal(byName.wide.kind, "boolean");
	assert.equal(byName.wide.value, false);
	// A storefront object names a fixture the preview already owns, rather than
	// opening the story on the string "product".
	assert.equal(byName.product.value.title, "Merino Crew Sweater");

	// The value a control opens on is a placeholder this pass invented — the
	// prop's own name — because `{% doc %}` has no syntax for a default.
	assert.equal(byName.label.value, "label");
	assert.equal(byName.label.hasDefault, false);

	// So it is never merged into a render. A story that states nothing has
	// nothing to render, exactly as the snippet would on a storefront; a story
	// renders what it states, and no placeholder rides along.
	const rendered = await renderComponentStories(component, [
		{ name: "empty", props: {} },
		{ name: "stated", props: { label: "Shop all", url: "/collections/all" } },
	]);
	assert.equal(rendered.stories[0].html, '<a href=""></a>');
	assert.equal(
		rendered.stories[1].html,
		'<a href="/collections/all">Shop all</a>',
	);
});

test("a plain section takes its controls from {% schema %} settings", async () => {
	const component = previewComponentFromSource(
		`<section data-columns="{{ section.settings.columns }}">
  <h2>{{ section.settings.heading }}</h2>
  {% if section.settings.featured %}<b>{{ section.settings.scheme }}</b>{% endif %}
</section>
{% schema %}
{
  "name": "Grid",
  "settings": [
    { "type": "header", "content": "Layout" },
    { "type": "text", "id": "heading", "label": "Heading", "default": "Sale" },
    { "type": "range", "id": "columns", "label": "Columns", "min": 1, "max": 4, "step": 1, "default": 2 },
    { "type": "checkbox", "id": "featured", "label": "Featured", "default": true },
    { "type": "select", "id": "scheme", "label": "Scheme", "default": "solid",
      "options": [{ "value": "solid", "label": "Solid" }, { "value": "ghost", "label": "Ghost" }] }
  ]
}
{% endschema %}
`,
		"sections/grid.liquid",
	);
	const byName = Object.fromEntries(
		component.controls.map((control) => [control.name, control]),
	);

	assert.equal(component.componentKind, "section");
	// header is chrome for the theme editor, not an input.
	assert.ok(!("content" in byName));
	assert.equal(byName.heading.label, "Heading");
	assert.equal(byName.heading.value, "Sale");
	assert.deepEqual(byName.columns.range, { min: 1, max: 4, step: 1 });
	assert.equal(byName.featured.value, true);
	assert.deepEqual(byName.scheme.options, ["solid", "ghost"]);

	// A section's props arrive as section.settings, so a story states its delta
	// in setting names and the schema's defaults supply the rest.
	const rendered = await renderComponentStories(component, [
		{ name: "default", props: {} },
		{ name: "ghost", props: { scheme: "ghost" } },
	]);
	assert.ok(rendered.stories[0].html.includes('data-columns="2"'));
	assert.ok(rendered.stories[0].html.includes("<h2>Sale</h2>"));
	assert.ok(rendered.stories[1].html.includes("<b>ghost</b>"));
	// The delta was one setting; the heading still came from the schema.
	assert.ok(rendered.stories[1].html.includes("<h2>Sale</h2>"));
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
	const rendered = await renderComponentStories(
		component,
		scaffoldStories(component),
	);
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
	const page = galleryPage([
		await renderComponentStories(component, DEFAULT_ONLY),
	]);

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

test("the stories are the ones declared, in the order declared", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const manifest = {
		id: "@nazare/button",
		version: "0.1.0",
		entry: "button.nz.liquid",
		files: ["button.nz.liquid"],
		preview: {
			stories: [
				{ name: "shop all", props: { label: "Shop all" } },
				{ name: "empty label", props: { label: "" } },
			],
		},
	};

	// No enum fan-out, no invented "default": what the author wrote is the set.
	assert.deepEqual(
		storiesFor({ manifest }).map((story) => story.name),
		["shop all", "empty label"],
	);
	const rendered = await renderComponentStories(
		component,
		storiesFor({ manifest }),
	);
	assert.ok(rendered.stories[0].html.includes(">Shop all<"));
});

test("a story states its delta; the declaration supplies the rest", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(component, [
		{ name: "outline", props: { label: "Shop all", scheme: "outline" } },
	]);

	// `size` was never stated, so it renders at the default the type declares —
	// which matters beyond convenience: emit does not materialize a snippet
	// prop's default, so an unmerged omission would arrive nil.
	assert.ok(rendered.stories[0].html.includes("btn--outline"));
	assert.ok(rendered.stories[0].html.includes(">Shop all<"));
	assert.deepEqual(rendered.stories[0].changed, ["label", "scheme"]);
});

test("a placeholder is never merged into a render", async () => {
	// The control for an optional prop with no declared default still carries a
	// type-shaped value, so a panel has something to open on. Rendering with it
	// puts the prop's own name into the markup — `class="… class"` and a bare
	// `attributes` on every button, from props no story mentioned.
	const component = previewComponentFromSource(
		`{% component snippet %}

{% props {
  label: string.required(),
  scheme: string.enum("solid", "outline").default("solid"),
  class: string.optional(),
  attributes: string.optional(),
} %}

<a class="btn btn--{{ scheme }} {{ class }}" {{ attributes }}>{{ label }}</a>
`,
		"button.nz.liquid",
	);
	const rendered = await renderComponentStories(component, [
		{ name: "solid", props: { label: "Add to cart" } },
	]);

	// `scheme` is declared with a default and merges; `class` and `attributes`
	// are declared without one and arrive nil, as they would on a storefront.
	assert.ok(rendered.stories[0].html.includes("btn--solid"));
	assert.ok(!rendered.stories[0].html.includes("class</a>"));
	assert.ok(!/\battributes\b/.test(rendered.stories[0].html));
	assert.ok(!/btn--solid class/.test(rendered.stories[0].html));
});

test("an explicit null unsets a prop the declaration gives a default", async () => {
	const component = previewComponentFromSource(
		`{% doc %}
  @param {string} label - Button text
  @param {string} [badge] - Ribbon, when there is one
{% enddoc %}
<a>{{ label }}{% if badge != blank %}<b>{{ badge }}</b>{% endif %}</a>
`,
		"snippets/badged.liquid",
	);
	const rendered = await renderComponentStories(component, [
		{ name: "with badge", props: { label: "Shop", badge: "Sale" } },
		{ name: "no badge", props: { label: "Shop", badge: null } },
	]);

	assert.ok(rendered.stories[0].html.includes("<b>Sale</b>"));
	// Absent, not the string "null" and not the declared default.
	assert.ok(!rendered.stories[1].html.includes("<b>"));
	assert.deepEqual(rendered.stories[1].issues, []);
});

test("a story file declares cases and nothing else", () => {
	const parsed = parseStoryFile({
		stories: [
			{ name: "default" },
			{ name: "dark", props: { scheme: "dark" }, note: "why" },
		],
	});
	assert.deepEqual(
		parsed.stories.map((story) => story.name),
		["default", "dark"],
	);

	// Interface belongs to the Liquid, so a story file that tries to declare one
	// stops rather than being quietly ignored.
	assert.throws(
		() =>
			parseStoryFile({
				stories: [
					{ name: "dark", argTypes: { scheme: { control: "select" } } },
				],
			}),
		/unknown key "argTypes"/,
	);
	// A typo that would otherwise render a story setting nothing.
	assert.throws(
		() => parseStoryFile({ stories: [{ name: "dark", prop: { a: 1 } }] }),
		/unknown key "prop"/,
	);
	// Names are the story's identity, so two cannot claim the same document.
	assert.throws(
		() => parseStoryFile({ stories: [{ name: "a" }, { name: "a" }] }),
		/duplicate story name/,
	);
	assert.throws(() => parseStoryFile({ stories: {} }), /must be an array/);
	assert.throws(() => parseStoryFile({ cases: [] }), /unknown key "cases"/);
});

test("a story is checked against the interface the component declares", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(component, [
		{
			name: "typo",
			props: {
				lable: "Shop",
				scheme: "outlined",
				size: 4,
				extra: { $fixture: "nope" },
			},
		},
	]);
	const messages = rendered.stories[0].issues.map((issue) => issue.message);

	// A prop the template never reads is nil on render and looks like nothing.
	assert.ok(
		messages.some((message) =>
			message.startsWith("lable is not a declared prop"),
		),
	);
	// A value outside the enum renders, and renders wrong.
	assert.ok(
		messages.some((message) => message.includes('scheme is "outlined"')),
	);
	// A required prop nobody passed.
	assert.ok(
		messages.some((message) => message.startsWith("label is required")),
	);
	// A fixture name the preview does not have, left visible by resolveFixtures.
	assert.equal(
		rendered.stories[0].issues.find((issue) => issue.prop === "extra")
			?.severity,
		"error",
	);
	// The story owns only values, so every one of these is the story contra-
	// dicting the declaration — an error, not a matter of taste.
	assert.ok(
		rendered.stories[0].issues.every((issue) => issue.severity === "error"),
	);
	// The story still rendered: seeing the output is how you judge the damage.
	assert.equal(rendered.stories[0].error, undefined);
	assert.ok(rendered.stories[0].html.includes("btn--solid"));
});

test("a component that declares nothing is not second-guessed", async () => {
	// Plain Liquid with no {% doc %} block states no interface, so a story for
	// it cannot be wrong — inventing one from the template's body would be.
	const component = previewComponentFromSource(
		"<a>{{ label }}</a>",
		"snippets/bare.liquid",
	);
	const rendered = await renderComponentStories(component, [
		{ name: "default", props: { label: "Shop", anything: true } },
	]);

	assert.deepEqual(rendered.stories[0].issues, []);
});

test("a sidecar declaration outranks the manifest", () => {
	const manifest = {
		id: "@nazare/button",
		version: "0.1.0",
		entry: "button.nz.liquid",
		files: ["button.nz.liquid"],
		preview: { stories: [{ name: "from manifest", props: {} }] },
	};
	// A theme has no manifest at all, so the file beside the template is the
	// only place its stories can live — and the more local statement wins.
	const names = storiesFor({
		manifest,
		sidecar: { stories: [{ name: "from sidecar", props: { label: "Local" } }] },
	}).map((story) => story.name);

	assert.ok(names.includes("from sidecar"));
	assert.ok(!names.includes("from manifest"));
});

test("Shopify's form tag renders its body instead of failing the story", async () => {
	const component = previewComponentFromSource(
		`{% form 'localization' %}<button>{{ shop.name }}</button>{% endform %}`,
		"snippets/localization-form.liquid",
	);
	const rendered = await renderComponentStories(component, [
		{ name: "default", props: { shop: { name: "Nazare Supply" } } },
	]);

	assert.equal(rendered.stories[0].error, undefined);
	assert.ok(
		rendered.stories[0].html.includes('data-preview-form="localization"'),
	);
	assert.ok(
		rendered.stories[0].html.includes("<button>Nazare Supply</button>"),
	);
});

test("manifest stories resolve fixtures", async () => {
	const component = previewComponentFromSource(PRICE, "price.nz.liquid");
	const manifest = {
		id: "@nazare/price",
		version: "0.1.0",
		entry: "price.nz.liquid",
		files: ["price.nz.liquid"],
		preview: {
			stories: [
				{
					name: "on sale",
					props: {
						price: { $fixture: "price" },
						compare_at_price: { $fixture: "compare_at_price" },
						show_compare_at: true,
					},
				},
			],
		},
	};
	const stories = storiesFor({ manifest });
	const onSale = stories.find((story) => story.name === "on sale");

	assert.deepEqual(
		stories.map((story) => story.name),
		["on sale"],
	);
	// The reference resolved to shared stand-in data, and the story says so.
	assert.equal(onSale.props.price, 2400);
	assert.equal(onSale.fixtures, true);

	const rendered = await renderComponentStories(component, [onSale]);
	// Money is minor units, formatted by the preview's `money` filter.
	assert.ok(rendered.stories[0].html.includes("$24.00"));
	assert.ok(rendered.stories[0].html.includes("<s"));
	assert.ok(rendered.stories[0].html.includes("$40.00"));
});

test("a component with no authored stories does not appear", () => {
	// Writing a story is what publishes a component to the workbench. Without
	// one there is nothing to show, and the preview does not invent a case to
	// fill the gap — that is how a theme's hundred helper snippets stay out of
	// the sidebar.
	const manifest = {
		id: "@nazare/button",
		version: "0.1.0",
		entry: "button.nz.liquid",
		files: ["button.nz.liquid"],
	};

	assert.deepEqual(storiesFor({ manifest }), []);
	assert.deepEqual(storiesFor({}), []);
});

test("an unknown fixture name is left visible, not silently nil", () => {
	assert.deepEqual(resolveFixtures({ a: { $fixture: "nope" }, b: 1 }), {
		a: { $fixture: "nope" },
		b: 1,
	});
});

test("a story id is derived from the names, so it survives reordering", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(
		component,
		scaffoldStories(component),
	);

	assert.equal(storyId("button", "scheme: outline"), "button--scheme-outline");
	assert.deepEqual(
		rendered.stories.map((entry) => entry.id),
		[
			"button--default",
			"button--scheme-outline",
			"button--scheme-ghost",
			"button--size-sm",
		],
	);
});

test("a story document stands alone: its own page, its own assets", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(
		component,
		scaffoldStories(component),
	);
	const document = storyDocument(component, rendered.stories[1]);

	assert.ok(document.startsWith("<!doctype html>"));
	// The component's own emitted stylesheet, linked by the emitted template.
	assert.ok(document.includes('href="./assets/button.css"'));
	assert.ok(document.includes('class="btn btn--outline"'));
	// Story documents live one level down, so the URLs the shell writes and the
	// ones the emitted template asks for resolve from the base, not the folder.
	assert.ok(document.includes('<base href="../">'));
	// Its own stylesheet and no one else's, and not linked twice: a story that
	// carried the registry's CSS would share a cascade again, framed or not.
	assert.equal(document.match(/<link rel="stylesheet"/g).length, 1);
	// It knows which story it is, so it can report its height to a host page.
	assert.ok(document.includes('data-story-id="button--scheme-outline"'));
	// Only this story is in the document — that is the whole point of isolating.
	assert.ok(!document.includes("btn--ghost"));
});

test("a failing story documents the failure rather than rendering blank", async () => {
	const component = previewComponentFromSource(
		"{% render 'missing' %}",
		"snippets/composed.liquid",
	);
	const rendered = await renderComponentStories(component, [
		{ name: "default", props: {} },
	]);

	assert.match(
		storyDocument(component, rendered.stories[0]),
		/render failed: [^<]*missing/,
	);
});

test("every story gets a document named by its id", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const files = storyDocuments([
		await renderComponentStories(component, scaffoldStories(component)),
	]);

	assert.deepEqual(
		files.map((file) => file.path),
		[
			"button--default.html",
			"button--scheme-outline.html",
			"button--scheme-ghost.html",
			"button--size-sm.html",
		],
	);
});

test("storyBase frames the stories instead of inlining them", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(
		component,
		scaffoldStories(component),
	);
	const page = galleryPage([rendered], { storyBase: "./stories/" });

	assert.ok(page.includes('src="./stories/button--scheme-outline.html"'));
	assert.ok(page.includes('data-story-frame="button--scheme-outline"'));
	// Framed, the component's markup is in its own documents, not in the shell.
	assert.ok(!page.includes('class="btn btn--outline"'));
	// A framed story is openable on its own, the way a Storybook story is.
	assert.ok(page.includes('class="story-open"'));
});

test("the workbench lists every story and shows one at a time", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid", {
		packageId: "@nazare/button",
	});
	const page = workbenchPage([
		await renderComponentStories(component, scaffoldStories(component)),
	]);

	// One canvas, not one frame per story: the selection chooses what it shows.
	assert.equal(page.match(/<iframe/g).length, 1);
	// The sidebar carries one entry per component, opening on its first story;
	// the component's stories are a dropdown beside the canvas.
	assert.equal(page.match(/class="nav-component"/g).length, 1);
	assert.ok(page.includes('data-substories="button"'));
	assert.equal(page.match(/<option value="button--/g).length, 4);
	// Stories that vary one prop are grouped under it, so the menu reads as the
	// prop's values rather than as a flat list of "prop: value" strings.
	assert.ok(page.includes('<optgroup label="scheme">'));
	// Viewport presets, and the story index the canvas selects from.
	assert.ok(page.includes('id="viewport"'));
	assert.ok(page.includes('<option value="375">'));
	assert.ok(page.includes('id="story-index"'));
	// The sidebar entries are real links to the story documents, so the shell
	// degrades to "open the component on its own" with no JavaScript.
	assert.ok(page.includes('href="./stories/button--default.html"'));
	// Every story's document is addressable from the index the canvas reads.
	assert.ok(page.includes("./stories/button--scheme-outline.html"));
	// The component's documentation travels with it, shown for the selected one.
	assert.ok(page.includes('data-panel="button"'));
	assert.ok(page.includes("nazare add @nazare/button"));
	assert.ok(page.includes("<th>Default</th>"));
	assert.ok(page.includes("{{ label }}"));
});

test("a story carries the call that reproduces it in a theme", async () => {
	const button = previewComponentFromSource(BUTTON, "button.nz.liquid");

	// A snippet is reached by {% render %}, and the story's delta is exactly what
	// a caller has to write — anything omitted is already the default.
	assert.deepEqual(
		renderCall(button, {
			name: "outline",
			props: { label: "Add to cart", scheme: "outline" },
		}),
		{
			label: "Render this story",
			language: "liquid",
			code: "{% render 'button', label: 'Add to cart', scheme: 'outline' %}",
		},
	);

	// A null is the story declining to pass a prop, so the call leaves it out.
	assert.equal(
		renderCall(button, { name: "bare", props: { label: "Go", scheme: null } })
			.code,
		"{% render 'button', label: 'Go' %}",
	);

	// A section is placed, not called: what you paste is a template's JSON.
	const section = previewComponentFromSource(SECTION, "grid.nz.liquid");
	const placed = renderCall(section, {
		name: "three up",
		props: { columns: 3 },
	});
	assert.equal(placed.language, "json");
	assert.deepEqual(JSON.parse(placed.code), {
		type: "grid",
		settings: { columns: 3 },
	});

	// A file the preview could not classify gets no snippet: a wrong call in a
	// copy button is worse than no call.
	const bare = previewComponentFromSource("<a>{{ label }}</a>", "bare.liquid");
	assert.equal(renderCall(bare, { name: "default", props: {} }), undefined);
});

test("the workbench carries the toolbar, the call, and per-story status", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(component, [
		{ name: "solid", props: { label: "Add to cart" } },
		// Contradicts the declaration, so this component has one problem story.
		{ name: "typo", props: { lable: "Add to cart" } },
	]);
	const page = workbenchPage([rendered]);

	// Ground, zoom, and outline: how the story is shown, alongside the viewport.
	assert.ok(page.includes('id="background"'));
	assert.ok(page.includes('id="zoom"'));
	assert.ok(page.includes('id="outline"'));
	assert.ok(page.includes(">Transparent</option>"));

	// The call rides in the index, per story rather than per component.
	const index = JSON.parse(
		page.match(/id="story-index">([\s\S]*?)<\/script>/)[1],
	);
	assert.equal(
		index["button--solid"].call.code,
		"{% render 'button', label: 'Add to cart' %}",
	);

	// One of the two stories has a problem, and the count is what the sidebar
	// shows and what the filter reads.
	assert.ok(page.includes('data-problems="1"'));
	assert.ok(page.includes('id="problems-only"'));
	// A story's own state belongs on the story, in the menu where you pick it.
	// Two, because a misspelled prop also leaves the real one unpassed.
	assert.ok(page.includes("typo — 2 issues"));
});

test("without storyBase the page is still self-contained", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const page = galleryPage([
		await renderComponentStories(component, scaffoldStories(component)),
	]);

	assert.ok(page.includes('class="btn btn--outline"'));
	assert.ok(!page.includes("<iframe"));
});

test("a composing component needs the snippet library in scope", async () => {
	const link = previewComponentFromSource(
		'{% props { href: url.required(), text: string.required() } %}\n<a href="{{ props.href }}">{{ props.text }}</a>\n',
		"link.nz.liquid",
	);
	const bar = previewComponentFromSource(
		'{% component section %}\n{% import Link from "./link.nz.liquid" %}\n{% props { text: string.setting({ label: "Text", default: "Free shipping" }) } %}\n<section>{% render Link { href: "/x", text: props.text } %}</section>\n',
		"bar.nz.liquid",
		{
			readFile: (path) =>
				path === "link.nz.liquid" ? link.file && link.template : undefined,
		},
	);

	// Sections cannot be rendered by {% render %}, so they stay out of the library.
	const snippets = snippetLibrary([link, bar]);
	assert.deepEqual(Object.keys(snippets), ["link"]);

	const withLibrary = await renderComponentStories(bar, DEFAULT_ONLY, {
		snippets,
	});
	assert.equal(withLibrary.stories[0].error, undefined);
	assert.ok(withLibrary.stories[0].html.includes('<a href="/x">'));

	// Without it the render tag resolves nothing, and the story says so.
	const withoutLibrary = await renderComponentStories(bar, DEFAULT_ONLY);
	assert.match(withoutLibrary.stories[0].error, /link/);
});
