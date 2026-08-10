import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	createShopifySemanticCompiler,
	SemanticCompiler,
	SemanticCompilerInputError,
	SemanticInspectInputError,
} from "../dist/index.js";

const fixtureRoot = new URL(
	"../../../fixtures/canonical-theme/",
	import.meta.url,
);

function fixture(path) {
	return {
		path,
		source: fs.readFileSync(new URL(path, fixtureRoot), "utf8"),
	};
}

function input(sources, externalInputs = {}) {
	return {
		sources,
		revision: { compilerVersion: "session-test", externalInputs },
		repositoryScope: { status: "complete" },
	};
}

function instrumentedCompiler() {
	const base = createShopifySemanticCompiler();
	const calls = new Map();
	let fallbackCalls = 0;
	const compiler = new SemanticCompiler({
		...base.options,
		pipelines: base.options.pipelines.map((pipeline) => ({
			...pipeline,
			project(document, limits) {
				calls.set(document.path, (calls.get(document.path) ?? 0) + 1);
				if (document.source.includes("FAIL_INCREMENTAL_TEST")) {
					throw new Error("incremental projection failed");
				}
				return pipeline.project(document, limits);
			},
		})),
		fallbackProjector: {
			...base.options.fallbackProjector,
			project(source) {
				fallbackCalls += 1;
				return base.options.fallbackProjector.project(source);
			},
		},
	});
	return {
		compiler,
		calls,
		fallbackCalls: () => fallbackCalls,
	};
}

test("session recompiles changed sources and reuses unchanged contributions", () => {
	const { compiler, calls, fallbackCalls } = instrumentedCompiler();
	const productCard = fixture("snippets/product-card.liquid");
	const price = fixture("snippets/price.liquid");
	const javascript = {
		path: "assets/theme.js",
		source: "console.log('theme')",
	};
	const session = compiler.createSession(
		input([productCard, price, javascript]),
	);
	assert.deepEqual(Object.fromEntries(calls), {
		"snippets/price.liquid": 1,
		"snippets/product-card.liquid": 1,
	});
	assert.equal(fallbackCalls(), 1);
	assert.deepEqual(session.snapshot().report.incremental, {
		changedPaths: [
			"assets/theme.js",
			"snippets/price.liquid",
			"snippets/product-card.liquid",
		],
		recompiledPaths: [
			"assets/theme.js",
			"snippets/price.liquid",
			"snippets/product-card.liquid",
		],
		reusedPaths: [],
		removedPaths: [],
		fullAssembly: true,
		fullIndex: true,
	});

	const oldCursor = session.snapshot().inspect.inspect({
		query: "product",
		kinds: ["expression"],
		evidence: "none",
		limit: 1,
	}).page.nextCursor;
	assert.equal(typeof oldCursor, "string");
	const changedProductCard = {
		...productCard,
		source: `${productCard.source}\n{% comment %}incremental{% endcomment %}`,
	};
	const updated = session.apply({
		changes: [{ kind: "upsert", source: changedProductCard }],
	});
	assert.equal(calls.get("snippets/product-card.liquid"), 2);
	assert.equal(calls.get("snippets/price.liquid"), 1);
	assert.equal(fallbackCalls(), 1);
	assert.throws(
		() =>
			updated.inspect.inspect({
				query: "product",
				kinds: ["expression"],
				evidence: "none",
				limit: 1,
				cursor: oldCursor,
			}),
		SemanticInspectInputError,
	);
	assert.deepEqual(updated.report.incremental, {
		changedPaths: ["snippets/product-card.liquid"],
		recompiledPaths: ["snippets/product-card.liquid"],
		reusedPaths: ["assets/theme.js", "snippets/price.liquid"],
		removedPaths: [],
		fullAssembly: true,
		fullIndex: true,
	});
	assert.deepEqual(
		updated.output,
		compiler.compile(input([changedProductCard, price, javascript])).output,
	);

	const outputBeforeNoop = updated.output;
	const noop = session.apply({
		changes: [{ kind: "upsert", source: changedProductCard }],
	});
	assert.equal(noop.output, outputBeforeNoop);
	assert.deepEqual(noop.report.incremental, {
		changedPaths: [],
		recompiledPaths: [],
		reusedPaths: [
			"assets/theme.js",
			"snippets/price.liquid",
			"snippets/product-card.liquid",
		],
		removedPaths: [],
		fullAssembly: false,
		fullIndex: false,
	});
});

