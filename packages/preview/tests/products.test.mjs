import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fingerprintProductKey } from "@nazare/compiler/computation";
import {
	createProjectSession,
	defineInputProvider,
	defineProjectHost,
	projectFileId,
} from "@nazare/compiler/project";
import {
	createDefaultSourceFrontendRegistry,
	createSourceProductRegistrar,
} from "@nazare/compiler/source-products";
import {
	createPreviewProductRegistrar,
	PreviewProjectSession,
	previewProducts,
} from "../dist/index.js";

const id = (path) =>
	projectFileId({ workspace: "test", package: "preview", path });

async function createSession(sources) {
	const files = new Map(
		Object.entries(sources).map(([path, contents]) => [
			path,
			{ id: id(path), contents },
		]),
	);
	const host = defineProjectHost({
		files: defineInputProvider({
			id: "test.preview-files",
			version: 1,
			async read(fileId) {
				const value = files.get(fileId.path);
				if (!value) throw new Error(`Missing preview input ${fileId.path}`);
				return { value, fingerprint: fingerprintProductKey(value.contents) };
			},
		}),
		async discover() {
			return [...files.values()].map((file) => file.id);
		},
	});
	const session = await createProjectSession({ host });
	createSourceProductRegistrar({
		host,
		frontends: createDefaultSourceFrontendRegistry(),
	}).registerComputations(session.graph);
	createPreviewProductRegistrar().registerComputations(session.graph);
	session.updateFile = async (path, contents) => {
		files.set(path, { id: id(path), contents });
		const update = await session.apply({
			kind: "files",
			changes: [
				{
					kind: "changed",
					key: id(path),
					fingerprint: fingerprintProductKey(contents),
				},
			],
		});
		assert.equal(update.committed, true);
	};
	return session;
}

test("discovers authored stories through a story-file product", async () => {
	const session = await createSession({
		"snippets/card.stories.json": JSON.stringify({
			stories: [{ name: "default", props: { title: "Hello" } }],
		}),
	});
	const result = await session.get(
		previewProducts.story.product(id("snippets/card.stories.json")),
	);
	assert.deepEqual(result.stories, [
		{ name: "default", props: { title: "Hello" } },
	]);
	assert.deepEqual(
		result.componentCandidates.map((file) => file.path),
		["snippets/card.nz.liquid", "snippets/card.liquid"],
	);
	assert.deepEqual(result.diagnostics, []);
});

test("owns malformed story diagnostics on the story product", async () => {
	const session = await createSession({
		"snippets/card.stories.json":
			'{"stories":[{"name":"same"},{"name":"same"}]}',
	});
	const product = previewProducts.story.product(
		id("snippets/card.stories.json"),
	);
	const result = await session.get(product);
	const metadata = await session.graph.metadata(product, {
		revision: session.snapshot().revision,
	});
	assert.equal(result.stories.length, 0);
	assert.equal(result.diagnostics[0].code, "PREVIEW_STORY_INVALID");
	assert.equal(metadata.diagnostics[0].code, "PREVIEW_STORY_INVALID");
});

test("builds a preview model from component, story, and fixture products", async () => {
	const session = await createSession({
		"snippets/card.liquid": "<article>{{ product.title }}</article>",
		"snippets/card.stories.json": JSON.stringify({
			stories: [
				{
					name: "fixture",
					props: { product: { $file: "fixtures/product.json" } },
				},
			],
		}),
		"fixtures/product.json": '{"title":"Hat","price":2400}',
	});
	const result = await session.get(
		previewProducts.model.product({
			component: id("snippets/card.liquid"),
			story: id("snippets/card.stories.json"),
			files: [id("snippets/card.liquid")],
		}),
	);
	assert.equal(result.component.file, "snippets/card.liquid");
	assert.deepEqual(result.stories[0].props.product, {
		title: "Hat",
		price: 2400,
	});
	assert.deepEqual(
		result.dependencies.map((file) => file.path),
		["snippets/card.liquid"],
	);
	assert.deepEqual(result.diagnostics, []);
});

test("renders story products independently through a concurrent pure plan", async () => {
	const session = await createSession({
		"snippets/card.liquid": "<article>{{ title }}</article>",
		"snippets/card.stories.json": JSON.stringify({
			stories: [
				{ name: "first", props: { title: "One" } },
				{ name: "second", props: { title: "Two" } },
			],
		}),
	});
	const model = {
		component: id("snippets/card.liquid"),
		story: id("snippets/card.stories.json"),
		files: [id("snippets/card.liquid")],
	};
	const plan = await session.get(previewProducts.renderPlan.product({ model }));
	assert.deepEqual(
		plan.stories.map((story) => story.id),
		["card--first", "card--second"],
	);
	assert.match(plan.stories[0].html, /One/);
	assert.match(plan.stories[1].html, /Two/);
});

test("invalidates only preview products that depend on an edited file", async () => {
	const session = await createSession({
		"snippets/card.liquid": "<article>Before {{ title }}</article>",
		"snippets/card.stories.json": JSON.stringify({
			stories: [{ name: "default", props: { title: "Hello" } }],
		}),
		"snippets/unrelated.liquid": "<div>Unrelated</div>",
	});
	const model = {
		component: id("snippets/card.liquid"),
		story: id("snippets/card.stories.json"),
		files: [id("snippets/card.liquid"), id("snippets/unrelated.liquid")],
	};
	const product = previewProducts.renderPlan.product({ model });
	const before = await session.get(product);
	await session.updateFile(
		"snippets/unrelated.liquid",
		"<div>Changed but unrelated</div>",
	);
	const afterUnrelatedEdit = await session.get(product);
	assert.equal(afterUnrelatedEdit, before);

	await session.updateFile(
		"snippets/card.liquid",
		"<article>After {{ title }}</article>",
	);
	const afterComponentEdit = await session.get(product);
	assert.notEqual(afterComponentEdit, before);
	assert.match(afterComponentEdit.stories[0].html, /After Hello/);
});

test("opens preview products over the shared filesystem project session", async () => {
	const root = mkdtempSync(join(tmpdir(), "nazare-preview-products-"));
	try {
		await mkdir(join(root, "snippets"), { recursive: true });
		await writeFile(
			join(root, "snippets/card.liquid"),
			"<article>{{ title }}</article>",
		);
		await writeFile(
			join(root, "snippets/card.stories.json"),
			JSON.stringify({
				stories: [{ name: "default", props: { title: "Hello" } }],
			}),
		);
		const session = await PreviewProjectSession.open(root);
		const rendered = await session.render(
			"snippets/card.liquid",
			"snippets/card.stories.json",
		);
		assert.match(rendered.stories[0].html, /Hello/);
		assert.ok(session.revision >= 1);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("reads fixture JSON as a revisioned project input", async () => {
	const session = await createSession({
		"fixtures/product.json": '{"title":"Hat","price":2400}',
	});
	const result = await session.get(
		previewProducts.fixture.product(id("fixtures/product.json")),
	);
	assert.deepEqual(result.value, { title: "Hat", price: 2400 });
	assert.deepEqual(result.diagnostics, []);
});
