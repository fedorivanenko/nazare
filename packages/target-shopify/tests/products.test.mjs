import assert from "node:assert/strict";
import test from "node:test";
import {
	createCapabilityRegistry,
	createComputationGraph,
	definePipeline,
	fingerprintProductKey,
	pipelineIdentity,
} from "@nazare/compiler/computation";
import {
	definePortableOutputProvider,
	portableApplicationModel,
	portableOutputCapability,
} from "@nazare/compiler/portable";
import {
	createProjectSession,
	defineInputProvider,
	defineProjectHost,
	projectFileId,
} from "@nazare/compiler/project";
import {
	createDefaultSourceFrontendRegistry,
	createSourceFrontendRegistry,
	createSourceProductRegistrar,
} from "@nazare/compiler/source-products";
import {
	classifyShopifyFile,
	shopifyBuildOutput,
	shopifyBuildProducts,
	shopifyGraphProducts,
	shopifyPortableTransform,
	shopifyProducts,
	shopifyQueryProducts,
	shopifyResolutionProducts,
	shopifySemanticCapability,
	shopifySemanticProducts,
	shopifySemanticTarget,
} from "../dist/index.js";

function id(path) {
	return projectFileId({ workspace: "test", package: "theme", path });
}

function memoryHost(sources) {
	const files = new Map(
		Object.entries(sources).map(([path, contents]) => [
			path,
			{ id: id(path), contents },
		]),
	);
	return defineProjectHost({
		files: defineInputProvider({
			id: "test.shopify-files",
			version: 1,
			async read(file) {
				const value = files.get(file.path);
				if (!value) throw new Error(`Missing ${file.path}`);
				return { value, fingerprint: fingerprintProductKey(value.contents) };
			},
		}),
		async discover() {
			return [...files.values()].map((file) => file.id);
		},
	});
}

async function targetSession(
	sources,
	frontends = createDefaultSourceFrontendRegistry(),
	graph,
) {
	const host = memoryHost(sources);
	const session = await createProjectSession({ host, graph });
	createSourceProductRegistrar({ host, frontends }).registerComputations(
		session.graph,
	);
	const capabilities = createCapabilityRegistry([shopifySemanticTarget()]);
	capabilities.registerComputations(session.graph);
	shopifyPortableTransform().registerComputations(session.graph);
	return session;
}

test("registers Shopify semantics through CapabilityRegistry", () => {
	const registry = createCapabilityRegistry([shopifySemanticTarget()]);
	const capability = registry.require(shopifySemanticCapability);
	assert.equal(capability.targetId, "shopify");
	assert.equal(capability.products, shopifyProducts);
});

test("classifies Shopify roles independently from source language", () => {
	assert.equal(classifyShopifyFile("sections/main.liquid"), "section");
	assert.equal(classifyShopifyFile("templates/product.json"), "templateJson");
	assert.equal(classifyShopifyFile("assets/theme.js"), "asset");
	assert.equal(classifyShopifyFile("other/file.liquid"), "other");
});

test("registers per-file Shopify declarations and Liquid references", async () => {
	const session = await targetSession({
		"sections/main.liquid": "{% render 'card' %}",
		"snippets/card.liquid": "",
	});
	const declarations = await session.get(
		shopifyProducts.declarations.product(id("sections/main.liquid")),
	);
	const references = await session.get(
		shopifyProducts.references.product(id("sections/main.liquid")),
	);

	assert.deepEqual(
		declarations.map(({ role, name }) => ({ role, name })),
		[{ role: "section", name: "main" }],
	);
	assert.deepEqual(
		references.map(({ targetRole, targetName, static: isStatic }) => ({
			targetRole,
			targetName,
			static: isStatic,
		})),
		[{ targetRole: "snippet", targetName: "card", static: true }],
	);
});

