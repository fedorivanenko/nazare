import assert from "node:assert/strict";
import test from "node:test";
import {
	createPreviewEngine,
	galleryPage,
	generatedStories,
	previewComponentFromSource,
	renderComponentStories,
	renderPreview,
	resolveFixtures,
	snippetLibrary,
	storiesFor,
	storyDocument,
	storyDocuments,
	storyId,
	workbenchPage,
} from "../dist/index.js";

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

test("a section's props render as section.settings, not as bare variables", async () => {
	const component = previewComponentFromSource(SECTION, "grid.nz.liquid");
	const rendered = await renderComponentStories(component);

	// Emit lowers a section's props to section.settings.*, so props handed to a
	// story have to arrive shaped that way or every setting reads blank.
	assert.ok(component.template.includes("section.settings.heading"));
	assert.ok(rendered.stories[0].html.includes('data-columns="2"'));
	assert.ok(rendered.stories[0].html.includes("<h2>Sale</h2>"));
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

test("manifest stories replace the derived set and resolve fixtures", async () => {
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
	const stories = storiesFor(component, manifest);

	assert.deepEqual(
		stories.map((story) => story.name),
		["on sale"],
	);
	// The reference resolved to shared stand-in data, and the story says so.
	assert.equal(stories[0].props.price, 2400);
	assert.equal(stories[0].fixtures, true);

	const rendered = await renderComponentStories(component, stories);
	// Money is minor units, formatted by the preview's `money` filter.
	assert.ok(rendered.stories[0].html.includes("$24.00"));
	assert.ok(rendered.stories[0].html.includes("<s"));
	assert.ok(rendered.stories[0].html.includes("$40.00"));
});

test("a component with no authored stories still previews", () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const manifest = {
		id: "@nazare/button",
		version: "0.1.0",
		entry: "button.nz.liquid",
		files: ["button.nz.liquid"],
	};

	assert.deepEqual(
		storiesFor(component, manifest).map((story) => story.name),
		generatedStories(component).map((story) => story.name),
	);
});

test("an unknown fixture name is left visible, not silently nil", () => {
	assert.deepEqual(resolveFixtures({ a: { $fixture: "nope" }, b: 1 }), {
		a: { $fixture: "nope" },
		b: 1,
	});
});

test("a story id is derived from the names, so it survives reordering", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(component);

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
	const rendered = await renderComponentStories(component);
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
	const files = storyDocuments([await renderComponentStories(component)]);

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
	const rendered = await renderComponentStories(component);
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
	const page = workbenchPage([await renderComponentStories(component)]);

	// One canvas, not one frame per story: the sidebar chooses what it shows.
	assert.equal(page.match(/<iframe/g).length, 1);
	assert.equal(page.match(/data-story="/g).length, 4);
	// The sidebar entries are real links to the story documents, so the shell
	// degrades to "open the story on its own" with no JavaScript.
	assert.ok(page.includes('href="./stories/button--scheme-outline.html"'));
	// The component's documentation travels with it, shown for the selected one.
	assert.ok(page.includes('data-panel="button"'));
	assert.ok(page.includes("nazare add @nazare/button"));
	assert.ok(page.includes("<th>Default</th>"));
	assert.ok(page.includes("{{ label }}"));
});

test("without storyBase the page is still self-contained", async () => {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const page = galleryPage([await renderComponentStories(component)]);

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

	const withLibrary = await renderComponentStories(bar, undefined, {
		snippets,
	});
	assert.equal(withLibrary.stories[0].error, undefined);
	assert.ok(withLibrary.stories[0].html.includes('<a href="/x">'));

	// Without it the render tag resolves nothing, and the story says so.
	const withoutLibrary = await renderComponentStories(bar);
	assert.match(withoutLibrary.stories[0].error, /link/);
});
