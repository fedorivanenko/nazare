import assert from "node:assert/strict";
import test from "node:test";
import {
	ArtifactTopologyQuery,
	createShopifySemanticCompiler,
	projectArtifactTopology,
	projectSnapshotToFactOntology,
	validateArtifactTopology,
} from "../dist/index.js";

const lifecycleSources = [
	{
		path: "layout/theme.liquid",
		source: [
			"{{ 'base.css' | asset_url | stylesheet_tag }}",
			"<script src=\"{{ 'theme.js' | asset_url }}\"></script>",
			"{{ content_for_layout }}",
		].join("\n"),
	},
	{
		path: "templates/product.json",
		source:
			'{"sections":{"main":{"type":"main-product","settings":{}}},"order":["main"]}',
	},
	{
		path: "sections/main-product.liquid",
		source: "<div class=\"is-active\">{% render 'badge' %}</div>",
	},
	{ path: "snippets/badge.liquid", source: "<span>Badge</span>" },
	{ path: "assets/base.css", source: ".is-active { color: red; }" },
	{
		path: "assets/theme.js",
		source: "element.classList.add('is-active');",
	},
	{ path: "assets/orphan.css", source: ".is-active { display: none; }" },
];

function compile(sources, scope = "complete") {
	return createShopifySemanticCompiler().compile({
		sources,
		revision: { compilerVersion: "topology-test", externalInputs: {} },
		repositoryScope: { status: scope },
	});
}

function topology(compilation, sources, scope = "complete", limits = {}) {
	return projectArtifactTopology({
		snapshot: compilation.output.snapshot,
		sources,
		repositoryScope: { status: scope },
		limits,
	});
}

test("artifact topology filters same-name class lifecycle by entrypoint reachability", () => {
	const compilation = compile(lifecycleSources);
	const projected = topology(compilation, lifecycleSources);
	assert.doesNotThrow(() => validateArtifactTopology(projected));
	assert.throws(
		() =>
			projectArtifactTopology({
				snapshot: compilation.output.snapshot,
				sources: lifecycleSources.map((source) =>
					source.path === "assets/orphan.css"
						? { ...source, source: `${source.source}\n.changed {}` }
						: source,
				),
				repositoryScope: { status: "complete" },
			}),
		/sources do not match semantic snapshot/,
	);
	const direct = projected.relations.filter(
		({ kind }) => kind !== "REACHABLE_FROM",
	);
	assert.deepEqual(
		direct
			.map(({ kind, from, to }) => [kind, from, to])
			.sort((left, right) =>
				JSON.stringify(left).localeCompare(JSON.stringify(right)),
			),
		[
			[
				"ATTACHED_TO",
				"artifact:assets~2Fbase.css",
				"artifact:layout~2Ftheme.liquid",
			],
			[
				"ATTACHED_TO",
				"artifact:assets~2Ftheme.js",
				"artifact:layout~2Ftheme.liquid",
			],
			[
				"ATTACHED_TO",
				"artifact:templates~2Fproduct.json",
				"artifact:layout~2Ftheme.liquid",
			],
			[
				"INCLUDES",
				"artifact:sections~2Fmain-product.liquid",
				"artifact:snippets~2Fbadge.liquid",
			],
			[
				"INCLUDES",
				"artifact:templates~2Fproduct.json",
				"artifact:sections~2Fmain-product.liquid",
			],
		].sort((left, right) =>
			JSON.stringify(left).localeCompare(JSON.stringify(right)),
		),
	);
	const sectionReference = projected.references.find(
		({ kind }) => kind === "section",
	);
	assert.equal(sectionReference.resolution, "resolved");
	const sectionSource = projected.sources.find(
		({ ref }) => ref === sectionReference.source,
	);
	assert.equal(
		lifecycleSources[1].source.slice(
			sectionSource.range.start,
			sectionSource.range.end,
		),
		'"main-product"',
	);

	const facts = projectSnapshotToFactOntology(compilation.output.snapshot);
	const result = new ArtifactTopologyQuery(projected).classLifecycle(
		facts,
		"templates/product.json",
		"is-active",
		{ limit: 2 },
	);
	assert.equal(result.candidate, true);
	assert.equal(result.uses.total, 3);
	assert.equal(result.uses.returned, 2);
	assert.equal(result.uses.truncated, true);
	assert.equal(result.uses.artifacts, 3);
	assert.equal(typeof result.page.nextCursor, "string");
	const secondPage = new ArtifactTopologyQuery(projected).classLifecycle(
		facts,
		"templates/product.json",
		"is-active",
		{ limit: 2, cursor: result.page.nextCursor },
	);
	assert.equal(secondPage.uses.returned, 1);
	assert.equal(secondPage.uses.truncated, false);
	assert.equal(secondPage.page.nextCursor, undefined);
	assert.throws(
		() =>
			new ArtifactTopologyQuery(projected).classLifecycle(
				facts,
				"templates/product.json",
				"other-class",
				{ cursor: result.page.nextCursor },
			),
		/Invalid or stale class lifecycle cursor/,
	);
	assert.deepEqual(
		result.roles.map(({ role, uses }) => [role, uses]),
		[
			["adds", 1],
			["emits", 1],
			["selects", 1],
		],
	);
	assert.deepEqual(result.excludedSameNameArtifacts, ["assets/orphan.css"]);
	assert.equal(result.coverage.topology, "complete");
	assert.equal(result.coverage.semantic, "complete");
	assert.equal(
		JSON.stringify(result).includes("entity:shopify") ||
			JSON.stringify(result).includes("occurrence:shopify"),
		false,
	);
	assert.equal(
		facts.symbols.filter(
			({ kind, name }) => kind === "css.class" && name === "is-active",
		).length,
		4,
	);
});