test("enriches JSON templates and locales downstream from parsing", async () => {
	const session = await targetSession({
		"templates/index.json": JSON.stringify({
			sections: { hero: { type: "hero" }, dynamic: {} },
		}),
		"locales/en.default.json": JSON.stringify({
			general: { title: "Title", nested: { label: "Label" } },
		}),
	});
	const references = await session.get(
		shopifyProducts.references.product(id("templates/index.json")),
	);
	const declarations = await session.get(
		shopifyProducts.declarations.product(id("locales/en.default.json")),
	);

	assert.equal(
		references.some(
			(reference) =>
				reference.targetRole === "section" && reference.targetName === "hero",
		),
		true,
	);
	assert.equal(
		new Set(references.map((reference) => reference.id)).size,
		references.length,
	);
	assert.deepEqual(
		declarations
			.filter((declaration) => declaration.role === "localeKey")
			.map((declaration) => declaration.name),
		["general.title", "general.nested.label"],
	);
});

test("resolves references through lazy symbol products", async () => {
	const session = await targetSession({
		"sections/main.liquid": "{% render 'card' %}",
		"snippets/card.liquid": "",
		"snippets/unused.liquid": "",
	});
	const resolutions = await session.get(
		shopifyResolutionProducts.fileResolutions.product({
			file: id("sections/main.liquid"),
		}),
	);

	assert.equal(resolutions.length, 1);
	assert.equal(resolutions[0].status, "resolved");
	assert.equal(
		resolutions[0].declarations[0].owner.path,
		"snippets/card.liquid",
	);
});

test("resolves direct relative Nazare imports by stable file identity", async () => {
	const session = await targetSession({
		"components/card.nz.liquid": "",
		"components/entry.nz.liquid":
			"{% import Card from './card.nz.liquid' %}\n{% render Card { title: 'Hi' } %}",
	});
	const resolutions = await session.get(
		shopifyResolutionProducts.fileResolutions.product({
			file: id("components/entry.nz.liquid"),
		}),
	);

	assert.equal(resolutions.length, 2);
	assert.equal(
		resolutions.every((resolution) => resolution.status === "resolved"),
		true,
	);
	assert.equal(
		resolutions.every(
			(resolution) =>
				resolution.targetFiles[0].path === "components/card.nz.liquid",
		),
		true,
	);
});

test("owns missing-reference diagnostics on resolution products", async () => {
	const session = await targetSession({
		"sections/main.liquid": "{% render 'missing' %}",
	});
	const product = shopifyResolutionProducts.fileResolutions.product({
		file: id("sections/main.liquid"),
	});
	const resolutions = await session.get(product);
	const metadata = await session.graph.metadata(product);

	assert.equal(resolutions[0].status, "missing");
	assert.equal(metadata.diagnostics[0].code, "SHOPIFY_REFERENCE_NOT_FOUND");
});

test("preserves dynamic references as explicit uncertainty", async () => {
	const session = await targetSession({
		"sections/main.liquid": "{% render snippet_name %}",
	});
	const product = shopifyResolutionProducts.fileResolutions.product({
		file: id("sections/main.liquid"),
	});
	const resolutions = await session.get(product);
	const metadata = await session.graph.metadata(product);

	assert.equal(resolutions[0].status, "dynamic");
	assert.equal(metadata.uncertainty[0].code, "SHOPIFY_DYNAMIC_REFERENCE");
});

test("symbol queries preserve ambiguous declarations", async () => {
	const session = await targetSession({
		"assets/one/icon.svg": "<svg />",
		"assets/two/icon.svg": "<svg />",
	});
	const declarations = await session.get(
		shopifyResolutionProducts.declarationsBySymbol.product({
			role: "asset",
			name: "icon.svg",
		}),
	);
	assert.equal(declarations.length, 2);
	assert.equal(new Set(declarations.map((item) => item.id)).size, 2);
});

test("partitions render cycles and computes SCC-local data flow", async () => {
	const session = await targetSession({
		"snippets/a.liquid": "{% render 'b' %}",
		"snippets/b.liquid": "{% render 'a' %} {{ settings.color }}",
	});
	const graph = await session.get(
		shopifyGraphProducts.renderGraph.product({
			files: session.snapshot().fileIds,
		}),
	);
	const reversed = await session.get(
		shopifyGraphProducts.renderGraph.product({
			files: [...session.snapshot().fileIds].reverse(),
		}),
	);
	assert.deepEqual(
		reversed.sccs.map((scc) => scc.id),
		graph.sccs.map((scc) => scc.id),
	);
	const cycle = graph.sccs.find((scc) => scc.nodes.length === 2);
	assert.ok(cycle);
	assert.equal(cycle.cyclic, true);

	const flow = await session.get(
		shopifyGraphProducts.sccDataFlow.product({
			scc: cycle,
			maxIterations: 8,
			maxWork: 100,
		}),
	);
	assert.equal(flow.converged, true);
	assert.deepEqual(
		flow.files.map((file) => [
			file.file.path,
			file.reads.map((read) => `${read.object}.${read.name}`),
		]),
		[
			["snippets/a.liquid", ["settings.color"]],
			["snippets/b.liquid", ["settings.color"]],
		],
	);
});

