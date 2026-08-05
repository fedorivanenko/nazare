// `nazare preview` — the three verbs that need no server.
//
// The rule they all share: a component appears once it has stories. Nothing
// here invents a case for a template that has none, and nothing silently omits
// one either — a skipped template is counted, and `check --json` names it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const cli = resolve("packages/cli-client/dist/index.js");

async function runCli(cwd, ...args) {
	let stdout = "";
	let stderr = "";
	const { main } = await import(pathToFileURL(cli).href);
	const status = await main(args, {
		cwd,
		env: { ...process.env, NAZARE_REGISTRY: undefined },
		output: {
			log: (...values) => {
				stdout += `${values.join(" ")}\n`;
			},
			error: (...values) => {
				stderr += `${values.join(" ")}\n`;
			},
		},
	});
	return { status, stdout, stderr };
}

async function withProject(files, fn) {
	const cwd = mkdtempSync(join(tmpdir(), "nazare-preview-"));
	try {
		for (const [path, contents] of Object.entries(files)) {
			const full = join(cwd, path);
			mkdirSync(dirname(full), { recursive: true });
			await writeFile(full, contents);
		}
		await fn(cwd);
	} finally {
		await rm(cwd, { recursive: true, force: true });
	}
}

const PRICE = `{% doc %}
  @param {number} price - Price in minor units
  @param {number} [compare_at_price] - Was-price, when on sale
{% enddoc %}
<span class="price">{{ price | money }}
{%- if compare_at_price > price -%}<s>{{ compare_at_price | money }}</s>{%- endif -%}
</span>
`;

// A helper nobody wrote stories for: in scope for {% render %}, out of the
// sidebar. Every real theme has a hundred of these.
const ICON = `<span class="icon icon--{{ name }}">*</span>\n`;

const THEME = {
	"snippets/price.liquid": PRICE,
	"snippets/price.stories.json": JSON.stringify({
		stories: [
			{ name: "on sale", props: { price: 2400, compare_at_price: 4000 } },
			{ name: "full price", props: { price: 2400, compare_at_price: null } },
		],
	}),
	"snippets/icon.liquid": ICON,
};

test("check renders every story and says what it skipped", async () => {
	await withProject(THEME, async (cwd) => {
		const { status, stdout } = await runCli(cwd, "preview", "check", ".");

		assert.equal(status, 0);
		assert.match(stdout, /1 components, 2 stories, 0 problems/);
		// icon.liquid compiled and stayed in scope, but is not something to look
		// at — and it does not vanish without a word either.
		assert.match(stdout, /skipped 1 template with no story file/);
	});
});

test("check fails on a story that contradicts the declaration", async () => {
	await withProject(
		{
			...THEME,
			"snippets/price.stories.json": JSON.stringify({
				stories: [
					{ name: "typo", props: { prise: 2400 } },
					{ name: "wrong type", props: { price: "lots" } },
				],
			}),
		},
		async (cwd) => {
			const { status, stderr } = await runCli(cwd, "preview", "check", ".");

			assert.equal(status, 1);
			// The interface belongs to the Liquid, so each of these is the story
			// asserting something the declaration denies.
			assert.match(stderr, /prise is not a declared prop/);
			assert.match(stderr, /price is required and this story does not pass it/);
			assert.match(stderr, /price is "lots", and the prop is a number/);
		},
	);
});

test("check fails on a story file that declares an interface", async () => {
	await withProject(
		{
			...THEME,
			"snippets/price.stories.json": JSON.stringify({
				stories: [{ name: "on sale", argTypes: { price: {} } }],
			}),
		},
		async (cwd) => {
			const { status, stderr } = await runCli(cwd, "preview", "check", ".");

			assert.equal(status, 1);
			assert.match(stderr, /unknown key "argTypes"/);
		},
	);
});

test("check --json names what was skipped and what failed", async () => {
	await withProject(THEME, async (cwd) => {
		const { status, stdout } = await runCli(
			cwd,
			"preview",
			"check",
			".",
			"--json",
		);
		const report = JSON.parse(stdout);

		assert.equal(status, 0);
		assert.equal(report.components, 1);
		assert.equal(report.stories, 2);
		assert.deepEqual(report.failures, []);
		assert.deepEqual(report.undeclared, ["snippets/icon.liquid"]);
	});
});

