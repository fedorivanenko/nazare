import assert from "node:assert/strict";
import test from "node:test";
import {
	createCapabilityRegistry,
	createDefaultSourceFrontendRegistry,
	createProjectSession,
	createSourceProductRegistrar,
	defineInputProvider,
	defineProjectHost,
	fingerprintProductKey,
	projectFileId,
} from "@nazare/compiler";
import {
	classifyShopifyFile,
	shopifyGraphProducts,
	shopifyProducts,
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

async function targetSession(sources) {
	const host = memoryHost(sources);
	const session = await createProjectSession({ host });
	createSourceProductRegistrar({
		host,
		frontends: createDefaultSourceFrontendRegistry(),
	}).registerComputations(session.graph);
	const capabilities = createCapabilityRegistry([shopifySemanticTarget()]);
	capabilities.registerComputations(session.graph);
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
			files: session.snapshot().fileIds,
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
			files: session.snapshot().fileIds,
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
		files: session.snapshot().fileIds,
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
		files: session.snapshot().fileIds,
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
			files: session.snapshot().fileIds,
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
