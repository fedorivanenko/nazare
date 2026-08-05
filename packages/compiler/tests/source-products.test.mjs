import assert from "node:assert/strict";
import test from "node:test";
import {
	createDefaultSourceFrontendRegistry,
	createProjectSession,
	createSourceFrontendRegistry,
	createSourceProductRegistrar,
	defineInputProvider,
	defineProjectHost,
	defineSourceFrontend,
	fingerprintProductKey,
	projectFileId,
	sourceProducts,
} from "../dist/testing.js";

function id(path) {
	return projectFileId({ workspace: "test", package: "theme", path });
}

function createMemoryHost(sources) {
	const files = new Map(
		Object.entries(sources).map(([path, contents]) => [
			path,
			{ id: id(path), contents },
		]),
	);
	return defineProjectHost({
		files: defineInputProvider({
			id: "test.source-files",
			version: 1,
			async read(fileId) {
				const value = files.get(fileId.path);
				if (!value) throw new Error(`Missing source ${fileId.path}`);
				return { value, fingerprint: fingerprintProductKey(value.contents) };
			},
		}),
		async discover() {
			return [...files.values()].map((file) => file.id);
		},
	});
}

function dependencyFrontend(calls) {
	return defineSourceFrontend({
		id: "test.dependencies",
		version: 1,
		language: "test-dependencies",
		accepts(file) {
			return file.id.path.endsWith(".dep");
		},
		async parse(file) {
			calls.parse++;
			return {
				file,
				syntax: {
					value: file.contents.split(/\s+/).filter(Boolean),
				},
				diagnostics: [],
				uncertainty: [],
			};
		},
		async extractFacts(parsed) {
			calls.facts++;
			return {
				file: parsed.file.id,
				facts: parsed.syntax.value.map((path, index) => ({
					id: `${parsed.file.id.path}:${index}`,
					kind: "dependency",
					file: parsed.file.id,
					data: { path, relative: true, kind: "test-import" },
				})),
				diagnostics: [],
				uncertainty: [],
			};
		},
	});
}

async function createSourceSession(sources, calls = { parse: 0, facts: 0 }) {
	const host = createMemoryHost(sources);
	const session = await createProjectSession({ host });
	const frontends = createSourceFrontendRegistry([dependencyFrontend(calls)]);
	const registrar = createSourceProductRegistrar({ host, frontends });
	registrar.registerComputations(session.graph);
	return { session, calls };
}

test("default frontends classify supported languages and opaque inputs", async () => {
	const host = createMemoryHost({
		"component.nz.liquid": "{% import Card from './card.nz.liquid' %}",
		"theme.liquid": "{% render 'card' %}",
		"data.json": "{}",
		"theme.css": ".card { color: red }",
		"theme.js": "export const value = 1;",
		"logo.svg": "<svg />",
		README: "unknown",
	});
	const session = await createProjectSession({ host });
	createSourceProductRegistrar({
		host,
		frontends: createDefaultSourceFrontendRegistry(),
	}).registerComputations(session.graph);
	const expected = {
		"component.nz.liquid": "nazare-liquid",
		"theme.liquid": "liquid",
		"data.json": "json",
		"theme.css": "css",
		"theme.js": "javascript",
		"logo.svg": "asset",
		README: "opaque",
	};
	for (const [path, language] of Object.entries(expected)) {
		const classified = await session.get(
			sourceProducts.classified.product(id(path)),
		);
		assert.equal(classified.language, language, path);
	}
});

test("default frontends emit neutral language facts and direct dependencies", async () => {
	const host = createMemoryHost({
		"component.nz.liquid": "{% import Card from './card.nz.liquid' %}",
		"card.nz.liquid": "",
		"theme.liquid": "{% render 'card' %}",
		"theme.css": ".card { --color: red }",
	});
	const session = await createProjectSession({ host });
	createSourceProductRegistrar({
		host,
		frontends: createDefaultSourceFrontendRegistry(),
	}).registerComputations(session.graph);
	const nazareFacts = await session.get(
		sourceProducts.facts.product(id("component.nz.liquid")),
	);
	const liquidFacts = await session.get(
		sourceProducts.facts.product(id("theme.liquid")),
	);
	const cssFacts = await session.get(
		sourceProducts.facts.product(id("theme.css")),
	);

	assert.equal(
		nazareFacts.facts.some((fact) => fact.kind === "dependency"),
		true,
	);
	assert.equal(
		liquidFacts.facts.some((fact) => fact.kind === "liquid.reference"),
		true,
	);
	assert.equal(
		cssFacts.facts.some((fact) => fact.kind === "source.behavior"),
		true,
	);
	assert.equal(
		[...nazareFacts.facts, ...liquidFacts.facts, ...cssFacts.facts].some(
			(fact) => "targetRole" in fact.data,
		),
		false,
	);
});

