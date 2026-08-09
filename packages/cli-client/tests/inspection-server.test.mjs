import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import test from "node:test";
import { serveInspection } from "../dist/inspection-server.js";

async function runServer(root, requests, projectRoot = root) {
	const responses = [];
	const output = new Writable({
		write(chunk, _encoding, callback) {
			responses.push(
				...chunk.toString().trim().split("\n").filter(Boolean).map(JSON.parse),
			);
			callback();
		},
	});
	await serveInspection(
		root,
		Readable.from(`${requests.map(JSON.stringify).join("\n")}\n`),
		output,
		{ projectRoot },
	);
	return responses;
}

function initialize(id = "initialize") {
	return {
		jsonrpc: "2.0",
		id,
		method: "initialize",
		params: {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "test-client", version: "1" },
		},
	};
}

function toolCall(id, name, arguments_) {
	return {
		jsonrpc: "2.0",
		id,
		method: "tools/call",
		params: { name, arguments: arguments_ },
	};
}

async function createGraphFixture(prefix) {
	const root = await mkdtemp(join(tmpdir(), prefix));
	await mkdir(join(root, "templates"));
	await mkdir(join(root, "sections"));
	await mkdir(join(root, "snippets"));
	await mkdir(join(root, "assets"));
	await writeFile(
		join(root, "templates/product.json"),
		JSON.stringify({ sections: { main: { type: "main" } }, order: ["main"] }),
	);
	await writeFile(join(root, "sections/main.liquid"), "{% render 'card' %}");
	await writeFile(
		join(root, "snippets/card.liquid"),
		"<article data-product-card></article>",
	);
	await writeFile(
		join(root, "assets/card.js"),
		"export function initializeCard() { return document.querySelector('[data-product-card]'); }",
	);
	return root;
}