test("bounds SCC data flow and owns convergence diagnostics", async () => {
	const session = await targetSession({
		"snippets/a.liquid": "{% render 'b' %}",
		"snippets/b.liquid": "{% render 'a' %} {{ settings.color }}",
	});
	const graph = await session.get(
		shopifyGraphProducts.renderGraph.product({
			files: session.snapshot().fileIds,
		}),
	);
	const cycle = graph.sccs.find((scc) => scc.nodes.length === 2);
	assert.ok(cycle);
	const product = shopifyGraphProducts.sccDataFlow.product({
		scc: cycle,
		maxIterations: 1,
		maxWork: 100,
	});
	const flow = await session.get(product);
	const metadata = await session.graph.metadata(product);

	assert.equal(flow.converged, false);
	assert.equal(
		metadata.diagnostics[0].code,
		"SHOPIFY_DATA_FLOW_BUDGET_EXCEEDED",
	);
});

test("derives target-owned schema, evidence, capabilities, and classification", async () => {
	const session = await targetSession({
		"sections/main.liquid": [
			"{% render 'card' %}",
			"{% schema %}",
			JSON.stringify({
				name: "Main",
				settings: [
					{ id: "heading", type: "text", label: "Heading", default: "Hello" },
				],
			}),
			"{% endschema %}",
		].join("\n"),
		"snippets/card.liquid": "",
	});
	const file = id("sections/main.liquid");
	const schema = await session.get(
		shopifySemanticProducts.schema.product(file),
	);
	const evidence = await session.get(
		shopifySemanticProducts.evidence.product(file),
	);
	const capabilities = await session.get(
		shopifySemanticProducts.capabilities.product(file),
	);
	const classification = await session.get(
		shopifySemanticProducts.classification.product(file),
	);

	assert.deepEqual(schema.settings, [
		{
			id: "heading",
			type: "text",
			label: "Heading",
			defaultValue: "Hello",
		},
	]);
	assert.equal(
		evidence.some((record) => record.kind === "schema"),
		true,
	);
	assert.equal(
		capabilities.some((item) => item.capability === "shopify.schema"),
		true,
	);
	assert.deepEqual(classification.classes, ["composed", "configurable"]);
});

test("derives metafield products and data-driven classification", async () => {
	const session = await targetSession({
		"snippets/card.liquid": "{{ product.metafields.custom.subtitle.value }}",
	});
	const file = id("snippets/card.liquid");
	const metafields = await session.get(
		shopifySemanticProducts.metafields.product(file),
	);
	const capabilities = await session.get(
		shopifySemanticProducts.capabilities.product(file),
	);
	const classification = await session.get(
		shopifySemanticProducts.classification.product(file),
	);

	assert.deepEqual(
		metafields.map(({ ownerType, namespace, key, dynamic }) => ({
			ownerType,
			namespace,
			key,
			dynamic,
		})),
		[
			{
				ownerType: "product",
				namespace: "custom",
				key: "subtitle",
				dynamic: false,
			},
		],
	);
	assert.equal(
		capabilities.some((item) => item.capability === "shopify.metafields"),
		true,
	);
	assert.deepEqual(classification.classes, ["data-driven"]);
});

test("enriches neutral static GraphQL requests with Shopify metafield semantics", async () => {
	const session = await targetSession({
		"assets/product.js": `fetch("/api/graphql", {
			body: JSON.stringify({
				query: "query { product { metafield(namespace: \\"custom\\", key: \\"subtitle\\") { value } } }",
			}),
		});`,
	});
	const metafields = await session.get(
		shopifySemanticProducts.metafields.product(id("assets/product.js")),
	);

	assert.deepEqual(
		metafields.map(({ ownerType, namespace, key, dynamic }) => ({
			ownerType,
			namespace,
			key,
			dynamic,
		})),
		[
			{
				ownerType: "product",
				namespace: "custom",
				key: "subtitle",
				dynamic: false,
			},
		],
	);
});

