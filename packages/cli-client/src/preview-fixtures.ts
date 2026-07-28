// `nazare preview fixtures` — the stand-in data, as files the project owns.
//
//   nazare preview fixtures init [dir]              copy starter files in
//   nazare preview fixtures pull <handle> [dir]     fetch one from a store
//
// A fixture is shared because JSON cannot reasonably hold a product with its
// images and variants, and because the components that take one should agree
// about the shop. That is a reason to share a *file* — which is why these are
// written into the project rather than kept in this package, the same way a
// registry component is copied in and becomes yours.
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { starterFixtures } from "@nazare/preview";
import { isMissingFileError } from "./inspect-input.js";
import type { CliOptions } from "./options.js";
import type { Output } from "./output.js";

const FIXTURES_DIR = "fixtures";

/**
 * Where a storefront will hand you its own product in the shape Liquid uses.
 *
 * The Admin API is the obvious place to ask and the wrong one: it answers with
 * its own shape — `"24.00"` where Liquid has `2400`, `featuredImage.url` where
 * Liquid has an image drop — so a fixture built from it needs a hand-written
 * translation that can quietly disagree with the runtime. The storefront's
 * `.js` endpoint returns the product drop nearly verbatim, in cents, and needs
 * no token to read a public product.
 */
const productUrl = (store: string, handle: string): string => {
	const host = store.replace(/^https?:\/\//, "").replace(/\/$/, "");
	return `https://${host}/products/${encodeURIComponent(handle)}.js`;
};

async function writeFixture(
	dir: string,
	name: string,
	value: unknown,
	{
		force,
		output,
		projectRoot,
	}: {
		force: boolean;
		output: Output;
		projectRoot: string;
	},
): Promise<boolean> {
	const path = join(dir, FIXTURES_DIR, `${name}.json`);
	// No fixtures directory yet is the normal case on a first run; anything else
	// going wrong with it is not, and is not something to answer by writing.
	const existing = await readdir(join(dir, FIXTURES_DIR)).catch(
		(error): string[] => {
			if (isMissingFileError(error)) return [];
			throw new Error(
				`Unable to read ${join(dir, FIXTURES_DIR)}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		},
	);
	if (existing.includes(`${name}.json`) && !force) {
		output.error(
			`${relative(projectRoot, path)} exists. Re-run with --force to overwrite it.`,
		);
		return false;
	}
	await mkdir(join(dir, FIXTURES_DIR), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
	output.log(relative(projectRoot, path));
	return true;
}

/**
 * Copies starter stand-ins into project files. Stories resolve only explicit
 * `$file` paths; package copies are scaffolding input, never runtime defaults.
 */
export async function runFixturesInit(
	projectRoot: string,
	dir: string,
	cliOptions: CliOptions,
	output: Output,
): Promise<number> {
	let written = 0;
	for (const [name, value] of Object.entries(starterFixtures)) {
		if (
			await writeFixture(dir, name, value, {
				force: Boolean(cliOptions.force),
				output,
				projectRoot,
			})
		) {
			written += 1;
		}
	}
	if (written === 0) return 1;
	output.log(
		`${written} fixture${written === 1 ? "" : "s"} — yours now; reference one with { "$file": "fixtures/<name>.json" }.`,
	);
	return 0;
}

/**
 * Fetches one product from a live storefront and writes it as a fixture.
 *
 * What lands is what the store actually holds: a real title length, a real
 * image, the variants that exist, whether it is on sale today. A fixture is
 * tidy in ways a catalogue is not, and this is the way to stop it being tidy.
 */
export async function runFixturesPull(
	projectRoot: string,
	dir: string,
	handle: string,
	cliOptions: CliOptions,
	output: Output,
	fetchImpl: typeof fetch = fetch,
): Promise<number> {
	if (!cliOptions.store) {
		output.error(
			"Pulling a fixture needs a store: nazare preview fixtures pull <handle> --store <shop>.myshopify.com",
		);
		return 1;
	}
	const url = productUrl(cliOptions.store, handle);
	output.error(`Fetching ${url}`);

	let payload: unknown;
	try {
		const response = await fetchImpl(url, {
			headers: { accept: "application/json" },
		});
		if (!response.ok) {
			output.error(
				`${url} answered ${response.status}. Check the handle and that the product is published to the online store.`,
			);
			return 1;
		}
		payload = await response.json();
	} catch (error) {
		output.error(
			`Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
		);
		return 1;
	}

	const product = payload as { handle?: unknown; title?: unknown };
	if (!product || typeof product !== "object" || !product.title) {
		output.error(`${url} did not answer with a product`);
		return 1;
	}

	const name = typeof cliOptions.as === "string" ? cliOptions.as : "product";
	const ok = await writeFixture(dir, name, product, {
		force: Boolean(cliOptions.force),
		output,
		projectRoot,
	});
	if (!ok) return 1;
	output.log(`${String(product.title)} — real data, with whatever it has`);
	return 0;
}
