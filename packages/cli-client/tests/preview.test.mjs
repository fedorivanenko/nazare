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
					{ name: "default", props: { product: { $fixture: "product" } } },
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

test("a directory that is neither a theme nor packages says so", async () => {
	await withProject({ "notes.md": "# nothing to preview\n" }, async (cwd) => {
		const { status, stderr } = await runCli(cwd, "preview", "check", ".");

		assert.equal(status, 1);
		assert.match(stderr, /Expected a theme .* or a directory of packages/);
	});
});

test("a theme with no story files at all points at scaffold", async () => {
	await withProject({ "snippets/icon.liquid": ICON }, async (cwd) => {
		const { status, stderr } = await runCli(cwd, "preview", "check", ".");

		assert.equal(status, 1);
		assert.match(stderr, /No story files/);
		assert.match(stderr, /nazare preview scaffold/);
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
