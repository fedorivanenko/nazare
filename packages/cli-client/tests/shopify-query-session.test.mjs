import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ShopifyQuerySession } from "../dist/shopify-query-session.js";

test("shared Shopify session plans and publishes reachable build output", async () => {
	const session = await ShopifyQuerySession.create([
		{ path: "templates/index.liquid", contents: "{% render 'card' %}" },
		{ path: "snippets/card.liquid", contents: "<span>Card</span>" },
		{ path: "snippets/unused.liquid", contents: "Unused" },
	]);
	const request = {
		scope: { kind: "closure", root: "templates/index.liquid" },
	};
	const products = await session.buildProducts(request);
	assert.deepEqual(
		products.model.files.map((file) => file.path),
		["snippets/card.liquid", "templates/index.liquid"],
	);

	const temporary = await mkdtemp(join(tmpdir(), "nazare-build-session-"));
	const outputRoot = join(temporary, "theme");
	await session.publishBuild(request, outputRoot);
	assert.equal(
		await readFile(join(outputRoot, "snippets/card.liquid"), "utf8"),
		"<span>Card</span>",
	);
	await assert.rejects(
		readFile(join(outputRoot, "snippets/unused.liquid"), "utf8"),
		{ code: "ENOENT" },
	);
});

test("publication refuses unowned and modified output conflicts", async () => {
	const session = await ShopifyQuerySession.create([
		{ path: "snippets/card.liquid", contents: "generated" },
	]);
	const request = { scope: { kind: "workspace" } };
	const temporary = await mkdtemp(join(tmpdir(), "nazare-owned-session-"));
	const unownedRoot = join(temporary, "unowned");
	await mkdir(join(unownedRoot, "snippets"), { recursive: true });
	await writeFile(join(unownedRoot, "snippets/card.liquid"), "merchant");
	await assert.rejects(session.publishBuild(request, unownedRoot), (error) => {
		assert.equal(error.diagnostics[0].code, "OUTPUT_PATH_NOT_OWNED");
		return true;
	});
	assert.equal(
		await readFile(join(unownedRoot, "snippets/card.liquid"), "utf8"),
		"merchant",
	);

	const ownedRoot = join(temporary, "owned");
	await session.publishBuild(request, ownedRoot);
	await writeFile(join(ownedRoot, "snippets/card.liquid"), "merchant edit");
	await assert.rejects(session.publishBuild(request, ownedRoot), (error) => {
		assert.equal(error.diagnostics[0].code, "OUTPUT_OWNED_FILE_MODIFIED");
		return true;
	});
	assert.equal(
		await readFile(join(ownedRoot, "snippets/card.liquid"), "utf8"),
		"merchant edit",
	);
});

test("check-only session builds never plan output deletion", async () => {
	const session = await ShopifyQuerySession.create([
		{ path: "templates/index.liquid", contents: "Index" },
	]);
	const products = await session.buildProducts({
		scope: { kind: "workspace" },
		checkOnly: true,
		previouslyOwnedPaths: ["assets/previous.js"],
	});
	assert.deepEqual(products.emission.files, []);
	assert.deepEqual(products.ownedOutput.deletes, []);

	const temporary = await mkdtemp(join(tmpdir(), "nazare-check-session-"));
	const outputRoot = join(temporary, "theme");
	await mkdir(join(outputRoot, "assets"), { recursive: true });
	await writeFile(join(outputRoot, "assets/previous.js"), "previous");
	await assert.rejects(
		session.publishBuild(
			{
				scope: { kind: "workspace" },
				checkOnly: true,
				previouslyOwnedPaths: ["assets/previous.js"],
			},
			outputRoot,
		),
		/Check-only builds cannot publish output/,
	);
	assert.equal(
		await readFile(join(outputRoot, "assets/previous.js"), "utf8"),
		"previous",
	);
});
