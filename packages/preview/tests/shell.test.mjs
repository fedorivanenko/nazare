// The workbench shell, executed rather than read.
//
// Every other test here asserts strings in generated HTML, which cannot tell
// the difference between a page that works and a page whose script throws on
// line one. That gap is where the shell's bugs have actually lived: a toggle
// nobody could press, a canvas pushed off-screen by a stacking rule, a
// preference read from storage that throws. So this runs the real script
// against the real markup in a DOM and asks what a person would ask — does the
// button do the thing, and is the story still on screen.
import assert from "node:assert/strict";
import test from "node:test";
import { parseHTML } from "linkedom";
import {
	previewComponentFromSource,
	renderComponentStories,
	workbenchPage,
} from "../dist/index.js";

const BUTTON = `{% component snippet %}

{% props {
  label: string.required(),
  scheme: string.enum("solid", "outline").default("solid"),
} %}

<a class="btn btn--{{ scheme }}">{{ label }}</a>
`;

/** The shell, loaded and running, with the globals its script reaches for. */
async function mountShell({
	width = 1400,
	storage = new Map(),
	stageWidth = 0,
	fetch = async () => ({ ok: true, text: async () => "saved" }),
	stories,
	storyFiles,
} = {}) {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(
		component,
		stories ?? [
			// `source` is what an authored story states; the resolved props are
			// the same here because neither case names a fixture.
			{
				name: "solid",
				props: { label: "Add to cart" },
				source: { label: "Add to cart" },
			},
			{
				name: "outline",
				props: { label: "Add to cart", scheme: "outline" },
				source: { label: "Add to cart", scheme: "outline" },
			},
		],
	);
	const html = workbenchPage([rendered], {
		saveEndpoint: "/__save",
		renderEndpoint: "/__render",
		...(storyFiles ? { storyFiles } : {}),
	});
	const { window, document } = parseHTML(html);

	// linkedom does no layout, so the stage reports whatever room the test says
	// it has — the one measurement the shell reads back from the page.
	Object.defineProperty(
		document.getElementById("canvas-stage"),
		"clientWidth",
		{
			value: stageWidth,
			configurable: true,
		},
	);

	const source = html.slice(
		html.lastIndexOf("<script>") + "<script>".length,
		html.lastIndexOf("</script>"),
	);
	// linkedom's window is not a global scope, so the script's bare `document`
	// and friends are passed in by name.
	const run = new Function(
		"window",
		"document",
		"localStorage",
		"location",
		"history",
		"matchMedia",
		"ResizeObserver",
		"addEventListener",
		"getComputedStyle",
		"scrollX",
		"scrollY",
		"setTimeout",
		"navigator",
		"innerWidth",
		"fetch",
		source,
	);
	run(
		window,
		document,
		{
			getItem: (key) => (storage.has(key) ? storage.get(key) : null),
			setItem: (key, value) => storage.set(key, String(value)),
		},
		new URL("http://localhost/index.html"),
		{ replaceState() {} },
		() => ({ matches: false, addEventListener() {} }),
		class {
			observe() {}
		},
		window.addEventListener.bind(window),
		() => ({}),
		0,
		0,
		setTimeout,
		{ clipboard: { writeText: async () => {} } },
		width,
		fetch,
	);

	const workbench = document.getElementById("workbench");
	return {
		document,
		window,
		storage,
		state: () => ({
			sidebar: workbench.getAttribute("data-sidebar"),
			docs: workbench.getAttribute("data-docs"),
		}),
		click: (id) =>
			document.getElementById(id).dispatchEvent(new window.Event("click")),
		// linkedom's select.value is getter-only, so a choice is made the way a
		// browser represents it: on the option.
		select: (menu, value) => {
			for (const option of menu.querySelectorAll("option")) {
				if (option.getAttribute("value") === value) {
					option.setAttribute("selected", "");
				} else option.removeAttribute("selected");
			}
			menu.dispatchEvent(new window.Event("change"));
		},
		setViewport: (value) => {
			const field = document.getElementById("viewport-width");
			field.setAttribute("value", value);
			field.dispatchEvent(new window.Event("input"));
		},
	};
}