test("one artifact remains shared across multiple entrypoints", () => {
	const sources = [
		{
			path: "templates/index.json",
			source: '{"sections":{"shared":{"type":"shared"}}}',
		},
		{
			path: "templates/product.json",
			source: '{"sections":{"shared":{"type":"shared"}}}',
		},
		{ path: "sections/shared.liquid", source: "<div>Shared</div>" },
	];
	const compilation = compile(sources);
	const projected = topology(compilation, sources);
	assert.equal(
		projected.artifacts.filter(({ path }) => path === "sections/shared.liquid")
			.length,
		1,
	);
	const sharedReachability = projected.relations.filter(
		({ kind, from }) =>
			kind === "REACHABLE_FROM" && from === "artifact:sections~2Fshared.liquid",
	);
	assert.deepEqual(sharedReachability.map(({ to }) => to).sort(), [
		"artifact:templates~2Findex.json",
		"artifact:templates~2Fproduct.json",
	]);
});

test("topology keeps missing and dynamic references distinct", () => {
	const sources = [
		{
			path: "templates/product.json",
			source: '{"sections":{"missing":{"type":"missing-section"}}}',
		},
		{
			path: "layout/theme.liquid",
			source: [
				"{{ runtime_asset | stylesheet_tag }}",
				"{{ 'shopify_common.js' | shopify_asset_url | script_tag }}",
			].join("\n"),
		},
	];
	const completeCompilation = compile(sources, "complete");
	const complete = topology(completeCompilation, sources, "complete");
	const completeQuery = new ArtifactTopologyQuery(complete);
	assert.equal(
		completeQuery
			.referencesFrom("templates/product.json")
			.find(({ kind }) => kind === "section").resolution,
		"not-found",
	);
	const layoutReferences = completeQuery.referencesFrom("layout/theme.liquid");
	assert.equal(
		layoutReferences.find(
			({ resolution }) => resolution === "runtime-dependent",
		).resolution,
		"runtime-dependent",
	);
	assert.equal(
		layoutReferences.find(
			({ resolution }) => resolution === "external-data-required",
		).resolution,
		"external-data-required",
	);

	const partialCompilation = compile(sources, "partial");
	const partial = topology(partialCompilation, sources, "partial");
	assert.equal(
		new ArtifactTopologyQuery(partial)
			.referencesFrom("templates/product.json")
			.find(({ kind }) => kind === "section").resolution,
		"unknown",
	);
});

test("reachability cycles and depth exhaustion remain bounded", () => {
	const sources = [
		{
			path: "templates/index.json",
			source: '{"sections":{"a":{"type":"a"}}}',
		},
		{ path: "sections/a.liquid", source: "{% render 'b' %}" },
		{ path: "snippets/b.liquid", source: "{% render 'c' %}" },
		{ path: "snippets/c.liquid", source: "{% render 'b' %}" },
	];
	const compilation = compile(sources);
	const projected = topology(compilation, sources, "complete", {
		maxDepth: 2,
	});
	const reachable = projected.relations.filter(
		({ kind }) => kind === "REACHABLE_FROM",
	);
	assert.equal(
		new Set(reachable.map(({ from }) => from)).size,
		reachable.length,
	);
	assert.equal(reachable.length, 2);
	assert.equal(
		projected.coverage.find(
			({ family }) => family === "shopify.artifact-reachability",
		).status,
		"partial",
	);
});
