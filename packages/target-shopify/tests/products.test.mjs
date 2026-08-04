import assert from "node:assert/strict";
import test from "node:test";
import {
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
	shopifyProducts,
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
	shopifySemanticTarget().registerComputations(session.graph);
	return session;
}

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