test("the shell's script runs without throwing", async () => {
	// The whole point: a syntax error or a missing element takes the entire page
	// down, and every string assertion in the suite would still pass.
	const shell = await mountShell();
	assert.equal(
		shell.document.getElementById("canvas").getAttribute("src"),
		"./stories/button--solid.html",
	);
});

test("the panel toggles open and close, and remember which", async () => {
	const shell = await mountShell();
	assert.deepEqual(shell.state(), { sidebar: "open", docs: "open" });

	shell.click("toggle-sidebar");
	assert.equal(shell.state().sidebar, "closed");
	shell.click("toggle-docs");
	assert.equal(shell.state().docs, "closed");
	shell.click("toggle-sidebar");
	assert.equal(shell.state().sidebar, "open");

	// A closed panel is a preference, so the next visit opens the same way.
	const second = await mountShell({ storage: shell.storage });
	assert.deepEqual(second.state(), { sidebar: "open", docs: "closed" });
});

test("the canvas is on screen at every width", async () => {
	// The failure this exists to prevent: a narrow window stacking the columns
	// and pushing the story below a panel, or squeezing it to nothing. A side
	// panel closes instead — the viewport never gives way.
	for (const width of [1600, 1000, 900, 700, 500]) {
		const shell = await mountShell({ width });
		const canvas = shell.document.getElementById("canvas");
		assert.ok(canvas, `no canvas at ${width}`);
		// Its column is between the two panels and always present; only the
		// panels are allowed to disappear.
		assert.equal(canvas.closest("main").className, "main");
	}

	// Narrow enough for two columns, not three: the documentation goes.
	assert.deepEqual((await mountShell({ width: 900 })).state(), {
		sidebar: "open",
		docs: "closed",
	});
	// Narrow enough for one: the canvas is what is left.
	assert.deepEqual((await mountShell({ width: 500 })).state(), {
		sidebar: "closed",
		docs: "closed",
	});
});

test("a squeezed panel is not a remembered one", async () => {
	// Closed because the window is narrow, then opened wide again: the panel
	// comes back, because the viewer never asked for it to be shut.
	const storage = new Map();
	assert.equal(
		(await mountShell({ width: 700, storage })).state().docs,
		"closed",
	);
	assert.equal(
		(await mountShell({ width: 1400, storage })).state().docs,
		"open",
	);
});

test("zoom scales the rendered story, it does not reflow it", async () => {
	// The bug this pins: zoom applied inside the frame re-lays-out the story, so
	// 50% shows a double-width layout instead of the same layout drawn smaller.
	// The frame keeps its real width and the host scales the result.
	const shell = await mountShell();
	const canvas = shell.document.getElementById("canvas");
	const scaler = shell.document.getElementById("canvas-scaler");
	const zoom = shell.document.getElementById("zoom");

	shell.setViewport("400");
	assert.equal(canvas.style.width, "400px");
	assert.equal(canvas.style.transform, "");

	shell.select(zoom, "0.5");
	// The story still lays out at 400 — media queries see the viewport it was
	// given, whatever the zoom.
	assert.equal(canvas.style.width, "400px");
	assert.equal(canvas.style.transform, "scale(0.5)");
	// A transform reserves no space, so the wrapper carries the visible size.
	assert.equal(scaler.style.width, "200px");

	shell.select(zoom, "2");
	assert.equal(canvas.style.width, "400px");
	assert.equal(canvas.style.transform, "scale(2)");
	assert.equal(scaler.style.width, "800px");
});

test("full width follows the zoom; a preset does not", async () => {
	// A preset means what it says — 375 is a 375 viewport at every scale. "Full
	// width" has no number of its own, so it follows the zoom: out to see a
	// wider viewport, in to see a narrower one, filling the stage either way.
	const shell = await mountShell({ stageWidth: 840 });
	const canvas = shell.document.getElementById("canvas");
	const scaler = shell.document.getElementById("canvas-scaler");
	const zoom = shell.document.getElementById("zoom");

	// 840 stage, 40 of padding: 800 to give.
	shell.setViewport("");
	assert.equal(canvas.style.width, "800px");
	assert.equal(scaler.style.width, "800px");

	shell.select(zoom, "0.5");
	assert.equal(canvas.style.width, "1600px", "half the scale, twice the room");
	assert.equal(scaler.style.width, "800px", "still fills the stage");

	shell.select(zoom, "2");
	assert.equal(canvas.style.width, "400px");
	assert.equal(scaler.style.width, "800px");

	// And a preset is untouched by all of it.
	shell.setViewport("375");
	assert.equal(canvas.style.width, "375px");
	assert.equal(scaler.style.width, "750px");
});