test("build writes the workbench and saves where it wrote it", async () => {
	await withProject({ ...THEME, "nazare.theme.json": "{}" }, async (cwd) => {
		const { status, stdout } = await runCli(cwd, "preview", "build", ".");

		assert.equal(status, 0);
		assert.ok(existsSync(join(cwd, ".nazare-out/preview/index.html")));
		assert.ok(existsSync(join(cwd, ".nazare-out/preview/all.html")));
		// One document per story, named by its id.
		assert.ok(
			existsSync(join(cwd, ".nazare-out/preview/stories/price--on-sale.html")),
		);
		assert.match(stdout, /1 components, 2 stories/);

		// Asked once, then saved: the next build is a bare command. A
		// non-interactive stdin takes the default rather than blocking a script.
		const manifest = JSON.parse(
			readFileSync(join(cwd, "nazare.theme.json"), "utf8"),
		);
		assert.equal(manifest.preview.outDir, ".nazare-out/preview");
	});
});

test("build records the directory it read, and the commit when there is one", async () => {
	await withProject({ ...THEME, "nazare.theme.json": "{}" }, async (cwd) => {
		await runCli(cwd, "preview", "build", ".");
		const page = readFileSync(
			join(cwd, ".nazare-out/preview/index.html"),
			"utf8",
		);

		// The directory as the caller named it: "." and an absolute path describe
		// the same place, and only one of them is worth reading in a header.
		assert.match(page, /class="source-path">\.</);
		// Not a repository, so there is no revision to claim — and a preview is
		// not the place to insist on one. Matched as markup: the stylesheet
		// mentions the class whether or not anything uses it.
		assert.ok(!page.includes('<span class="source-rev"'));
	});
});

test("build takes the saved output directory on the next run", async () => {
	await withProject(
		{
			...THEME,
			"nazare.theme.json": JSON.stringify({ preview: { outDir: "docs/ui" } }),
		},
		async (cwd) => {
			const { status } = await runCli(cwd, "preview", "build", ".");

			assert.equal(status, 0);
			assert.ok(existsSync(join(cwd, "docs/ui/index.html")));
		},
	);
});

test("scaffold drafts a story file, and will not overwrite one", async () => {
	await withProject({ "snippets/price.liquid": PRICE }, async (cwd) => {
		const first = await runCli(
			cwd,
			"preview",
			"scaffold",
			"snippets/price.liquid",
		);
		assert.equal(first.status, 0);

		const drafted = JSON.parse(
			readFileSync(join(cwd, "snippets/price.stories.json"), "utf8"),
		);
		// A required prop is the one the declaration gives no default for, so the
		// draft states it rather than leaving the story to render a placeholder.
		assert.deepEqual(drafted.stories, [
			{ name: "default", props: { price: 0 } },
		]);
		// And the draft is valid on arrival: check passes on what scaffold wrote.
		assert.equal((await runCli(cwd, "preview", "check", ".")).status, 0);

		// The cases already in a story file were chosen by a person; this was not.
		const second = await runCli(
			cwd,
			"preview",
			"scaffold",
			"snippets/price.liquid",
		);
		assert.equal(second.status, 1);
		assert.match(second.stderr, /exists\. Re-run with --force/);
	});
});