test("frontend registry rejects ambiguous non-fallback classification", () => {
	const frontend = (id) =>
		defineSourceFrontend({
			id,
			version: 1,
			language: id,
			accepts: () => true,
			async parse(file) {
				return {
					file,
					syntax: { value: null },
					diagnostics: [],
					uncertainty: [],
				};
			},
			async extractFacts(parsed) {
				return {
					file: parsed.file.id,
					facts: [],
					diagnostics: [],
					uncertainty: [],
				};
			},
		});
	const registry = createSourceFrontendRegistry([
		frontend("test.one"),
		frontend("test.two"),
	]);
	assert.throws(
		() => registry.select({ id: id("file.any"), contents: "" }),
		/Multiple source frontends accept file.any/,
	);
});

test("classifies, parses, and extracts target-neutral per-file facts", async () => {
	const { session, calls } = await createSourceSession({
		"a.dep": "b.dep",
		"b.dep": "",
	});
	const file = await session.get(
		sourceProducts.classified.product(id("a.dep")),
	);
	const facts = await session.get(sourceProducts.facts.product(id("a.dep")));

	assert.equal(file.language, "test-dependencies");
	assert.equal(file.frontendId, "test.dependencies");
	assert.equal(facts.facts[0].kind, "dependency");
	assert.deepEqual(facts.facts[0].data, {
		path: "b.dep",
		relative: true,
		kind: "test-import",
	});
	assert.deepEqual(calls, { parse: 1, facts: 1 });
});

test("resolves only the dependency closure demanded by roots", async () => {
	const { session, calls } = await createSourceSession({
		"entry.dep": "used.dep",
		"used.dep": "",
		"unused.dep": "",
	});
	const snapshot = session.snapshot();
	const closure = await session.get(
		sourceProducts.closure.product({
			roots: [id("entry.dep")],
			files: snapshot.fileIds,
		}),
	);

	assert.deepEqual(
		closure.files.map((file) => file.path),
		["entry.dep", "used.dep"],
	);
	assert.equal(calls.parse, 2);
	assert.equal(calls.facts, 2);
});

test("reports missing dependencies without parsing unrelated files", async () => {
	const { session, calls } = await createSourceSession({
		"entry.dep": "missing.dep",
		"unused.dep": "",
	});
	const closureProduct = sourceProducts.closure.product({
		roots: [id("entry.dep")],
		files: session.snapshot().fileIds,
	});
	const closure = await session.get(closureProduct);
	const metadata = await session.graph.metadata(closureProduct);

	assert.equal(closure.diagnostics[0].code, "SOURCE_DEPENDENCY_NOT_FOUND");
	assert.equal(metadata.diagnostics[0].code, "SOURCE_DEPENDENCY_NOT_FOUND");
	assert.equal(calls.parse, 1);
});

test("file revision updates invalidate only the changed source chain", async () => {
	const sources = { "a.dep": "", "b.dep": "" };
	const calls = { parse: 0, facts: 0 };
	const host = createMemoryHost(sources);
	const session = await createProjectSession({ host });
	createSourceProductRegistrar({
		host,
		frontends: createSourceFrontendRegistry([dependencyFrontend(calls)]),
	}).registerComputations(session.graph);
	await session.get(sourceProducts.facts.product(id("a.dep")));
	await session.get(sourceProducts.facts.product(id("b.dep")));
	await session.apply({
		kind: "files",
		changes: [
			{
				kind: "changed",
				key: id("a.dep"),
				fingerprint: fingerprintProductKey("changed"),
			},
		],
	});
	// The provider remains deliberately unchanged; the stale read is rejected
	// before a changed revision can be published as valid source data.
	await assert.rejects(
		session.get(sourceProducts.facts.product(id("a.dep"))),
		/changed during computation/,
	);
	assert.equal(
		await session
			.get(sourceProducts.facts.product(id("b.dep")))
			.then(() => true),
		true,
	);
	assert.deepEqual(calls, { parse: 2, facts: 2 });
});