test("the controls are the declaration, seeded from the story as written", async () => {
	const shell = await mountShell();
	const rows = [...shell.document.querySelectorAll("#controls .control")];

	// One row per declared prop, and nothing else — the form is the interface
	// the Liquid states, not a shape the editor invented.
	assert.deepEqual(
		rows.map((row) => row.querySelector("code").textContent),
		["label", "scheme"],
	);
	// An enum is a select over its members; the rest follow their kind.
	assert.equal(rows[1].querySelector("select").dataset.control, "scheme");
	assert.equal(rows[0].querySelector("input").type, "text");

	// Seeded from the story's own delta: "solid" states only `label`.
	assert.equal(
		rows[0].querySelector("input").getAttribute("value"),
		"Add to cart",
	);

	// Nothing to save until something changed, and Reset is likewise inert.
	assert.equal(shell.document.getElementById("controls-save").disabled, true);
	assert.equal(shell.document.getElementById("controls-reset").disabled, true);
});

test("storefront data stays a reference, because it is not a value", async () => {
	// Resolving `{ "$file": "…" }` gives a product object; putting that
	// in a text field and saving it would inline three kilobytes of stand-in
	// data where a one-word reference used to be. So that one direction stays
	// shut, and says why.
	const shell = await mountShell({
		stories: [
			{
				name: "on sale",
				props: { label: "Add" },
				source: { label: { $file: "fixtures/product.json" } },
			},
		],
	});
	const row = [...shell.document.querySelectorAll("#controls .control")].find(
		(entry) => entry.querySelector("code").textContent === "label",
	);

	// Named, not typed — and no field pretending otherwise. Changing which
	// fixture a story uses is what the JSON tab is for.
	// The row names the path, which is an answer you can open.
	assert.equal(
		row.querySelector(".control-fixture").textContent,
		"fixtures/product.json",
	);
	assert.equal(row.querySelector("input"), null);
});

test("a field shows what renders, and saving it back changes nothing", async () => {
	// The bug this pins: fields were seeded from the story's delta alone, so a
	// prop the story did not state showed blank — and saving an untouched form
	// then wrote the declaration's defaults into a story that had deliberately
	// said nothing. `hero`'s "default" grew a scheme and a show_button that way.
	let sent;
	const shell = await mountShell({
		stories: [
			{ name: "solid", props: { label: "Add" }, source: { label: "Add" } },
		],
		fetch: async (_url, init) => {
			sent = JSON.parse(init.body);
			return { ok: true, text: async () => "saved" };
		},
	});
	const field = (name) =>
		shell.document.querySelector(`[data-control="${name}"]`);

	// `scheme` is not in the story; the schema gives it "solid", and that is
	// what the canvas is rendering, so that is what the field says.
	assert.equal(field("scheme").value, "solid");
	assert.equal(field("label").getAttribute("value"), "Add");

	// Touch one field, save, and only the touched one is written.
	field("label").setAttribute("value", "Buy");
	field("label").dispatchEvent(new shell.window.Event("input"));
	shell.click("controls-save");
	await new Promise((settle) => setTimeout(settle, 0));

	assert.deepEqual(sent.props, { label: "Buy" }, "the delta, and only that");
});

test("editing a control repaints the canvas without writing the story", async () => {
	let rendered;
	const shell = await mountShell({
		fetch: async (url, init) => {
			if (url === "/__render") {
				rendered = JSON.parse(init.body);
				return { ok: true, text: async () => "<p>draft</p>" };
			}
			throw new Error(`unexpected ${url}`);
		},
	});
	const canvas = shell.document.getElementById("canvas");
	const label = shell.document.querySelector('[data-control="label"]');

	label.setAttribute("value", "Buy now");
	label.dispatchEvent(new shell.window.Event("input"));
	await new Promise((settle) => setTimeout(settle, 200));

	// The render is liquidjs in Node, so the page asks the server for it — and
	// what comes back is the same document the build would have written.
	assert.equal(rendered.component, "button");
	assert.deepEqual(rendered.props, { label: "Buy now" });
	assert.equal(canvas.getAttribute("srcdoc"), "<p>draft</p>");
	// Nothing was saved: the panel says so, and the button is still armed.
	assert.equal(shell.document.getElementById("controls-save").disabled, false);
	assert.match(
		shell.document.getElementById("controls-status").textContent,
		/unsaved/,
	);
});

