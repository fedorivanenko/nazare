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
} = {}) {
	const component = previewComponentFromSource(BUTTON, "button.nz.liquid");
	const rendered = await renderComponentStories(component, [
		{ name: "solid", props: { label: "Add to cart" } },
		{ name: "outline", props: { label: "Add to cart", scheme: "outline" } },
	]);
	const html = workbenchPage([rendered]);
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

test("selecting a story swaps the canvas and its documentation", async () => {
	const shell = await mountShell();
	const canvas = shell.document.getElementById("canvas");
	const menu = shell.document.querySelector("[data-substories]");

	// linkedom's select.value is getter-only, so the selection is made the way a
	// browser would represent it — on the option itself.
	for (const option of menu.querySelectorAll("option")) {
		if (option.getAttribute("value") === "button--outline") {
			option.setAttribute("selected", "");
		} else option.removeAttribute("selected");
	}
	menu.dispatchEvent(new shell.window.Event("change"));

	assert.equal(canvas.getAttribute("src"), "./stories/button--outline.html");
	// The call that reproduces the story follows the selection.
	assert.match(
		shell.document.getElementById("canvas-call-code").textContent,
		/scheme: 'outline'/,
	);
});
