import assert from "node:assert/strict";
import test from "node:test";
import {
	createThemeDeclarationPass,
	createThemeReferencePass,
	createThemeResolutionPass,
	fixedPointThemePass,
	incrementalThemePass,
	ThemeFactStore,
	ThemePassScheduler,
	ThemeRenderDependencyIndex,
} from "../dist/index.js";

test("theme pass scheduler propagates typed changes forward deterministically", () => {
	const scheduler = new ThemePassScheduler([
		incrementalThemePass({
			name: "facts",
			stage: "facts",
			routes: [{ kind: "declarationChanged", target: "declarations" }],
			collectChanges: (changes) =>
				new Set(
					changes
						.filter((change) => change.kind === "sourceChanged")
						.map((change) => change.path),
				),
			run: (paths) => ({
				records: [...paths],
				changes: [...paths].map((path) => ({
					kind: "declarationChanged",
					key: `snippet:${path}`,
				})),
			}),
		}),
		incrementalThemePass({
			name: "declarations",
			stage: "declarations",
			routes: [{ kind: "referenceChanged", target: "references" }],
			collectChanges: (changes) =>
				new Set(
					changes
						.filter((change) => change.kind === "declarationChanged")
						.map((change) => change.key),
				),
			run: (keys) => ({
				records: [...keys],
				changes: [...keys].map((id) => ({ kind: "referenceChanged", id })),
			}),
		}),
	]);
	const result = scheduler.execute(
		[{ kind: "sourceChanged", path: "snippets/card.liquid" }],
		{},
	);
	assert.deepEqual(
		result.trace.map((entry) => entry.pass),
		["facts", "declarations"],
	);
	assert.ok(
		result.changes.some((change) => change.kind === "referenceChanged"),
	);
});

test("declaration and reference passes replace per-source outputs", () => {
	const path = "snippets/card.liquid";
	const facts = new ThemeFactStore([
		{ kind: "file", path, fileKind: "snippet" },
		{ kind: "declaresSnippet", path, name: "card" },
		{
			kind: "rendersSnippet",
			fromPath: path,
			targetName: "icon",
			siteId: `${path}@1:1`,
			invocationKind: "render",
			static: true,
		},
	]);
	const context = {
		facts,
		resultsBySource: new Map(),
		referencesBySource: new Map(),
		ids: {
			file: (sourcePath) => `file:${sourcePath}`,
			declaration: (kind, sourcePath, name) => `${kind}:${sourcePath}:${name}`,
		},
		id: (reference) =>
			`ref:${reference.kind}:${reference.fromPath}:${reference.targetName}`,
	};
	const scheduler = new ThemePassScheduler([
		incrementalThemePass(createThemeDeclarationPass()),
		incrementalThemePass(createThemeReferencePass()),
	]);
	const initial = scheduler.execute([{ kind: "factsChanged", path }], context);
	assert.equal(context.resultsBySource.get(path).declarations[0].name, "card");
	assert.equal(context.referencesBySource.get(path)[0].targetName, "icon");
	assert.ok(
		initial.changes.some(
			(change) =>
				change.kind === "declarationChanged" && change.key === "snippet:card",
		),
	);

	facts.replaceFile(path, [
		{ kind: "file", path, fileKind: "snippet" },
		{ kind: "declaresSnippet", path, name: "tile" },
	]);
	const update = scheduler.execute([{ kind: "factsChanged", path }], context);
	assert.equal(context.resultsBySource.get(path).declarations[0].name, "tile");
	assert.equal(context.referencesBySource.has(path), false);
	assert.ok(
		update.changes.some(
			(change) =>
				change.kind === "declarationChanged" && change.key === "snippet:card",
		),
	);
	assert.ok(
		update.changes.some(
			(change) =>
				change.kind === "declarationChanged" && change.key === "snippet:tile",
		),
	);
	assert.ok(
		update.changes.some((change) => change.kind === "referenceChanged"),
	);
});

