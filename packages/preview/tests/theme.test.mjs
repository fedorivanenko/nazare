// The fixture theme, previewed the way `preview-theme.mjs` previews a real one.
//
// It is plain Liquid with no manifests: five components that declare their
// interface the way Shopify's own vocabulary does — `{% doc %}` params for the
// snippets, `{% schema %}` settings for the section and the block — and a story
// file beside each one saying which cases are worth looking at. Plus one helper
// snippet with no story file, because every theme has a hundred of those and
// they belong in scope, not in the sidebar.
//
// Every story must render markup, with no error and nothing the declaration
// says is wrong, because this theme is the claim that the plain-Liquid path
// works on files nobody wrote for Nazare.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	parseStoryFile,
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

/**
 * The same walk the runner does: directory is classification, and everything
 * compiles so a composing template can reach its helpers. Whether a component
 * is *previewed* is a separate question, answered by the story file.
 */
function walkTheme() {
	const compiled = [];
	for (const dir of ["snippets", "sections", "blocks"]) {
		if (!existsSync(join(themeDir, dir))) continue;
		for (const entry of readdirSync(join(themeDir, dir)).sort()) {
			if (!entry.endsWith(".liquid")) continue;
			const storyFile = readThemeFile(
				`${dir}/${basename(entry, ".liquid")}.stories.json`,
			);
			compiled.push({
				component: previewComponentFromSource(
					readThemeFile(`${dir}/${entry}`),
					`${dir}/${entry}`,
					{ readFile: readThemeFile },
				),
				sidecar: storyFile
					? parseStoryFile(JSON.parse(storyFile), entry)
					: undefined,
			});
		}
	}
	return compiled;
}

async function renderTheme() {
	const compiled = walkTheme();
	// Drawn from everything compiled, not only from what is previewed.
	const snippets = snippetLibrary(compiled.map((entry) => entry.component));
	const rendered = [];
	for (const { component, sidecar } of compiled) {
		if (!sidecar) continue;
		rendered.push(
			await renderComponentStories(component, storiesFor({ sidecar }), {
				snippets,
			}),
		);
	}
	return rendered;
}

test("the fixture theme previews as plain Liquid, classified by directory", () => {
	const kinds = Object.fromEntries(
		walkTheme().map(({ component }) => [
			component.name,
			`${component.frontend}/${component.componentKind}`,
		]),
	);

	assert.deepEqual(kinds, {
		icon: "plain/snippet",
		price: "plain/snippet",
		"product-card": "plain/snippet",
		"collection-grid": "plain/section",
		hero: "plain/section",
		note: "plain/block",
	});
});

test("a story file is what publishes a component to the workbench", async () => {
	const previewed = (await renderTheme()).map(({ component }) => component.name);

	// icon.liquid compiles and stays in scope, but nobody wrote it stories, so
	// it is not something the sidebar offers to look at.
	assert.ok(!previewed.includes("icon"));
	assert.deepEqual(previewed.sort(), [
		"collection-grid",
		"hero",
		"note",
		"price",
		"product-card",
	]);
});

test("every component declares its own interface", () => {
	const controls = Object.fromEntries(
		walkTheme().map(({ component }) => [
			component.name,
			component.controls.map((control) => control.name),
		]),
	);

	// {% doc %} @param lines.
	assert.deepEqual(controls.price, ["price", "compare_at_price"]);
	assert.deepEqual(controls["product-card"], ["product", "badge"]);
	// A helper that declares nothing gets no controls, and is not second-guessed.
	assert.deepEqual(controls.icon, []);
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
		assert.ok(stories.length > 0, `${component.name} rendered no stories`);
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

test("the stories are the ones the files name, in the order they are written", async () => {
	const names = Object.fromEntries(
		(await renderTheme()).map(({ component, stories }) => [
			component.name,
			stories.map((rendered) => rendered.story.name),
		]),
	);

	assert.deepEqual(names.hero, [
		"default",
		"dark",
		"no button",
		"long heading",
	]);
	assert.deepEqual(names.note, ["default", "success", "warning"]);
	assert.deepEqual(names["product-card"], ["default", "with badge"]);
	assert.deepEqual(names.price, ["on sale", "full price", "free"]);
});

test("a story states its delta, and the declaration supplies the rest", async () => {
	const hero = (await renderTheme()).find(
		(entry) => entry.component.name === "hero",
	);
	const dark = hero.stories.find((story) => story.story.name === "dark");

	// The story sets only `scheme`; the heading, body, and button come from the
	// schema's own defaults.
	assert.deepEqual(Object.keys(dark.story.props), ["scheme"]);
	assert.ok(dark.html.includes("hero--dark"));
	assert.ok(dark.html.includes("New season knitwear"));
	assert.ok(dark.html.includes("Shop the collection"));
});

test("an explicit null is an unset prop, not the word null", async () => {
	const price = (await renderTheme()).find(
		(entry) => entry.component.name === "price",
	);
	const full = price.stories.find((story) => story.story.name === "full price");

	assert.ok(full.html.includes("$24.00"));
	// compare_at_price: null, so the strikethrough is absent rather than empty.
	assert.ok(!full.html.includes("price__compare"));
});

test("a composing snippet renders the ones it composes", async () => {
	const rendered = await renderTheme();
	const card = rendered.find(
		(entry) => entry.component.name === "product-card",
	);
	const badged = card.stories.find(
		(story) => story.story.name === "with badge",
	);

	// product-card renders 'price' and 'icon' — one previewed, one not — so the
	// snippet library has to hold both. The fixture product is on sale, so the
	// struck-through compare-at proves the composed snippet received real values.
	assert.ok(badged.html.includes("Merino Crew Sweater"));
	assert.ok(badged.html.includes("$24.00"));
	assert.ok(badged.html.includes('<s class="price__compare">$40.00</s>'));
	assert.ok(badged.html.includes('class="icon icon--star"'));
	assert.ok(badged.html.includes('class="card__badge"'));
});