test("stories can be created and deleted where they are listed", async () => {
	const sent = [];
	const shell = await mountShell({
		fetch: async (_url, init) => {
			sent.push(JSON.parse(init.body));
			return { ok: true, text: async () => "saved" };
		},
	});

	const name = shell.document.getElementById("story-name");
	name.setAttribute("value", "on sale");
	name.dispatchEvent(new shell.window.Event("input"));
	assert.equal(shell.document.getElementById("story-add").disabled, false);
	shell.click("story-add");
	await new Promise((settle) => setTimeout(settle, 0));
	assert.deepEqual(sent.at(-1), {
		component: "button",
		story: "on sale",
		action: "create",
	});

	// Deleting asks once. A story is somebody's writing — the case they thought
	// worth showing, and the note saying why — so the first click is a question.
	const drop = shell.document.querySelector('[data-story-drop="outline"]');
	drop.dispatchEvent(new shell.window.Event("click"));
	await new Promise((settle) => setTimeout(settle, 0));
	assert.equal(drop.textContent, "Delete?");
	assert.equal(sent.length, 1, "the first click sent nothing");

	drop.dispatchEvent(new shell.window.Event("click"));
	await new Promise((settle) => setTimeout(settle, 0));
	assert.deepEqual(sent.at(-1), {
		component: "button",
		story: "outline",
		action: "delete",
	});

	// Looking away is how you say no.
	const other = shell.document.querySelector('[data-story-drop="solid"]');
	other.dispatchEvent(new shell.window.Event("click"));
	other.dispatchEvent(new shell.window.Event("blur"));
	assert.equal(other.textContent, "×");
});

test("the file itself can be edited when a server offers it", async () => {
	const shell = await mountShell({
		storyFiles: {
			button: { path: "snippets/button.stories.json", contents: '{ "x": 1 }' },
		},
	});
	// A form has no row for a note, an explicit null, or a story that does not
	// exist yet. The file does.
	shell.document
		.querySelector('[data-mode="json"]')
		.dispatchEvent(new shell.window.Event("click"));

	assert.equal(
		shell.document.getElementById("json-path").textContent,
		"snippets/button.stories.json",
	);
	assert.equal(shell.document.getElementById("json-text").value, '{ "x": 1 }');
	// The file is the story set, so it sits with the stories rather than under
	// the fields that edit one of them.
	assert.equal(shell.document.getElementById("story-lists").hidden, true);
});

test("editing a control arms Save, and Save sends the story's delta", async () => {
	let sent;
	const shell = await mountShell({
		fetch: async (url, init) => {
			sent = { url, body: JSON.parse(init.body) };
			return { ok: true, text: async () => "saved" };
		},
	});
	const save = shell.document.getElementById("controls-save");
	const label = shell.document.querySelector('[data-control="label"]');

	label.setAttribute("value", "Buy now");
	label.dispatchEvent(new shell.window.Event("input"));
	assert.equal(save.disabled, false, "an edit arms the button");

	save.dispatchEvent(new shell.window.Event("click"));
	await new Promise((settle) => setTimeout(settle, 0));

	assert.equal(sent.url, "/__save");
	assert.equal(sent.body.component, "button");
	assert.equal(sent.body.story, "solid");
	// The delta, not the merged props: `scheme` and `size` have declared
	// defaults and this story never stated them.
	assert.deepEqual(sent.body.props, { label: "Buy now" });
});

test("selecting a story swaps the canvas and its documentation", async () => {
	const shell = await mountShell();
	const canvas = shell.document.getElementById("canvas");
	const pick = shell.document.querySelector(
		'[data-story-pick="button--outline"]',
	);
	pick.dispatchEvent(new shell.window.Event("click"));

	assert.equal(canvas.getAttribute("src"), "./stories/button--outline.html");
	// The call that reproduces the story follows the selection.
	assert.match(
		shell.document.getElementById("canvas-call-code").textContent,
		/scheme: 'outline'/,
	);
});
