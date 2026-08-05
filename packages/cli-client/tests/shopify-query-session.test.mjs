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

test("persistent builds commit output and reconciliation metadata together", async () => {
	const projectRoot = await mkdtemp(
		join(tmpdir(), "nazare-persistent-session-"),
	);
	const outputRoot = join(projectRoot, "theme-output");
	await mkdir(join(outputRoot, "config"), { recursive: true });
	await mkdir(join(outputRoot, "locales"), { recursive: true });
	await writeFile(
		join(outputRoot, "config/settings_data.json"),
		JSON.stringify({ current: { old: "value" } }),
	);
	await writeFile(
		join(outputRoot, "locales/en.default.json"),
		JSON.stringify({ title: "merchant" }),
	);
	await writeFile(
		join(projectRoot, "nazare.migrations.json"),
		JSON.stringify({
			migrations: [
				{ id: "rename", op: "renameSetting", from: "old", to: "current" },
			],
		}),
	);
	await writeFile(
		join(projectRoot, "nazare.locales-base.json"),
		JSON.stringify({ "locales/en.default.json": { title: "base" } }),
	);
	const session = await ShopifyQuerySession.create([
		{ path: "config/settings_data.json", contents: "{}" },
		{
			path: "locales/en.default.json",
			contents: JSON.stringify({ title: "developer", added: "new" }),
		},
	]);

	await session.publishPersistentBuild(
		{ scope: { kind: "workspace" } },
		{ projectRoot, outputRoot, targetId: "shop#theme" },
	);

	const settings = JSON.parse(
		await readFile(join(outputRoot, "config/settings_data.json"), "utf8"),
	);
	assert.equal(settings.current.current, "value");
	assert.deepEqual(
		JSON.parse(
			await readFile(join(outputRoot, "locales/en.default.json"), "utf8"),
		),
		{ title: "merchant", added: "new" },
	);
	assert.deepEqual(
		JSON.parse(
			await readFile(
				join(projectRoot, "nazare.migrations-applied.json"),
				"utf8",
			),
		).applied["shop#theme"],
		["rename"],
	);
	assert.deepEqual(
		JSON.parse(
			await readFile(join(projectRoot, "nazare.locales-base.json"), "utf8"),
		),
		{ "locales/en.default.json": { title: "developer", added: "new" } },
	);
	assert.equal(
		JSON.parse(
			await readFile(join(projectRoot, "nazare.schema-lock.json"), "utf8"),
		).version,
		1,
	);
});

test("persistent build failure rolls output and metadata back together", async () => {
	const projectRoot = await mkdtemp(
		join(tmpdir(), "nazare-persistent-rollback-"),
	);
	const outputRoot = join(projectRoot, "a-output");
	await mkdir(join(outputRoot, "config"), { recursive: true });
	await writeFile(
		join(outputRoot, "config/settings_data.json"),
		JSON.stringify({ current: { merchant: true } }),
	);
	await mkdir(join(outputRoot, "z-bad"));
	const session = await ShopifyQuerySession.create([
		{ path: "config/settings_data.json", contents: "{}" },
		{ path: "z-bad", contents: "generated" },
	]);

	await assert.rejects(
		session.publishPersistentBuild(
			{ scope: { kind: "workspace" } },
			{ projectRoot, outputRoot, targetId: "theme" },
		),
		/Output path is not a regular file/,
	);
	assert.deepEqual(
		JSON.parse(
			await readFile(join(outputRoot, "config/settings_data.json"), "utf8"),
		),
		{ current: { merchant: true } },
	);
	await assert.rejects(
		readFile(join(projectRoot, "nazare.locales-base.json"), "utf8"),
		{ code: "ENOENT" },
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