test("session handles removals, re-additions, metadata, and limit invalidation", () => {
	const { compiler, calls } = instrumentedCompiler();
	const productCard = fixture("snippets/product-card.liquid");
	const price = fixture("snippets/price.liquid");
	const session = compiler.createSession(input([productCard, price]));

	const removed = session.apply({
		changes: [{ kind: "remove", path: "snippets/price.liquid" }],
	});
	assert.deepEqual(removed.report.incremental, {
		changedPaths: ["snippets/price.liquid"],
		recompiledPaths: [],
		reusedPaths: ["snippets/product-card.liquid"],
		removedPaths: ["snippets/price.liquid"],
		fullAssembly: true,
		fullIndex: true,
	});
	const dependency = removed.inspect.inspect({
		subject: { type: "snippet", handle: "product-card" },
		facet: "dependencies",
		evidence: "none",
	});
	assert.equal(dependency.answer.groups[0].items[0].defined, false);
	assert.equal(dependency.answer.groups[0].items[0].resolution, "not-found");

	const readded = session.apply({
		changes: [{ kind: "upsert", source: price }],
	});
	assert.deepEqual(readded.report.incremental.recompiledPaths, [
		"snippets/price.liquid",
	]);
	assert.equal(calls.get("snippets/price.liquid"), 2);
	assert.equal(
		readded.inspect.inspect({
			subject: { type: "snippet", handle: "product-card" },
			facet: "dependencies",
			evidence: "none",
		}).answer.groups[0].items[0].resolution,
		"repository-exact",
	);

	const fingerprint = readded.output.snapshot.revision.repositoryFingerprint;
	const revisionId = readded.output.snapshot.revision.id;
	const metadata = session.apply({
		revision: {
			compilerVersion: "session-test",
			externalInputs: { merchant: "snapshot:2" },
		},
	});
	assert.deepEqual(metadata.report.incremental.recompiledPaths, []);
	assert.deepEqual(metadata.report.incremental.reusedPaths, [
		"snippets/price.liquid",
		"snippets/product-card.liquid",
	]);
	assert.equal(
		metadata.output.snapshot.revision.repositoryFingerprint,
		fingerprint,
	);
	assert.notEqual(metadata.output.snapshot.revision.id, revisionId);

	const limited = session.apply({ limits: { maxFacts: 5, maxWork: 100 } });
	assert.deepEqual(limited.report.incremental.recompiledPaths, [
		"snippets/price.liquid",
		"snippets/product-card.liquid",
	]);
	assert.deepEqual(limited.report.incremental.reusedPaths, []);
});

test("failed session update is transactional", () => {
	const { compiler } = instrumentedCompiler();
	const productCard = fixture("snippets/product-card.liquid");
	const price = fixture("snippets/price.liquid");
	const session = compiler.createSession(input([productCard, price]));
	const before = session.snapshot();
	assert.throws(
		() =>
			session.apply({
				changes: [
					{
						kind: "upsert",
						source: {
							...productCard,
							source: "FAIL_INCREMENTAL_TEST",
						},
					},
				],
			}),
		/incremental projection failed/u,
	);
	assert.equal(session.snapshot(), before);
	assert.equal(
		session.snapshot().inspect.inspect({
			subject: { type: "snippet", handle: "product-card" },
			facet: "dependencies",
			evidence: "none",
		}).answer.groups[0].items[0].resolution,
		"repository-exact",
	);
});

test("session enforces bounded and unambiguous updates", () => {
	const compiler = createShopifySemanticCompiler();
	const productCard = fixture("snippets/product-card.liquid");
	const session = compiler.createSession(input([productCard]), {
		maxChangesPerUpdate: 2,
		maxSources: 2,
	});
	assert.throws(
		() =>
			session.apply({
				changes: [
					{ kind: "remove", path: productCard.path },
					{ kind: "remove", path: "snippets/other.liquid" },
					{ kind: "remove", path: "snippets/third.liquid" },
				],
			}),
		SemanticCompilerInputError,
	);
	assert.throws(
		() =>
			session.apply({
				changes: [
					{ kind: "remove", path: productCard.path },
					{ kind: "upsert", source: productCard },
				],
			}),
		SemanticCompilerInputError,
	);
	assert.throws(
		() =>
			compiler.createSession(
				input([productCard, fixture("snippets/price.liquid")]),
				{ maxSources: 1 },
			),
		SemanticCompilerInputError,
	);
	assert.throws(
		() =>
			compiler.createSession(input([productCard]), {
				maxSourceBytes: 1,
			}),
		SemanticCompilerInputError,
	);
	assert.equal(session.snapshot().output.snapshot.entities.length > 0, true);
});
