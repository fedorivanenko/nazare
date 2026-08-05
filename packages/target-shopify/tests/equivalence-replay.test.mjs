import assert from "node:assert/strict";
import test from "node:test";
import {
	createCapabilityRegistry,
	fingerprintProductKey,
} from "@nazare/compiler/computation";
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
	shopifyProducts,
	shopifyQueryProducts,
	shopifySemanticTarget,
} from "../dist/index.js";

const id = (path) =>
	projectFileId({ workspace: "test", package: "theme", path });

async function openProject(entries) {
	const files = new Map(
		entries.map(([path, contents]) => [path, { id: id(path), contents }]),
	);
	const host = defineProjectHost({
		files: defineInputProvider({
			id: "test.equivalence-files",
			version: 1,
			async read(file) {
				const value = files.get(file.path);
				if (!value) throw new Error(`Missing ${file.path}`);
				return {
					value,
					fingerprint: fingerprintProductKey(value.contents),
				};
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
	createCapabilityRegistry([shopifySemanticTarget()]).registerComputations(
		session.graph,
	);
	return { files, session };
}

const projectModel = (session) =>
	session.get(
		shopifyQueryProducts.projectModel.product({
			files: session.snapshot().fileIds,
		}),
	);

const CANONICAL_THEME = [
	["templates/index.liquid", "{% section 'main' %}"],
	[
		"sections/main.liquid",
		'{% render \'card\' %}{% schema %}{"name":"Main"}{% endschema %}',
	],
	["snippets/card.liquid", "<article>{{ product.title }}</article>"],
	["assets/theme.css", ".card { --accent: red; color: var(--accent) }"],
];

test("canonical theme model is equivalent across discovery orders", async () => {
	const forward = await openProject(CANONICAL_THEME);
	const reverse = await openProject(CANONICAL_THEME.toReversed());

	assert.deepEqual(
		await projectModel(forward.session),
		await projectModel(reverse.session),
	);
});

test("dependency edge additions and removals update the project graph", async () => {
	const project = await openProject([
		["sections/main.liquid", "<main>Main</main>"],
		["snippets/card.liquid", "<article>Card</article>"],
	]);
	const graph = async () =>
		project.session.get(
			shopifyQueryProducts.projectGraph.product({
				files: project.session.snapshot().fileIds,
			}),
		);
	assert.equal((await graph()).graph.edges.length, 0);

	const path = "sections/main.liquid";
	const changed = "{% render 'card' %}<main>Main</main>";
	project.files.set(path, { id: id(path), contents: changed });
	await project.session.apply({
		kind: "files",
		changes: [
			{
				kind: "changed",
				key: id(path),
				fingerprint: fingerprintProductKey(changed),
			},
		],
	});
	assert.equal((await graph()).graph.edges.length, 1);

	const restored = "<main>Main</main>";
	project.files.set(path, { id: id(path), contents: restored });
	await project.session.apply({
		kind: "files",
		changes: [
			{
				kind: "changed",
				key: id(path),
				fingerprint: fingerprintProductKey(restored),
			},
		],
	});
	assert.equal((await graph()).graph.edges.length, 0);
});

test("path moves recompute target roles without changing file contents", async () => {
	const project = await openProject([
		["snippets/card.liquid", "<article>Card</article>"],
	]);
	const before = id("snippets/card.liquid");
	const after = id("sections/card.liquid");
	const contents = project.files.get(before.path).contents;
	assert.equal(
		(await project.session.get(shopifyProducts.classification.product(before))).role,
		"snippet",
	);

	project.files.delete(before.path);
	project.files.set(after.path, { id: after, contents });
	await project.session.apply({
		kind: "files",
		changes: [
			{
				kind: "moved",
				from: before,
				key: after,
				fingerprint: fingerprintProductKey(contents),
			},
		],
	});

	assert.equal(
		(await project.session.get(shopifyProducts.classification.product(after))).role,
		"section",
	);
});

test("edit replay converges to the original canonical theme model", async () => {
	const project = await openProject(CANONICAL_THEME);
	const initial = await projectModel(project.session);
	const path = "snippets/card.liquid";
	const original = project.files.get(path).contents;
	const changed = `${original}{{ product.metafields.custom.subtitle.value }}`;

	project.files.set(path, { id: id(path), contents: changed });
	await project.session.apply({
		kind: "files",
		changes: [
			{
				kind: "changed",
				key: id(path),
				fingerprint: fingerprintProductKey(changed),
			},
		],
	});
	assert.notDeepEqual(await projectModel(project.session), initial);

	project.files.set(path, { id: id(path), contents: original });
	await project.session.apply({
		kind: "files",
		changes: [
			{
				kind: "changed",
				key: id(path),
				fingerprint: fingerprintProductKey(original),
			},
		],
	});
	assert.deepEqual(await projectModel(project.session), initial);
});