test("inspection server exposes only find, traverse, and evidence", async () => {
	const root = await createGraphFixture("nazare-public-inspection-");
	try {
		const responses = await runServer(root, [
			initialize(),
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: "tools", method: "tools/list" },
			toolCall("file", "find", {
				kinds: ["file"],
				path: "snippets/card.liquid",
			}),
			toolCall("behavior", "find", {
				kinds: ["behavior"],
				identity: {
					subjectKind: "domHook",
					hookKind: "attribute",
					name: "data-product-card",
				},
			}),
			toolCall("impact", "traverse", {
				startIds: ["file:snippets/card.liquid"],
				direction: "incoming",
				relationCategories: ["dependency"],
				targetKinds: ["file"],
				depth: 2,
			}),
			toolCall("graph", "traverse", {
				startIds: ["project:theme"],
				direction: "outgoing",
				depth: 8,
				limit: 200,
				evidence: "inline",
			}),
		]);

		assert.equal(responses[0].result.serverInfo.name, "nazare-inspect");
		assert.deepEqual(
			responses[1].result.tools.map(({ name }) => name),
			["find", "traverse", "evidence"],
		);
		assert.ok(
			responses[1].result.tools.every(
				(tool) =>
					tool.inputSchema.additionalProperties === false &&
					tool.outputSchema.properties.contractVersion.const === 2,
			),
		);

		const file = responses[2].result;
		assert.equal(file.isError, false);
		assert.equal(file.structuredContent.contractVersion, 2);
		assert.equal(
			file.structuredContent.result.entities[0].id,
			"file:snippets/card.liquid",
		);
		assert.equal(file.content[0].text, "1 entity; completeness=complete");
		assert.equal(file.content[0].text.includes("structuredContent"), false);

		const behavior = responses[3].result.structuredContent.result.entities[0];
		assert.equal(behavior.kind, "behavior");
		assert.equal(behavior.name, "data-product-card");

		const traversal = responses[4].result.structuredContent;
		assert.equal(traversal.result.relations.length, 2);
		assert.ok(traversal.result.matches.includes("file:templates/product.json"));
		assert.ok(
			traversal.result.relations.every(
				(relation) => relation.category === "dependency",
			),
		);

		const graph = responses[5].result.structuredContent.result;
		const entityIds = new Set(graph.entities.map(({ id }) => id));
		const evidenceIds = new Set(graph.evidence.map(({ id }) => id));
		assert.ok(
			graph.relations.every(
				(relation) =>
					entityIds.has(relation.from) &&
					entityIds.has(relation.to) &&
					(relation.evidenceIds ?? []).every((id) => evidenceIds.has(id)),
			),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("public graph projects JavaScript owners, behavior relations, and evidence", async () => {
	const root = await createGraphFixture("nazare-public-behavior-");
	try {
		const responses = await runServer(root, [
			initialize(),
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			toolCall("behavior", "traverse", {
				startIds: ["behavior:domHook:attribute:data-product-card"],
				direction: "incoming",
				relationCategories: ["behavior"],
				depth: 1,
				evidence: "inline",
			}),
		]);
		const result = responses[1].result.structuredContent.result;
		assert.ok(result.relations.some(({ kind }) => kind === "produces"));
		assert.ok(result.relations.some(({ kind }) => kind === "consumes"));
		assert.ok(
			result.entities.some(
				(entity) =>
					entity.kind === "declaration" && entity.name === "initializeCard",
			),
		);
		assert.ok(result.evidence.length >= 2);

		const evidenceId = result.evidence[0].id;
		const evidenceResponses = await runServer(root, [
			initialize(),
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			toolCall("evidence", "evidence", { ids: [evidenceId] }),
		]);
		assert.equal(
			evidenceResponses[1].result.structuredContent.result.evidence[0].id,
			evidenceId,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("inspection server validates MCP lifecycle and public tool arguments", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-public-mcp-errors-"));
	try {
		await writeFile(join(root, "card.nz.liquid"), "<span>Card</span>");
		const responses = await runServer(root, [
			{ jsonrpc: "2.0", id: 1, method: "tools/list" },
			initialize(2),
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			toolCall(3, "projectModel", {}),
			toolCall(4, "find", {}),
			toolCall(5, "find", { path: "card.nz.liquid", extra: true }),
			toolCall(6, "traverse", {
				startIds: ["file:missing.liquid"],
				direction: "both",
			}),
		]);
		assert.equal(responses[0].error.message, "Server not initialized");
		assert.equal(responses[2].error.message, "Unknown tool: projectModel");
		assert.match(responses[3].error.message, /find requires/);
		assert.equal(responses[4].error.message, "Unknown tool argument: extra");
		assert.match(responses[5].error.message, /Unknown entity ID/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("inspection input exclusions apply to public entities", async () => {
	const projectRoot = await mkdtemp(join(tmpdir(), "nazare-public-exclusion-"));
	try {
		const root = join(projectRoot, "theme");
		await mkdir(join(root, "snippets"), { recursive: true });
		await mkdir(join(root, "templates"));
		await writeFile(join(root, "snippets/generated.liquid"), "generated");
		await writeFile(
			join(root, "templates/index.json"),
			JSON.stringify({ sections: {}, order: [] }),
		);
		await writeFile(
			join(projectRoot, "nazare.theme.json"),
			JSON.stringify({ inspect: { exclude: ["snippets/**"] } }),
		);
		const responses = await runServer(
			root,
			[
				initialize(),
				{ jsonrpc: "2.0", method: "notifications/initialized" },
				toolCall("excluded", "find", {
					kinds: ["file"],
					path: "snippets/generated.liquid",
				}),
			],
			projectRoot,
		);
		assert.equal(
			responses[1].result.structuredContent.result.entities.length,
			0,
		);
	} finally {
		await rm(projectRoot, { recursive: true, force: true });
	}
});

function startLiveServer(root, watchDebounceMs = 40) {
	const input = new PassThrough();
	const messages = [];
	let buffered = "";
	const output = new Writable({
		write(chunk, _encoding, callback) {
			buffered += chunk.toString();
			const lines = buffered.split("\n");
			buffered = lines.pop() ?? "";
			messages.push(...lines.filter(Boolean).map(JSON.parse));
			callback();
		},
	});
	const done = serveInspection(root, input, output, {
		projectRoot: root,
		watchDebounceMs,
	});
	return {
		messages,
		done,
		send(message) {
			input.write(`${JSON.stringify(message)}\n`);
		},
		close() {
			input.end();
		},
	};
}

async function waitFor(predicate, description, timeout = 5_000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeout) {
			throw new Error(`Timed out waiting for ${description}`);
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

async function initializeLiveServer(server) {
	server.send(initialize());
	await waitFor(
		() => server.messages.some(({ id }) => id === "initialize"),
		"initialize",
	);
	server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
}

function watcherUpdates(messages) {
	return messages.filter(({ method }) => method === "inspection/update");
}

test("watcher publishes revisions consumed by later public queries", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-public-watcher-"));
	await writeFile(join(root, "card.nz.liquid"), "<span>Card</span>");
	const server = startLiveServer(root, 100);
	try {
		server.send(initialize());
		await waitFor(
			() => server.messages.some(({ id }) => id === "initialize"),
			"initialize",
		);
		server.send({ jsonrpc: "2.0", method: "notifications/initialized" });
		await writeFile(join(root, "card.nz.liquid"), "<span>Updated</span>");
		await waitFor(
			() =>
				server.messages.some(
					(message) =>
						message.method === "inspection/update" &&
						message.params.changedPaths.includes("card.nz.liquid"),
				),
			"inspection update",
		);
		const update = server.messages.find(
			(message) => message.method === "inspection/update",
		);
		server.send(
			toolCall("find-after-update", "find", {
				kinds: ["file"],
				path: "card.nz.liquid",
			}),
		);
		await waitFor(
			() => server.messages.some(({ id }) => id === "find-after-update"),
			"find response",
		);
		const response = server.messages.find(
			({ id }) => id === "find-after-update",
		);
		assert.equal(
			response.result.structuredContent.revision,
			update.params.revision,
		);
	} finally {
		server.close();
		await server.done;
		await rm(root, { recursive: true, force: true });
	}
});

test("watcher revisions metadata and applies changed exclusions", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-public-metadata-watcher-"));
	await writeFile(join(root, "card.nz.liquid"), "<span>Card</span>");
	const server = startLiveServer(root, 100);
	try {
		await initializeLiveServer(server);
		await writeFile(
			join(root, ".theme-check.yml"),
			"extends: theme-check:recommended",
		);
		await waitFor(
			() =>
				watcherUpdates(server.messages).some(({ params }) =>
					params.changedPaths.includes(".theme-check.yml"),
				),
			"metadata update",
		);
		await writeFile(
			join(root, "nazare.theme.json"),
			JSON.stringify({ inspect: { exclude: ["*.nz.liquid"] } }),
		);
		await waitFor(
			() =>
				watcherUpdates(server.messages).some(({ params }) =>
					params.changedPaths.includes("nazare.theme.json"),
				),
			"configuration update",
		);
		server.send(
			toolCall("excluded-after-update", "find", {
				kinds: ["file"],
				path: "card.nz.liquid",
			}),
		);
		await waitFor(
			() => server.messages.some(({ id }) => id === "excluded-after-update"),
			"find response",
		);
		const response = server.messages.find(
			({ id }) => id === "excluded-after-update",
		);
		assert.deepEqual(response.result.structuredContent.result.entities, []);
	} finally {
		server.close();
		await server.done;
		await rm(root, { recursive: true, force: true });
	}
});

test("watcher debounces bursts, suppresses no-ops, and orders revisions", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-public-debounce-watcher-"));
	const cardPath = join(root, "card.nz.liquid");
	const badgePath = join(root, "badge.nz.liquid");
	await writeFile(cardPath, "<span>Card</span>");
	const server = startLiveServer(root, 2_000);
	try {
		await initializeLiveServer(server);
		await writeFile(cardPath, "<span>First</span>");
		await writeFile(cardPath, "<span>Second</span>");
		await writeFile(cardPath, "<span>Final</span>");
		await waitFor(
			() =>
				watcherUpdates(server.messages).some(({ params }) =>
					params.changedPaths.includes("card.nz.liquid"),
				),
			"debounced edit",
			8_000,
		);
		const firstRevision = watcherUpdates(server.messages)[0].params.revision;
		await writeFile(cardPath, "<span>Final</span>");
		await writeFile(badgePath, "<strong>Badge</strong>");
		await waitFor(
			() =>
				watcherUpdates(server.messages).some(({ params }) =>
					params.changedPaths.includes("badge.nz.liquid"),
				),
			"add update",
			8_000,
		);
		assert.deepEqual(
			watcherUpdates(server.messages).map(({ params }) => params.changedPaths),
			[["card.nz.liquid"], ["badge.nz.liquid"]],
		);
		await unlink(badgePath);
		await waitFor(
			() =>
				watcherUpdates(server.messages).some(
					({ params }) => params.revision === firstRevision + 2,
				),
			"delete update",
			8_000,
		);
		assert.deepEqual(
			watcherUpdates(server.messages).map(({ params }) => params.revision),
			[firstRevision, firstRevision + 1, firstRevision + 2],
		);
	} finally {
		server.close();
		await server.done;
		await rm(root, { recursive: true, force: true });
	}
});