test("derives browser behavior capability without Shopify role leakage", async () => {
	const session = await targetSession({
		"assets/theme.css": ".card { --accent: red }",
	});
	const file = id("assets/theme.css");
	const behavior = await session.get(
		shopifySemanticProducts.behavior.product(file),
	);
	const classification = await session.get(
		shopifySemanticProducts.classification.product(file),
	);

	assert.equal(behavior.length > 0, true);
	assert.deepEqual(classification.classes, ["interactive"]);
});

test("owns invalid schema diagnostics on schema product", async () => {
	const session = await targetSession({
		"sections/main.liquid": "{% schema %}{ invalid json }{% endschema %}",
	});
	const product = shopifySemanticProducts.schema.product(
		id("sections/main.liquid"),
	);
	const schema = await session.get(product);
	const metadata = await session.graph.metadata(product);

	assert.equal(schema.settings.length, 0);
	assert.equal(
		metadata.diagnostics.some(
			(diagnostic) => diagnostic.code === "SHOPIFY_SCHEMA_PARSE_ERROR",
		),
		true,
	);
});

test("composes Shopify semantics with independent portable outputs", async () => {
	let parseCalls = 0;
	const defaults = createDefaultSourceFrontendRegistry();
	const frontends = createSourceFrontendRegistry(
		defaults.frontends.map((frontend) => ({
			...frontend,
			async parse(file, context) {
				parseCalls += 1;
				return frontend.parse(file, context);
			},
		})),
	);
	const session = await targetSession(
		{
			"templates/index.liquid": "{% render 'card' %}",
			"snippets/card.liquid": "{{ product.metafields.custom.title.value }}",
			"assets/theme.css": ".card { color: red }",
			README: "opaque behavior",
		},
		frontends,
	);
	const plan = {
		files: session.snapshot().fileIds,
		roots: [id("templates/index.liquid")],
	};
	const compactProvider = definePortableOutputProvider({
		id: "test.output.compact",
		version: 1,
		emit(model) {
			return {
				format: "compact",
				components: model.components.length,
				routes: model.routes.length,
			};
		},
	});
	const detailedProvider = definePortableOutputProvider({
		id: "test.output.detailed",
		version: 1,
		emit(model) {
			return {
				format: "detailed",
				assets: model.assets.map((asset) => asset.path),
				uncertainty: model.uncertainty.map((boundary) => boundary.code),
			};
		},
	});
	const compactRegistry = createCapabilityRegistry([compactProvider]);
	const detailedRegistry = createCapabilityRegistry([detailedProvider]);
	compactRegistry.registerComputations(session.graph);
	detailedRegistry.registerComputations(session.graph);
	const semanticBefore = await session.get(
		shopifyProducts.facts.product(id("templates/index.liquid")),
	);
	const compact = compactRegistry.require(portableOutputCapability);
	const detailed = detailedRegistry.require(portableOutputCapability);
	const compactResult = await session.get(compact.product(plan));
	const detailedResult = await session.get(detailed.product(plan));
	const model = await session.get(portableApplicationModel.product(plan));
	const semanticAfter = await session.get(
		shopifyProducts.facts.product(id("templates/index.liquid")),
	);

	assert.deepEqual(compactResult, {
		format: "compact",
		components: 1,
		routes: 1,
	});
	assert.deepEqual(detailedResult, {
		format: "detailed",
		assets: ["assets/theme.css"],
		uncertainty: ["OPAQUE_SOURCE_UNANALYZED"],
	});
	assert.equal(model.renderTrees[0].nodes.length, 2);
	assert.equal(model.dataRequirements.length, 1);
	assert.equal(parseCalls, 4);
	assert.equal(semanticAfter, semanticBefore);

	const source = shopifySemanticTarget();
	const transform = shopifyPortableTransform();
	const compactPipeline = definePipeline({
		id: "test.shopify-portable",
		version: 1,
		source,
		transforms: [transform],
		output: compactRegistry,
	});
	const detailedPipeline = definePipeline({
		id: "test.shopify-portable",
		version: 1,
		source,
		transforms: [transform],
		output: detailedRegistry,
	});
	assert.notDeepEqual(
		pipelineIdentity(compactPipeline),
		pipelineIdentity(detailedPipeline),
	);
});

