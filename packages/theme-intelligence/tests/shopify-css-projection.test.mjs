import assert from "node:assert/strict";
import test from "node:test";
import {
	createShopifySemanticCompiler,
	cssFrontend,
	FactOntologyQuery,
	FactOntologyQueryError,
	projectCssToShopify,
	projectSnapshotToFactOntology,
	SemanticGraphContract,
	shopifyOntology,
} from "../dist/index.js";
import { CssParserProvider } from "../dist/parsers/css/parser.js";

function project(source, path = "assets/theme.css") {
	const parsed = new CssParserProvider().parse({ path, source });
	assert.equal(parsed.ok, true);
	const frontend = cssFrontend.extract({
		document: parsed.document,
		limits: { maxFacts: 1_000, maxWork: 10_000 },
	});
	return projectCssToShopify({ document: parsed.document, frontend });
}

function snapshot(contribution) {
	return {
		contractVersion: 1,
		revision: {
			id: "revision:css",
			compilerVersion: "test",
			repositoryFingerprint: "repository:css",
			externalInputs: {},
		},
		ontologies: [{ namespace: "shopify", version: 6 }],
		entities: contribution.entities,
		occurrences: contribution.occurrences,
		relations: contribution.relations,
		values: contribution.values,
		predicates: contribution.predicates,
		boundaries: contribution.boundaries,
		coverage: contribution.coverage,
		diagnostics: contribution.diagnostics,
	};
}

test("Shopify CSS projection emits scoped class selector symbols", () => {
	const source = ".card.is-active { color: red; }";
	const contribution = project(source);
	const validation = new SemanticGraphContract([shopifyOntology]).validate(
		snapshot(contribution),
	);
	assert.deepEqual(validation.issues, []);
	const symbols = contribution.entities.filter(
		({ kind }) => kind === "shopify.css-class",
	);
	assert.deepEqual(
		symbols.map(({ identity }) => identity.components),
		[
			{ path: "assets/theme.css", name: "card" },
			{ path: "assets/theme.css", name: "is-active" },
		],
	);
	const relations = contribution.relations.filter(
		({ kind }) => kind === "shopify.selects-class",
	);
	assert.equal(relations.length, 2);
	assert.equal(
		relations.every(({ guards }) => guards.length === 0),
		true,
	);
	assert.equal(
		contribution.coverage.find(
			({ family }) => family === "shopify.class-selectors",
		).status,
		"complete",
	);
});

test("same class text remains artifact-scoped before topology joins", () => {
	const output = createShopifySemanticCompiler().compile({
		sources: [
			{ path: "assets/base.css", source: ".is-active { color: red; }" },
			{
				path: "sections/modal.liquid",
				source: '<div class="is-active">Modal</div>',
			},
			{
				path: "assets/modal.js",
				source: "element.classList.add('is-active');",
			},
		],
		revision: { compilerVersion: "css-scope-test", externalInputs: {} },
		repositoryScope: { status: "complete" },
	});
	assert.deepEqual(
		output.report.sources.map(({ path, semanticSupport }) => ({
			path,
			semanticSupport,
		})),
		[
			{ path: "assets/base.css", semanticSupport: "projected" },
			{ path: "assets/modal.js", semanticSupport: "projected" },
			{ path: "sections/modal.liquid", semanticSupport: "projected" },
		],
	);
	const facts = projectSnapshotToFactOntology(output.output.snapshot);
	const symbols = facts.symbols.filter(
		({ kind, name }) => kind === "css.class" && name === "is-active",
	);
	assert.equal(symbols.length, 3);
	assert.equal(new Set(symbols.map(({ ref }) => ref)).size, 3);
	const query = new FactOntologyQuery(facts);
	assert.throws(
		() => query.usesOf("is-active", "css.class"),
		(error) =>
			error instanceof FactOntologyQueryError &&
			error.message.includes("Ambiguous symbol"),
	);
	const base = query.usesOf("is-active", "css.class", "assets/base.css");
	assert.equal(base.uses.total, 1);
	assert.deepEqual(
		base.roles.map(({ role, uses }) => [role, uses]),
		[["selects", 1]],
	);
	assert.deepEqual(base.coverage, {
		family: "class-selectors",
		status: "complete",
		coveredArtifacts: 1,
		completeArtifacts: 1,
		uncertainArtifacts: 0,
		totalArtifacts: 1,
	});
	const markup = query.usesOf(
		"is-active",
		"css.class",
		"sections/modal.liquid",
	);
	assert.deepEqual(
		markup.roles.map(({ role, uses }) => [role, uses]),
		[["emits", 1]],
	);
	assert.equal(markup.coverage.family, "markup-classes");
	assert.equal(markup.coverage.status, "complete");
	const javaScript = query.usesOf("is-active", "css.class", "assets/modal.js");
	assert.deepEqual(
		javaScript.roles.map(({ role, uses }) => [role, uses]),
		[["adds", 1]],
	);
	assert.equal(javaScript.coverage.family, "class-list-operations");
	assert.equal(javaScript.coverage.status, "complete");
	assert.equal(javaScript.uses.items[0].evaluation, "runtime-dependent");
	const javaScriptExpanded = query.expand(javaScript.uses.items[0].ref);
	assert.equal(javaScriptExpanded.fact.evaluation, "runtime-dependent");
	const expanded = query.expand(base.uses.items[0].ref);
	assert.equal(expanded.fact.claim.predicate, "USES");
	assert.equal(expanded.fact.claim.attributes.role, "selects");
	assert.deepEqual(expanded.evidence[0].range, { start: 1, end: 10 });
});
