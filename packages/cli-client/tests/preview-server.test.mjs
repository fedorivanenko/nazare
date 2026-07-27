// `nazare preview serve` — the workbench, rebuilt as you type.
//
// The server adds no compilation of its own: it repeats the build and holds the
// result in memory. So what is worth testing is not the render — the other
// suites cover that — but the things only a server can get wrong: what it
// answers on each route, and what it does with a file that is mid-edit and
// therefore broken.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const serverModule = resolve("packages/cli-client/dist/preview-server.js");

const PRICE = `{% doc %}
  @param {number} price - Price in minor units
{% enddoc %}
<span class="price">{{ price | money }}</span>
`;

const STORIES = JSON.stringify({
	stories: [{ name: "on sale", props: { price: 2400 } }],
});

async function withTheme(files, fn) {
	const dir = mkdtempSync(join(tmpdir(), "nazare-serve-"));
	try {
		for (const [path, contents] of Object.entries(files)) {
			const full = join(dir, path);
			mkdirSync(dirname(full), { recursive: true });
			await writeFile(full, contents);
		}
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const load = async () => await import(pathToFileURL(serverModule).href);

test("every page the workbench needs is answered from memory", async () => {
	await withTheme(
		{
			"snippets/price.liquid": PRICE,
			"snippets/price.stories.json": STORIES,
			"assets/theme.css": ".price { color: red }",
		},
		async (dir) => {
			const { previewServerState } = await load();
			const state = await previewServerState(dir, "theme");

			assert.ok(state.pages.has("/index.html"));
			assert.ok(state.pages.has("/all.html"));
			assert.ok(state.pages.has("/stories/price--on-sale.html"));

			// Served, a story document is addressed absolutely, so the assets its
			// template asks for resolve from the root rather than from a folder.
			assert.match(
				state.pages.get("/stories/price--on-sale.html"),
				/<base href="\/">/,
			);
			// The shell listens for rebuilds; a written page has nobody to listen to.
			assert.match(
				state.pages.get("/index.html"),
				/EventSource\("\/__events"\)/,
			);
			// And it says what it was built from, same as the build command.
			assert.match(
				state.pages.get("/index.html"),
				/class="source-path">theme</,
			);
		},
	);
});

test("a story file mid-edit keeps the component it belongs to", async () => {
	await withTheme(
		{
			"snippets/price.liquid": PRICE,
			"snippets/price.stories.json": STORIES,
		},
		async (dir) => {
			const { previewServerState } = await load();
			const good = await previewServerState(dir, "theme");
			assert.equal(good.rendered.length, 1);

			// A story file is written by hand, so it spends time invalid. Dropping
			// the component while that is true takes away the page being edited
			// against — the failure the previous version had, where the story
			// document 404'd on a half-typed key.
			await writeFile(
				join(dir, "snippets/price.stories.json"),
				'{ "stories": [ { "name": "x", "argTypes": {} } ] }',
			);
			const broken = await previewServerState(dir, "theme", good);

			assert.deepEqual(
				broken.rendered.map((entry) => entry.component.name),
				["price"],
				"the last good render is carried",
			);
			assert.ok(broken.pages.has("/stories/price--on-sale.html"));
			// The error is still reported — carried is not the same as fine.
			assert.match(broken.collection.malformed[0], /unknown key "argTypes"/);
			assert.deepEqual(broken.collection.malformedComponents, ["price"]);

			// With no previous build there is nothing to carry, and the component
			// is simply absent rather than invented.
			const cold = await previewServerState(dir, "theme");
			assert.deepEqual(cold.rendered, []);
		},
	);
});

test("a directory with nothing to preview reports rather than serving", async () => {
	await withTheme({ "notes.md": "# nothing here" }, async (dir) => {
		const { previewServerState } = await load();
		assert.equal(await previewServerState(dir, "theme"), undefined);
	});
});