test("impact queries do not materialize unrelated indexes", async () => {
	const entries = new Map();
	const writes = [];
	const cache = {
		async read(key) {
			return entries.get(key);
		},
		async write(key, value) {
			writes.push(key);
			entries.set(key, value);
		},
		async delete(key) {
			entries.delete(key);
		},
	};
	const graph = createComputationGraph({ cache });
	const session = await targetSession(
		{
			"templates/index.liquid": "{% render 'card' %}",
			"snippets/card.liquid": "",
			"assets/theme.css": ".card { color: red }",
		},
		createDefaultSourceFrontendRegistry(),
		graph,
	);
	const files = session.snapshot().fileIds;
	await session.get(
		shopifyQueryProducts.impact.product({
			files,
			changed: [id("snippets/card.liquid")],
		}),
	);

	assert.equal(
		writes.some((key) => key.includes("behavior-index")),
		false,
	);
	assert.equal(
		writes.some((key) => key.includes("metafield-index")),
		false,
	);
	assert.equal(
		writes.some((key) => key.includes("render-graph")),
		false,
	);
	await session.get(shopifyQueryProducts.projectGraph.product({ files }));
	assert.equal(
		writes.some((key) => key.includes("render-graph")),
		true,
	);
});

test("serves versioned lazy graph, impact, and index queries", async () => {
	const session = await targetSession({
		"templates/index.liquid": "{% section 'main' %}",
		"sections/main.liquid": "{% render 'card' %}",
		"snippets/card.liquid": "{{ product.metafields.custom.title.value }}",
		"assets/theme.css": ".card { color: red }",
	});
	const files = session.snapshot().fileIds;
	const impact = await session.get(
		shopifyQueryProducts.impact.product({
			files,
			changed: [id("snippets/card.liquid")],
		}),
	);
	const pages = await session.get(
		shopifyQueryProducts.affectedPages.product({
			files,
			changed: [id("snippets/card.liquid")],
		}),
	);
	const dependencies = await session.get(
		shopifyQueryProducts.dependencyIndex.product({
			files,
			target: id("snippets/card.liquid"),
		}),
	);
	const behavior = await session.get(
		shopifyQueryProducts.behaviorIndex.product({
			files,
			behaviorKind: "domHook",
		}),
	);
	const metafields = await session.get(
		shopifyQueryProducts.metafieldIndex.product({
			files,
			ownerType: "product",
			namespace: "custom",
		}),
	);
	const projectGraph = await session.get(
		shopifyQueryProducts.projectGraph.product({ files }),
	);
	const unused = await session.get(
		shopifyQueryProducts.unusedFiles.product({
			files,
			roots: [id("templates/index.liquid")],
		}),
	);

	assert.equal(impact.version, 1);
	assert.deepEqual(
		impact.affected.map((file) => file.path),
		["sections/main.liquid", "snippets/card.liquid", "templates/index.liquid"],
	);
	assert.deepEqual(
		pages.pages.map((file) => file.path),
		["templates/index.liquid"],
	);
	assert.deepEqual(
		dependencies.records.map((record) => record.from.path),
		["sections/main.liquid"],
	);
	assert.equal(behavior.records.length > 0, true);
	assert.equal(
		behavior.evidence.every((record) => record.kind === "behavior"),
		true,
	);
	assert.deepEqual(
		metafields.records.map((record) => `${record.namespace}.${record.key}`),
		["custom.title"],
	);
	assert.equal(projectGraph.graph.edges.length, 2);
	assert.deepEqual(
		unused.files.map((file) => file.path),
		["assets/theme.css"],
	);
});

