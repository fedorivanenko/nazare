// `nazare preview fixtures` — the stand-in data, as files the project owns.
//
// The fetch is stubbed. What is worth holding is not that HTTP works but that
// what lands on disk is the shape Liquid renders against, and that a failure
// says which of the three things went wrong: no store, no such product, no
// network.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const load = async () =>
	await import(
		pathToFileURL(resolve("packages/cli-client/dist/preview-fixtures.js")).href
	);

function collect() {
	const lines = { log: [], error: [] };
	return {
		lines,
		output: {
			log: (...values) => lines.log.push(values.join(" ")),
			error: (...values) => lines.error.push(values.join(" ")),
		},
	};
}

async function withDir(fn) {
	const dir = mkdtempSync(join(tmpdir(), "nazare-fixtures-"));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** What a storefront's `.js` endpoint answers with: the Liquid drop, in cents. */
const AJAX_PRODUCT = {
	id: 42,
	title: "Real Merino Crew",
	handle: "real-merino",
	price: 3150,
	compare_at_price: 4500,
	available: true,
	featured_image: "https://cdn.shopify.com/s/files/1/x.jpg",
	variants: [{ id: 1, title: "S", price: 3150, available: true }],
};

test("init copies the built-in stand-ins into the project", async () => {
	await withDir(async (dir) => {
		const { runFixturesInit } = await load();
		const { lines, output } = collect();

		assert.equal(await runFixturesInit(dir, dir, {}, output), 0);
		// Until this runs they are defaults inside the preview package, which is
		// the part nobody can read or diff. Afterwards they are ordinary JSON.
		const product = JSON.parse(
			readFileSync(join(dir, "fixtures/product.json"), "utf8"),
		);
		assert.equal(product.title, "Merino Crew Sweater");
		assert.ok(lines.log.some((line) => line.includes("yours now")));

		// The ones already there were chosen by someone; this was not.
		const second = collect();
		assert.equal(await runFixturesInit(dir, dir, {}, second.output), 1);
		assert.ok(
			second.lines.error.some((line) => line.includes("Re-run with --force")),
		);
	});
});

test("pull writes what the storefront holds, in the shape Liquid reads", async () => {
	await withDir(async (dir) => {
		const { runFixturesPull } = await load();
		const { output } = collect();
		let asked;

		const status = await runFixturesPull(
			dir,
			dir,
			"real-merino",
			{ store: "example.myshopify.com" },
			output,
			async (url) => {
				asked = url;
				return { ok: true, json: async () => AJAX_PRODUCT };
			},
		);

		assert.equal(status, 0);
		// The Admin API would answer "31.50" and featuredImage.url; the
		// storefront's .js endpoint answers with the product drop itself, so
		// nothing has to be translated and nothing can quietly disagree.
		assert.equal(
			asked,
			"https://example.myshopify.com/products/real-merino.js",
		);
		const written = JSON.parse(
			readFileSync(join(dir, "fixtures/product.json"), "utf8"),
		);
		assert.equal(written.price, 3150);
		assert.equal(written.title, "Real Merino Crew");

		// A protocol on the store is tolerated rather than doubled.
		await rm(join(dir, "fixtures"), { recursive: true, force: true });
		await runFixturesPull(
			dir,
			dir,
			"real-merino",
			{ store: "https://example.myshopify.com/" },
			output,
			async (url) => {
				asked = url;
				return { ok: true, json: async () => AJAX_PRODUCT };
			},
		);
		assert.equal(
			asked,
			"https://example.myshopify.com/products/real-merino.js",
		);
	});
});

test("pull names which of the three things went wrong", async () => {
	await withDir(async (dir) => {
		const { runFixturesPull } = await load();

		const noStore = collect();
		assert.equal(
			await runFixturesPull(dir, dir, "x", {}, noStore.output, async () => {
				throw new Error("should not be reached");
			}),
			1,
		);
		assert.ok(
			noStore.lines.error.some((line) => line.includes("needs a store")),
		);

		const missing = collect();
		assert.equal(
			await runFixturesPull(
				dir,
				dir,
				"x",
				{ store: "s.myshopify.com" },
				missing.output,
				async () => ({ ok: false, status: 404 }),
			),
			1,
		);
		assert.ok(
			missing.lines.error.some((line) =>
				line.includes("published to the online store"),
			),
		);

		const offline = collect();
		assert.equal(
			await runFixturesPull(
				dir,
				dir,
				"x",
				{ store: "s.myshopify.com" },
				offline.output,
				async () => {
					throw new Error("getaddrinfo ENOTFOUND");
				},
			),
			1,
		);
		assert.ok(
			offline.lines.error.some((line) => line.includes("Could not reach")),
		);
	});
});

test("a pulled fixture is what a story then renders against", async () => {
	await withDir(async (dir) => {
		const { runFixturesPull } = await load();
		const { collectPreview, renderCollection } = await import(
			pathToFileURL(resolve("packages/cli-client/dist/preview-command.js")).href
		);

		await mkdir(join(dir, "snippets"), { recursive: true });
		await writeFile(
			join(dir, "snippets/card.liquid"),
			`{% doc %}\n  @param {product} product - The product shown\n{% enddoc %}\n<h3>{{ product.title }}</h3>\n`,
		);
		await writeFile(
			join(dir, "snippets/card.stories.json"),
			JSON.stringify({
				stories: [
					{ name: "default", props: { product: { $fixture: "product" } } },
				],
			}),
		);

		await runFixturesPull(
			dir,
			dir,
			"real-merino",
			{ store: "example.myshopify.com" },
			collect().output,
			async () => ({ ok: true, json: async () => AJAX_PRODUCT }),
		);

		const rendered = await renderCollection(await collectPreview(dir));
		// The whole point of pulling: the story renders against a real title, of
		// a real length, rather than one a fixture kept tidy.
		assert.match(rendered[0].stories[0].html, /Real Merino Crew/);
	});
});
