// The fixture theme, previewed the way `preview-theme.mjs` previews a real one.
//
// It is plain Liquid with no manifests: five components that declare themselves
// the way Shopify's own vocabulary does — `{% doc %}` params for the snippets,
// `{% schema %}` settings for the section and the block — plus one authored
// story in a sidecar. Every story must render markup, with no error and nothing
// the declaration says is wrong, because this theme is the claim that the
// plain-Liquid path works on files nobody wrote for Nazare.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	previewComponentFromSource,
	renderComponentStories,
	snippetLibrary,
	storiesFor,
} from "../dist/index.js";

const themeDir = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../fixtures/theme",
);

const readThemeFile = (path) => {
	try {
		return readFileSync(join(themeDir, path), "utf8");
	} catch {
		return undefined;
	}
};

/** The same walk the runner does: directory is classification. */
function previewTheme() {
	const previewed = [];
	for (const dir of ["snippets", "sections", "blocks"]) {
		if (!existsSync(join(themeDir, dir))) continue;
		for (const entry of readdirSync(join(themeDir, dir)).sort()) {
			if (!entry.endsWith(".liquid")) continue;
			const sidecar = readThemeFile(
				`${dir}/${entry.replace(".liquid", ".stories.json")}`,
			);
			previewed.push({
				component: previewComponentFromSource(
					readThemeFile(`${dir}/${entry}`),
					`${dir}/${entry}`,
					{ readFile: readThemeFile },
				),
				sidecar: sidecar ? JSON.parse(sidecar) : undefined,
			});
		}
	}
	return previewed;
}

async function renderTheme() {
	const previewed = previewTheme();
	const snippets = snippetLibrary(previewed.map((entry) => entry.component));
	const rendered = [];
	for (const { component, sidecar } of previewed) {
		rendered.push(
			await renderComponentStories(
				component,
				storiesFor(component, undefined, sidecar),
				{ snippets },
			),
		);
	}
	return rendered;
}

test("the fixture theme previews as plain Liquid, classified by directory", () => {
	const kinds = Object.fromEntries(
		previewTheme().map(({ component }) => [
			component.name,
			`${component.frontend}/${component.componentKind}`,
		]),
	);

	assert.deepEqual(kinds, {
		price: "plain/snippet",
		"product-card": "plain/snippet",
		"collection-grid": "plain/section",
		hero: "plain/section",
		note: "plain/block",
	});
});

test("every component declares its own interface", () => {
	const controls = Object.fromEntries(
		previewTheme().map(({ component }) => [
			component.name,
			component.controls.map((control) => control.name),
		]),
	);

	// {% doc %} @param lines.
	assert.deepEqual(controls.price, ["price", "compare_at_price"]);
	assert.deepEqual(controls["product-card"], ["product", "badge"]);
	// {% schema %} settings, minus the header that is editor chrome.
	assert.deepEqual(controls.hero, [
		"heading",
		"body",
		"scheme",
		"show_button",
		"button_label",
		"button_url",
	]);
	assert.deepEqual(controls["collection-grid"], ["heading", "columns"]);
	assert.deepEqual(controls.note, ["text", "tone", "alignment"]);
});

test("every story renders markup, with no error and no issue", async () => {
	for (const { component, stories } of await renderTheme()) {
		for (const rendered of stories) {
			const where = `${component.name} / ${rendered.story.name}`;
			assert.equal(rendered.error, undefined, `${where} threw`);
			assert.ok(rendered.html.trim().length > 0, `${where} rendered nothing`);
			assert.deepEqual(
				rendered.issues,
				[],
				`${where}: ${rendered.issues.map((issue) => issue.message).join("; ")}`,
			);
		}
	}
});

test("the theme's stories cover its declared variants", async () => {
	const names = Object.fromEntries(
		(await renderTheme()).map(({ component, stories }) => [
			component.name,
			stories.map((rendered) => rendered.story.name),
		]),
	);

	// A select setting generates one story per member, like a Nazare enum.
	assert.deepEqual(names.hero, ["default", "scheme: dark"]);
	assert.deepEqual(names.note, [
		"default",
		"tone: success",
		"tone: warning",
		"alignment: center",
	]);
	// The sidecar's case is added to the derived one, not swapped for it.
	assert.deepEqual(names["product-card"], ["default", "on sale"]);
});

test("a composing snippet renders the one it composes", async () => {
	const rendered = await renderTheme();
	const card = rendered.find(
		(entry) => entry.component.name === "product-card",
	);
	const onSale = card.stories.find((story) => story.story.name === "on sale");

	// product-card renders 'price', which needs the whole snippet library in
	// scope — and the fixture product is on sale, so the compare-at struck
	// through proves the composed snippet received real values.
	assert.ok(onSale.html.includes("Merino Crew Sweater"));
	assert.ok(onSale.html.includes("$24.00"));
	assert.ok(onSale.html.includes('<s class="price__compare">$40.00</s>'));
	assert.ok(onSale.html.includes('class="card__badge"'));
});