test("project-model queries preserve evidence and uncertainty", async () => {
	const session = await targetSession({
		"sections/main.liquid": "{% render snippet_name %}",
	});
	const result = await session.get(
		shopifyQueryProducts.projectModel.product({
			files: session.snapshot().fileIds,
		}),
	);

	assert.equal(result.version, 1);
	assert.equal(result.evidence.length > 0, true);
	assert.deepEqual(result.uncertainty, [
		"Dynamic references prevent complete classification",
	]);
});

test("build products preserve scopes and compile only reachable closure", async () => {
	let parseCalls = 0;
	const defaults = createDefaultSourceFrontendRegistry();
	const frontends = createSourceFrontendRegistry(
		defaults.frontends.map((frontend) => ({
			...frontend,
			async parse(file, context) {
				parseCalls += 1;
				return frontend.parse(file, context);
			},
		})),
	);
	const session = await targetSession(
		{
			"templates/index.liquid": "{% render 'card' %}",
			"snippets/card.liquid": "<span>Card</span>",
			"snippets/unused.liquid": "<span>Unused</span>",
		},
		frontends,
	);
	shopifyBuildOutput().registerComputations(session.graph);
	const plan = {
		scope: { kind: "closure", root: id("templates/index.liquid") },
		files: session.snapshot().fileIds,
		emitOnError: false,
		checkOnly: false,
		previouslyOwnedPaths: [],
		existingOutput: null,
		priorSchemaLock: null,
		migrations: [],
		appliedMigrationIds: [],
		localeBase: {},
	};
	const model = await session.get(shopifyBuildProducts.model.product(plan));
	const emission = await session.get(
		shopifyBuildProducts.emission.product(plan),
	);

	assert.deepEqual(
		model.files.map((file) => file.path),
		["snippets/card.liquid", "templates/index.liquid"],
	);
	assert.deepEqual(
		emission.files.map((file) => file.path),
		["snippets/card.liquid", "templates/index.liquid"],
	);
	const checkOnly = await session.get(
		shopifyBuildProducts.emission.product({ ...plan, checkOnly: true }),
	);
	assert.deepEqual(checkOnly.files, []);
	assert.equal(parseCalls, 2);
});

test("build models derive deterministic schema locks and drift", async () => {
	const session = await targetSession({
		"sections/hero.liquid": `{% schema %}{"settings":[{"id":"title","type":"text"}],"blocks":[{"type":"new"}]}{% endschema %}`,
	});
	shopifyBuildOutput().registerComputations(session.graph);
	const model = await session.get(
		shopifyBuildProducts.model.product({
			scope: { kind: "workspace" },
			files: session.snapshot().fileIds,
			emitOnError: false,
			checkOnly: true,
			previouslyOwnedPaths: [],
			existingOutput: null,
			priorSchemaLock: {
				version: 1,
				sections: {
					"sections/hero.liquid": {
						settings: [
							{ id: "title", type: "checkbox" },
							{ id: "removed", type: "text" },
						],
						blocks: [{ type: "old" }],
					},
				},
			},
			migrations: [],
			appliedMigrationIds: [],
			localeBase: {},
		}),
	);

	assert.deepEqual(model.schemaLock.sections["sections/hero.liquid"], {
		settings: [{ id: "title", type: "text" }],
		blocks: [{ type: "new" }],
	});
	assert.deepEqual(
		model.schemaDrift.map((entry) => entry.code),
		[
			"SHOPIFY_SETTING_RETYPED",
			"SHOPIFY_SETTING_REMOVED",
			"SHOPIFY_BLOCK_REMOVED",
		],
	);
});

test("build emission stops on diagnostics unless explicitly allowed", async () => {
	const session = await targetSession({
		"components/broken.nz.liquid": "{% component snippet %}\n{% render",
	});
	shopifyBuildOutput().registerComputations(session.graph);
	const plan = {
		scope: { kind: "workspace" },
		files: session.snapshot().fileIds,
		emitOnError: false,
		checkOnly: false,
		previouslyOwnedPaths: [],
		existingOutput: null,
		priorSchemaLock: null,
		migrations: [],
		appliedMigrationIds: [],
		localeBase: {},
	};
	const emission = await session.get(
		shopifyBuildProducts.emission.product(plan),
	);
	assert.equal(
		emission.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
		true,
	);
	assert.deepEqual(emission.files, []);
});

