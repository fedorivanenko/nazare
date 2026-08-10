import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
	createShopifySemanticCompiler,
	SemanticCompiler,
	SemanticCompilerInputError,
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

function input(sources, overrides = {}) {
	return {
		sources,
		revision: {
			compilerVersion: "test",
			externalInputs: {},
			...overrides.revision,
		},
		repositoryScope: overrides.repositoryScope ?? { status: "complete" },
		...(overrides.limits ? { limits: overrides.limits } : {}),
	};
}

test("compiler orchestrates repository sources into queryable Inspect output", () => {
	const compiler = createShopifySemanticCompiler();
	const compilation = compiler.compile(
		input([
			{ path: "notes/readme.txt", source: "merchant notes" },
			fixture("snippets/price.liquid"),
			{ path: "assets/demo.js", source: "console.log('demo')" },
			fixture("snippets/product-card.liquid"),
		]),
	);

	assert.deepEqual(
		compilation.report.sources.map(({ path }) => path),
		[
			"assets/demo.js",
			"notes/readme.txt",
			"snippets/price.liquid",
			"snippets/product-card.liquid",
		],
	);
	assert.deepEqual(
		compilation.report.sources.map(({ semanticSupport }) => semanticSupport),
		["source-only", "source-only", "projected", "projected"],
	);
	assert.equal(
		compilation.output.snapshot.entities.filter(
			({ kind }) => kind === "shopify.source-file",
		).length,
		4,
	);
	assert.equal(
		compilation.output.snapshot.diagnostics.filter(
			({ code }) => code === "SEMANTIC_FRONTEND_UNAVAILABLE",
		).length,
		2,
	);
	const dependencies = compilation.inspect.inspect({
		subject: { type: "snippet", handle: "product-card" },
		facet: "dependencies",
		evidence: "excerpt",
	});
	assert.equal(dependencies.status, "found");
	assert.equal(dependencies.answer.groups[0].items[0].handle, "price");
	assert.equal(
		dependencies.answer.groups[0].items[0].evidence.some(({ excerpt }) =>
			excerpt?.includes("render 'price'"),
		),
		true,
	);
	assert.equal(dependencies.completeness.status, "complete");

	const sourceOnly = compilation.inspect.inspect({
		subject: { type: "file", path: "assets/demo.js" },
		evidence: "none",
	});
	assert.equal(sourceOnly.status, "found");
	assert.equal(sourceOnly.completeness.status, "unsupported");
	assert.equal(
		sourceOnly.completeness.reasons.some(({ code }) => code === "unsupported"),
		true,
	);
});

test("compiler output and revision are invariant to source and external-input order", () => {
	const compiler = createShopifySemanticCompiler();
	const sources = [
		fixture("snippets/product-card.liquid"),
		fixture("snippets/price.liquid"),
	];
	const left = compiler.compile(
		input(sources, {
			revision: { externalInputs: { storefront: "2", merchant: "1" } },
		}),
	);
	const right = compiler.compile(
		input([...sources].reverse(), {
			revision: { externalInputs: { merchant: "1", storefront: "2" } },
		}),
	);
	assert.deepEqual(left.output, right.output);
	assert.deepEqual(left.report, right.report);
	assert.match(left.output.snapshot.revision.id, /^sha256:[a-f0-9]{64}$/u);
	assert.match(
		left.output.snapshot.revision.repositoryFingerprint,
		/^sha256:[a-f0-9]{64}$/u,
	);

	const changed = compiler.compile(
		input([
			{
				...sources[0],
				source: `${sources[0].source}\n{%- comment -%}change{%- endcomment -%}`,
			},
			sources[1],
		]),
	);
	assert.notEqual(
		changed.output.snapshot.revision.repositoryFingerprint,
		left.output.snapshot.revision.repositoryFingerprint,
	);

	const upgradedCompiler = new SemanticCompiler({
		...compiler.options,
		pipelines: compiler.options.pipelines.map((pipeline) => ({
			...pipeline,
			version: pipeline.version + 1,
		})),
	});
	const upgraded = upgradedCompiler.compile(
		input(sources, {
			revision: { externalInputs: { storefront: "2", merchant: "1" } },
		}),
	);
	assert.equal(
		upgraded.output.snapshot.revision.repositoryFingerprint,
		left.output.snapshot.revision.repositoryFingerprint,
	);
	assert.notEqual(
		upgraded.output.snapshot.revision.id,
		left.output.snapshot.revision.id,
	);
	const limited = compiler.compile(
		input(sources, {
			revision: { externalInputs: { storefront: "2", merchant: "1" } },
			limits: { maxFacts: 1 },
		}),
	);
	assert.notEqual(
		limited.output.snapshot.revision.id,
		left.output.snapshot.revision.id,
	);
});

test("compiler propagates frontend budgets into Inspect completeness", () => {
	const compilation = createShopifySemanticCompiler().compile(
		input([fixture("snippets/product-card.liquid")], {
			limits: { maxFacts: 1, maxWork: 100_000 },
		}),
	);
	assert.equal(
		compilation.output.snapshot.boundaries.some(
			({ kind }) => kind === "budget",
		),
		true,
	);
	const response = compilation.inspect.inspect({
		subject: { type: "snippet", handle: "product-card" },
		facet: "dependencies",
		evidence: "none",
	});
	assert.equal(response.status, "found");
	assert.equal(response.completeness.status, "partial");
});

test("compiler validates source identity and limits before compilation", () => {
	const compiler = createShopifySemanticCompiler();
	assert.throws(
		() =>
			compiler.compile(
				input([
					{ path: "snippets/a.liquid", source: "" },
					{ path: "./snippets/a.liquid", source: "" },
				]),
			),
		SemanticCompilerInputError,
	);
	assert.throws(
		() => compiler.compile(input([{ path: "../outside.liquid", source: "" }])),
		SemanticCompilerInputError,
	);
	assert.throws(
		() => compiler.compile(input([], { limits: { maxFacts: 0 } })),
		SemanticCompilerInputError,
	);
	assert.throws(
		() =>
			compiler.compile({
				sources: [],
				revision: { compilerVersion: "", externalInputs: {} },
				repositoryScope: { status: "complete" },
			}),
		SemanticCompilerInputError,
	);
});