test("a project's own fixtures are files it can read and change", async () => {
	const CARD = `{% doc %}
  @param {product} product - The product shown
{% enddoc %}
<h3>{{ product.title }}</h3>
`;
	await withProject(
		{
			"snippets/card.liquid": CARD,
			"snippets/card.stories.json": JSON.stringify({
				stories: [
					{
						name: "default",
						props: { product: { $file: "fixtures/product.json" } },
					},
				],
			}),
			// A fixture is shared because JSON cannot reasonably hold a product and
			// because the components taking one should agree about the shop. That
			// is a reason to share a file — not a reason for the file to live
			// inside the preview package where nobody can read it.
			"fixtures/product.json": JSON.stringify({ title: "Shop's own product" }),
		},
		async (cwd) => {
			const { status, stdout } = await runCli(cwd, "preview", "check", ".");
			assert.equal(status, 0, stdout);

			await runCli(cwd, "preview", "build", ".");
			const story = readFileSync(
				join(cwd, ".nazare-out/preview/stories/card--default.html"),
				"utf8",
			);
			// The project's file wins over the built-in stand-in.
			assert.match(story, /Shop's own product/);
			assert.ok(!story.includes("Merino Crew Sweater"));
		},
	);
});

test("a story names a file, not a fixture the preview knows about", async () => {
	const CARD = `{% doc %}
  @param {product} product - The product shown
{% enddoc %}
<h3>{{ product.title }}</h3>
`;
	await withProject(
		{
			"snippets/card.liquid": CARD,
			"snippets/card.stories.json": JSON.stringify({
				stories: [
					// A path, so there is no registry of names to know and the answer
					// to "what is this?" is a file you can open.
					{ name: "shop", props: { product: { $file: "data/hero.json" } } },
					{ name: "gone", props: { product: { $file: "data/nope.json" } } },
					{ name: "escape", props: { product: { $file: "../secret.json" } } },
					{ name: "broken", props: { product: { $file: "data/bad.json" } } },
				],
			}),
			"data/hero.json": JSON.stringify({ title: "Hand-picked product" }),
			"data/bad.json": '{ "title": ',
		},
		async (cwd) => {
			await writeFile(
				join(cwd, "..", "secret.json"),
				JSON.stringify({ title: "Not yours" }),
			).catch(() => {});

			const { status, stdout, stderr } = await runCli(
				cwd,
				"preview",
				"check",
				".",
			);

			// The one that reads renders; the one that does not is named, not
			// silently nil — a story that resolved to nothing would look plausible.
			assert.equal(status, 1, stdout);
			// And named by what is actually wrong with it. "does not read" for both
			// a missing file and a malformed one leaves the author looking for a
			// file they are staring at.
			assert.match(stderr, /data\/nope\.json: no such file/);
			// A story is data. It does not get to read outside what is previewed.
			assert.match(
				stderr,
				/\.\.\/secret\.json: resolves outside the previewed directory/,
			);
			assert.match(stderr, /data\/bad\.json: invalid JSON/);

			await runCli(cwd, "preview", "build", ".");
			assert.match(
				readFileSync(
					join(cwd, ".nazare-out/preview/stories/card--shop.html"),
					"utf8",
				),
				/Hand-picked product/,
			);
		},
	);
});

test("a directory that is neither a theme nor packages says so", async () => {
	await withProject({ "notes.md": "# nothing to preview\n" }, async (cwd) => {
		const { status, stderr } = await runCli(cwd, "preview", "check", ".");

		assert.equal(status, 1);
		assert.match(stderr, /Expected a theme .* or a directory of packages/);
	});

	// And a directory that is not there says *that*, because advice about
	// stories is the wrong thing to read when the path is simply wrong.
	await withProject({ "notes.md": "#\n" }, async (cwd) => {
		const { status, stderr } = await runCli(cwd, "preview", "check", "typo");

		assert.equal(status, 1);
		assert.match(stderr, /does not exist/);
	});
});

test("a theme with no story files at all points at scaffold without compiling", async () => {
	await withProject({ "snippets/icon.liquid": ICON }, async (cwd) => {
		const { collectPreview } = await previewCommand();
		const collection = await collectPreview(cwd);
		const { status, stderr } = await runCli(cwd, "preview", "check", ".");

		assert.deepEqual(collection.compiled, []);
		assert.equal(status, 1);
		assert.match(stderr, /No story files/);
		assert.match(stderr, /nazare preview scaffold/);
	});
});

// Compiling is memoised between collects, because `serve` recompiles the whole
// directory on every save and one component with a {% script %} block costs
// more than all the others together. The only thing worth testing about a cache
// is that it is never wrong: these edit a file and demand the new bytes back.
const previewCommand = async () =>
	await import(
		pathToFileURL(resolve("packages/cli-client/dist/preview-command.js")).href
	);

test("an edited template recompiles rather than serving the last one", async () => {
	await withProject(THEME, async (cwd) => {
		const { collectPreview } = await previewCommand();

		const before = await collectPreview(cwd);
		assert.match(before.previewed[0].component.template, /class="price"/);

		// Nothing changed, so nothing was compiled again — the same component, not
		// an equal one. Without this the test below would pass on a cache that
		// never hits, which is the other way to be wrong here.
		const unchanged = await collectPreview(cwd);
		assert.equal(
			unchanged.previewed[0].component,
			before.previewed[0].component,
		);

		await writeFile(
			join(cwd, "snippets/price.liquid"),
			PRICE.replace('class="price"', 'class="price price--loud"'),
		);

		const after = await collectPreview(cwd);
		assert.match(after.previewed[0].component.template, /price--loud/);
	});
});

test("a component recompiles when a component it imports changes", async () => {
	await withProject(
		{
			"ui/badge/nazare.json": JSON.stringify({
				id: "@acme/badge",
				version: "0.1.0",
				kind: "snippet",
				entry: "badge.nz.liquid",
				license: "MIT",
				files: ["badge.nz.liquid"],
			}),
			"ui/badge/badge.nz.liquid": `{% component snippet %}

{% props {
  text: string.setting({ label: "Text", default: "New" }),
} %}

<span class="badge">{{ props.text }}</span>
`,
			"ui/card/nazare.json": JSON.stringify({
				id: "@acme/card",
				version: "0.1.0",
				kind: "snippet",
				entry: "card.nz.liquid",
				license: "MIT",
				files: ["card.nz.liquid"],
				preview: { stories: [{ name: "default" }] },
			}),
			"ui/card/card.nz.liquid": `{% component snippet %}

{% import Badge from "../badge/badge.nz.liquid" %}

{% props {
  title: string.setting({ label: "Title", default: "Card" }),
} %}

<article class="card">
  <h3>{{ props.title }}</h3>
  {% render Badge { text: "New" } %}
</article>
`,
		},
		async (cwd) => {
			const { collectPreview, renderCollection } = await previewCommand();
			const dir = join(cwd, "ui");

			const before = await renderCollection(await collectPreview(dir));
			const card = before.find((one) => one.component.name === "card");
			assert.match(card.stories[0].html, /class="badge"/);

			// card.nz.liquid itself is untouched; only the component it imports
			// changed. The compile read that file, so the memo has to notice.
			await writeFile(
				join(cwd, "ui/badge/badge.nz.liquid"),
				`{% component snippet %}

{% props {
  text: string.setting({ label: "Text", default: "New" }),
} %}

<span class="badge badge--pill">{{ props.text }}</span>
`,
			);

			const after = await renderCollection(await collectPreview(dir));
			const recompiled = after.find((one) => one.component.name === "card");
			assert.match(recompiled.stories[0].html, /badge--pill/);
		},
	);
});

const SCRIPTED = {
	"ui/toggle/nazare.json": JSON.stringify({
		id: "@acme/toggle",
		version: "0.1.0",
		kind: "snippet",
		entry: "toggle.nz.liquid",
		license: "MIT",
		files: ["toggle.nz.liquid"],
		preview: { stories: [{ name: "default" }] },
	}),
	"ui/toggle/toggle.nz.liquid": `{% component snippet %}

{% props {
  label: string.setting({ label: "Label", default: "Toggle" }),
} %}

<button ref="trigger">{{ props.label }}</button>

{% script lang="js" %}
export default island(({ refs }) => {
  const count = "not a number";
  refs.trigger.addEventListener("click", () => console.log(count));
});
{% endscript %}
`,
};

test("JavaScript scripts do not require a type checker", async () => {
	await withProject(SCRIPTED, async (cwd) => {
		const { collectPreview } = await previewCommand();
		const dir = join(cwd, "ui");

		const preview = await collectPreview(dir);
		assert.equal(
			preview.compiled[0].component.issues.some((issue) =>
				issue.code.startsWith("SCRIPT_"),
			),
			false,
		);
		assert.match(preview.compiled[0].component.template, /<button/);
	});
});

test("packages are detected by their manifests, not by a flag", async () => {
	await withProject(
		{
			"ui/price/nazare.json": JSON.stringify({
				id: "@acme/price",
				version: "0.1.0",
				kind: "snippet",
				entry: "price.liquid",
				license: "MIT",
				files: ["price.liquid"],
				preview: { stories: [{ name: "on sale", props: { price: 2400 } }] },
			}),
			"ui/price/price.liquid": PRICE,
		},
		async (cwd) => {
			const { status, stdout } = await runCli(cwd, "preview", "check", "ui");

			assert.equal(status, 0);
			assert.match(stdout, /1 components, 1 stories, 0 problems/);
		},
	);
});