test("build emission migrates merchant data and merges locales", async () => {
	const session = await targetSession({
		"config/settings_data.json": "{}",
		"locales/en.default.json": JSON.stringify({ hello: "source", dev: "new" }),
	});
	shopifyBuildOutput().registerComputations(session.graph);
	const settings = JSON.stringify({
		current: {
			oldGlobal: "global",
			sections: {
				hero: {
					type: "old-section",
					settings: { oldSetting: "value" },
					blocks: { block: { type: "old-block" } },
				},
			},
		},
	});
	const locale = JSON.stringify({ hello: "merchant", dev: "base" });
	const emission = await session.get(
		shopifyBuildProducts.emission.product({
			scope: { kind: "workspace" },
			files: session.snapshot().fileIds,
			emitOnError: false,
			checkOnly: false,
			previouslyOwnedPaths: [],
			existingOutput: {
				hashes: {},
				contents: {
					"config/settings_data.json": settings,
					"locales/en.default.json": locale,
				},
				ownership: { version: 1, files: {} },
			},
			priorSchemaLock: null,
			migrations: [
				{
					id: "global",
					op: "renameSetting",
					section: null,
					from: "oldGlobal",
					to: "newGlobal",
				},
				{
					id: "section",
					op: "renameSection",
					from: "old-section",
					to: "new-section",
				},
				{
					id: "setting",
					op: "renameSetting",
					section: "new-section",
					from: "oldSetting",
					to: "newSetting",
				},
				{ id: "block", op: "renameBlock", from: "old-block", to: "new-block" },
			],
			appliedMigrationIds: [],
			localeBase: {
				"locales/en.default.json": { hello: "base", dev: "base" },
			},
		}),
	);
	const output = new Map(emission.files.map((file) => [file.path, file]));
	const migrated = JSON.parse(output.get("config/settings_data.json").contents);
	assert.equal(migrated.current.newGlobal, "global");
	assert.equal(migrated.current.sections.hero.type, "new-section");
	assert.equal(migrated.current.sections.hero.settings.newSetting, "value");
	assert.equal(migrated.current.sections.hero.blocks.block.type, "new-block");
	assert.deepEqual(JSON.parse(output.get("locales/en.default.json").contents), {
		hello: "merchant",
		dev: "new",
	});
	assert.deepEqual(emission.appliedMigrationIds, [
		"global",
		"section",
		"setting",
		"block",
	]);
	assert.deepEqual(emission.mergedLocalePaths, ["locales/en.default.json"]);
	assert.equal(
		emission.diagnostics.some(
			(diagnostic) => diagnostic.code === "SHOPIFY_LOCALE_CONFLICT",
		),
		true,
	);
});

test("build owned-output products detect generated path collisions", async () => {
	const session = await targetSession({
		"components/card.nz.liquid":
			'{% component snippet %}\n<div class="card">Card</div>',
		"snippets/card.liquid": "<span>Existing</span>",
	});
	shopifyBuildOutput().registerComputations(session.graph);
	const plan = {
		scope: { kind: "workspace" },
		files: session.snapshot().fileIds,
		emitOnError: false,
		checkOnly: false,
		previouslyOwnedPaths: ["assets/stale.js"],
		existingOutput: null,
		priorSchemaLock: null,
		migrations: [],
		appliedMigrationIds: [],
		localeBase: {},
	};
	const output = await session.get(
		shopifyBuildProducts.ownedOutput.product(plan),
	);

	assert.equal(
		output.diagnostics.some(
			(diagnostic) => diagnostic.code === "OUTPUT_PATH_COLLISION",
		),
		true,
	);
	assert.deepEqual(output.deletes, ["assets/stale.js"]);
});

test("target facts retain stable source ownership", async () => {
	const session = await targetSession({
		"assets/theme.css": ".card { color: red }",
	});
	const facts = await session.get(
		shopifyProducts.facts.product(id("assets/theme.css")),
	);
	assert.equal(facts.role, "asset");
	assert.equal(
		facts.facts.every((fact) => fact.owner.path === "assets/theme.css"),
		true,
	);
	assert.equal(
		new Set(facts.facts.map((fact) => fact.id)).size,
		facts.facts.length,
	);
});
