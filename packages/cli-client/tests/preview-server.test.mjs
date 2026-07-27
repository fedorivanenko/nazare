// `nazare preview serve` — the workbench, rebuilt as you type.
//
// The server adds no compilation of its own: it repeats the build and holds the
// result in memory. So what is worth testing is not the render — the other
// suites cover that — but the things only a server can get wrong: what it
// answers on each route, and what it does with a file that is mid-edit and
// therefore broken.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
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

test("saving a story rewrites its file and leaves the rest of it alone", async () => {
	await withTheme(
		{
			"snippets/price.liquid": PRICE,
			"snippets/price.stories.json": JSON.stringify(
				{
					stories: [
						{
							name: "on sale",
							props: { price: 2400 },
							note: "why this case matters",
						},
						{ name: "free", props: { price: 0 } },
					],
				},
				null,
				2,
			),
		},
		async (dir) => {
			const { previewServerState, saveStoryFile } = await load();
			const state = await previewServerState(dir, "theme");

			assert.equal(
				await saveStoryFile(dir, state, {
					component: "price",
					story: "on sale",
					props: { price: 2400, compare_at_price: 4000 },
				}),
				undefined,
			);

			const written = JSON.parse(
				await readFile(join(dir, "snippets/price.stories.json"), "utf8"),
			);
			// The edited story takes the new props.
			assert.deepEqual(written.stories[0].props, {
				price: 2400,
				compare_at_price: 4000,
			});
			// And nothing else in the file moved: the note it was given, and the
			// story nobody was editing.
			assert.equal(written.stories[0].note, "why this case matters");
			assert.deepEqual(written.stories[1], {
				name: "free",
				props: { price: 0 },
			});
		},
	);
});

test("a save that would break the story file is refused", async () => {
	await withTheme(
		{
			"snippets/price.liquid": PRICE,
			"snippets/price.stories.json": STORIES,
		},
		async (dir) => {
			const { previewServerState, saveStoryFile } = await load();
			const state = await previewServerState(dir, "theme");
			const before = await readFile(
				join(dir, "snippets/price.stories.json"),
				"utf8",
			);

			// The editor is held to the format it edits: what it writes goes back
			// through the same parse `preview check` uses, so the GUI cannot
			// produce a file the CLI would reject.
			assert.match(
				await saveStoryFile(dir, state, {
					component: "price",
					story: "nowhere",
					props: {},
				}),
				/has no story named nowhere/,
			);
			assert.match(
				await saveStoryFile(dir, state, {
					component: "missing",
					story: "on sale",
					props: {},
				}),
				/unknown component/,
			);

			assert.equal(
				await readFile(join(dir, "snippets/price.stories.json"), "utf8"),
				before,
				"a refused save writes nothing",
			);
		},
	);
});

test("the story file can be saved as text, and is checked as one", async () => {
	await withTheme(
		{
			"snippets/price.liquid": PRICE,
			"snippets/price.stories.json": STORIES,
		},
		async (dir) => {
			const { previewServerState, saveStoryFile } = await load();
			const state = await previewServerState(dir, "theme");

			// The panel offers the file itself because a form cannot express
			// everything a story file holds — a note, an explicit null, a story
			// that does not exist yet, the order they appear in.
			assert.match(state.pages.get("/index.html"), /id="story-files"/);

			const edited = `{
  "stories": [
    { "name": "on sale", "props": { "price": 2400 }, "note": "kept" },
    { "name": "free", "props": { "price": 0 } }
  ]
}
`;
			assert.equal(
				await saveStoryFile(dir, state, { component: "price", file: edited }),
				undefined,
			);
			// Written as given: the author's formatting is theirs to keep, unlike
			// the field editor which round-trips through JSON.stringify.
			assert.equal(
				await readFile(join(dir, "snippets/price.stories.json"), "utf8"),
				edited,
			);

			// And held to the same format a hand edit is held to.
			assert.match(
				await saveStoryFile(dir, state, { component: "price", file: "{ oops" }),
				/invalid JSON/,
			);
			assert.match(
				await saveStoryFile(dir, state, {
					component: "price",
					file: '{"stories":[{"name":"a","argTypes":{}}]}',
				}),
				/unknown key "argTypes"/,
			);
			// Neither rejection touched the file.
			assert.equal(
				await readFile(join(dir, "snippets/price.stories.json"), "utf8"),
				edited,
			);
		},
	);
});

test("a story can be created and deleted, but not the last one", async () => {
	await withTheme(
		{
			"snippets/price.liquid": PRICE,
			"snippets/price.stories.json": STORIES,
		},
		async (dir) => {
			const { previewServerState, saveStoryFile } = await load();
			const read = async () =>
				JSON.parse(
					await readFile(join(dir, "snippets/price.stories.json"), "utf8"),
				);

			let state = await previewServerState(dir, "theme");
			assert.equal(
				await saveStoryFile(dir, state, {
					component: "price",
					story: "free",
					action: "create",
				}),
				undefined,
			);
			assert.deepEqual(
				(await read()).stories.map((story) => story.name),
				["on sale", "free"],
			);

			state = await previewServerState(dir, "theme");
			assert.match(
				await saveStoryFile(dir, state, {
					component: "price",
					story: "free",
					action: "create",
				}),
				/already has free/,
			);
			assert.equal(
				await saveStoryFile(dir, state, {
					component: "price",
					story: "on sale",
					action: "delete",
				}),
				undefined,
			);
			assert.deepEqual(
				(await read()).stories.map((story) => story.name),
				["free"],
			);

			// A component with no stories does not appear at all, so deleting the
			// last one deletes the component. That is a thing to do deliberately,
			// in the file, not by clicking the last × in a list.
			state = await previewServerState(dir, "theme");
			assert.match(
				await saveStoryFile(dir, state, {
					component: "price",
					story: "free",
					action: "delete",
				}),
				/only story/,
			);
		},
	);
});

test("a draft renders against props that are not on disk", async () => {
	await withTheme(
		{
			"snippets/price.liquid": PRICE,
			"snippets/price.stories.json": STORIES,
		},
		async (dir) => {
			const { previewServerState, renderStoryDraft } = await load();
			const state = await previewServerState(dir, "theme");
			const before = await readFile(
				join(dir, "snippets/price.stories.json"),
				"utf8",
			);

			// What lets a control repaint the canvas while the file is untouched:
			// the same render as the build, run against what the panel holds.
			const html = await renderStoryDraft(state, {
				component: "price",
				story: "on sale",
				props: { price: 999 },
			});

			assert.match(html, /\$9\.99/);
			assert.equal(
				await readFile(join(dir, "snippets/price.stories.json"), "utf8"),
				before,
				"a draft writes nothing",
			);
		},
	);
});

test("a directory with nothing to preview reports rather than serving", async () => {
	await withTheme({ "notes.md": "# nothing here" }, async (dir) => {
		const { previewServerState } = await load();
		assert.equal(await previewServerState(dir, "theme"), undefined);
	});
});