test("resolution pass recomputes only references under changed target keys", () => {
	const card = {
		id: "snippet:snippets/card.liquid:card",
		kind: "snippet",
		path: "snippets/card.liquid",
		name: "card",
	};
	const tile = {
		id: "snippet:snippets/tile.liquid:tile",
		kind: "snippet",
		path: "snippets/tile.liquid",
		name: "tile",
	};
	const cardReference = {
		id: "ref:card",
		kind: "rendersSnippet",
		fromPath: "sections/main.liquid",
		targetKind: "snippet",
		targetName: "card",
		static: true,
	};
	const tileReference = {
		id: "ref:tile",
		kind: "rendersSnippet",
		fromPath: "sections/other.liquid",
		targetKind: "snippet",
		targetName: "tile",
		static: true,
		resolvedDeclarationId: tile.id,
	};
	const context = {
		declarationsByKey: new Map([
			["snippet:card", new Map([[card.id, card]])],
			["snippet:tile", new Map([[tile.id, tile]])],
		]),
		referencesById: new Map([
			[cardReference.id, cardReference],
			[tileReference.id, tileReference],
		]),
		referencesByTargetKey: new Map([
			["snippet:card", new Map([[cardReference.id, cardReference]])],
			["snippet:tile", new Map([[tileReference.id, tileReference]])],
		]),
		resolvedReferencesById: new Map([[tileReference.id, tileReference]]),
	};
	const pass = createThemeResolutionPass();
	const keys = pass.collectChanges(
		[{ kind: "declarationChanged", key: "snippet:card" }],
		context,
	);
	const delta = pass.run(keys, context);
	assert.deepEqual(
		delta.records.map((reference) => reference.id),
		[cardReference.id],
	);
	assert.equal(
		context.resolvedReferencesById.get(cardReference.id).resolvedDeclarationId,
		card.id,
	);
	assert.equal(
		context.resolvedReferencesById.get(tileReference.id),
		tileReference,
	);
});

test("render dependency index partitions cycles deterministically", () => {
	const declarations = [
		{ id: "snippet:a:a", kind: "snippet", path: "a", name: "a" },
		{ id: "snippet:b:b", kind: "snippet", path: "b", name: "b" },
		{ id: "snippet:c:c", kind: "snippet", path: "c", name: "c" },
	];
	const render = (fromPath, targetName) => ({
		kind: "rendersSnippet",
		fromPath,
		targetName,
		siteId: `${fromPath}@1:1`,
		invocationKind: "render",
		static: true,
	});
	const index = new ThemeRenderDependencyIndex(declarations, [
		render("a", "b"),
		render("b", "a"),
		render("c", "a"),
	]);
	assert.deepEqual(index.getStronglyConnectedGroup("a"), ["a", "b"]);
	assert.deepEqual(index.getAffectedGroups(["c"]), [["a", "b"], ["c"]]);
});

test("theme pass scheduler rejects backward routes", () => {
	assert.throws(
		() =>
			new ThemePassScheduler([
				incrementalThemePass({
					name: "bad-resolution",
					stage: "resolution",
					routes: [{ kind: "factsChanged", target: "facts" }],
					collectChanges: () => new Set(),
					run: () => ({ records: [], changes: [] }),
				}),
			]),
		/non-forward/,
	);
});

test("theme pass scheduler bounds fixed-point convergence", () => {
	const scheduler = new ThemePassScheduler(
		[
			fixedPointThemePass({
				name: "data-flow",
				stage: "dataFlow",
				fixedPointGroup: "render-flow",
				routes: [
					{
						kind: "dataFlowChanged",
						target: "dataFlow",
						fixedPointGroup: "render-flow",
					},
				],
				seed: () => new Set(["card"]),
				step: (pending) => ({
					records: [...pending],
					changes: [],
					pending: new Set(pending),
				}),
			}),
		],
		{ maximumFixedPointIterations: 2 },
	);
	assert.throws(
		() => scheduler.execute([{ kind: "sourceChanged", path: "card" }], {}),
		/did not converge after 2 iterations/,
	);
});

test("metafield snapshot changes can seed a snapshot-only pass", () => {
	const scheduler = new ThemePassScheduler([
		incrementalThemePass({
			name: "metafields",
			stage: "metafields",
			routes: [{ kind: "diagnosticsChanged", target: "diagnostics" }],
			collectChanges: (changes) =>
				new Set(
					changes
						.filter((change) => change.kind === "metafieldSnapshotChanged")
						.flatMap((change) => change.changedKeys),
				),
			run: (keys) => ({
				records: [...keys],
				changes: [{ kind: "diagnosticsChanged", owner: "metafields" }],
			}),
		}),
	]);
	const result = scheduler.execute(
		[
			{
				kind: "metafieldSnapshotChanged",
				changedKeys: ["product:custom:subtitle"],
				state: "present",
			},
		],
		{},
	);
	assert.deepEqual(result.records, ["product:custom:subtitle"]);
});
