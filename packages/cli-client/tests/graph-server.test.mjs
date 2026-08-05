import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import test from "node:test";
import { serveThemeGraph } from "../dist/graph-server.js";

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
	await serveThemeGraph(
		root,
		Readable.from(
			`${requests
				.map((request) =>
					typeof request === "string" ? request : JSON.stringify(request),
				)
				.join("\n")}\n`,
		),
		output,
		{ projectRoot },
	);
	return responses;
}

/**
 * How long the watcher coalesces events for, in the tests that care.
 *
 * A burst of edits only collapses into one notification if the burst finishes
 * inside the window, and a machine under load can spread three awaited writes
 * over half a second — measured, not guessed. The production default is 40ms,
 * which is right for an editor and far too tight to assert against here, so
 * these tests say the window they mean and leave several times the margin.
 */
const TEST_DEBOUNCE_MS = 2_000;

function startLiveServer(root, { watchDebounceMs } = {}) {
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
	const done = serveThemeGraph(root, input, output, {
		projectRoot: root,
		...(watchDebounceMs === undefined ? {} : { watchDebounceMs }),
	});
	return {
		messages,
		done,
		send(request) {
			input.write(`${JSON.stringify(request)}\n`);
		},
		close() {
			input.end();
		},
	};
}

async function waitFor(predicate, description, timeout = 5_000) {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > timeout) {
			throw new Error(`Timed out waiting for ${description}`);
		}
		await delay(10);
	}
}

/** A watcher update naming exactly this path. */
const hasPath = (path) => (message) =>
	message.params.changedPaths?.length === 1 &&
	message.params.changedPaths[0] === path;

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function watcherUpdates(messages) {
	return messages.filter(
		(message) =>
			message.method === "graph/update" || message.method === "build/update",
	);
}

test("graph server supports MCP tools and build updates", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-graph-server-"));
	try {
		await writeFile(join(root, "card.nz.liquid"), "<span>Card</span>");
		const responses = await runServer(root, [
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: "2025-03-26",
					capabilities: {},
					clientInfo: { name: "test-client", version: "1" },
				},
			},
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			{
				jsonrpc: "2.0",
				id: 3,
				method: "tools/call",
				params: { name: "summary", arguments: {} },
			},
			{
				jsonrpc: "2.0",
				id: 4,
				method: "tools/call",
				params: {
					name: "fileImpact",
					arguments: { path: "card.nz.liquid" },
				},
			},
			{
				id: 5,
				method: "buildUpdate",
				params: { path: "card.nz.liquid", contents: "<span>Updated</span>" },
			},
		]);
		assert.equal(responses[0].result.protocolVersion, "2025-03-26");
		assert.equal(responses[0].result.capabilities.tools !== undefined, true);
		assert.ok(
			responses[1].result.tools.some((tool) => tool.name === "affectedPages"),
		);
		assert.ok(
			responses[1].result.tools.some((tool) => tool.name === "fileImpact"),
		);
		assert.ok(
			responses[1].result.tools.some(
				(tool) => tool.name === "renderOccurrences",
			),
		);
		assert.ok(
			responses[1].result.tools.some((tool) => tool.name === "evidence"),
		);
		assert.ok(
			responses[1].result.tools.some((tool) => tool.name === "behaviorUsages"),
		);
		assert.ok(
			responses[1].result.tools.some(
				(tool) => tool.name === "behaviorConnections",
			),
		);
		assert.ok(
			responses[1].result.tools.every(
				(tool) => tool.inputSchema.additionalProperties === false,
			),
		);
		assert.ok(responses[2].result.structuredContent.fileCount >= 1);
		assert.equal(responses[2].result.isError, false);
		assert.equal(responses[3].result.structuredContent.path, "card.nz.liquid");
		assert.equal(responses[3].result.isError, false);
		assert.equal(responses[4].result.revision, 1);
		assert.ok(responses[4].result.changedOutputPaths.length > 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("graph server serves demand-driven ProjectSession query products", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-product-query-server-"));
	try {
		await mkdir(join(root, "sections"));
		await mkdir(join(root, "snippets"));
		await writeFile(join(root, "sections/main.liquid"), "{% render 'card' %}");
		await writeFile(join(root, "snippets/card.liquid"), "<span>Card</span>");
		const responses = await runServer(root, [
			{ id: 1, method: "projectModel" },
			{ id: 2, method: "projectGraph" },
			{ id: 3, method: "impact", params: { path: "snippets/card.liquid" } },
			{
				id: 4,
				method: "unusedFiles",
				params: { roots: ["sections/main.liquid"] },
			},
			{
				id: 5,
				method: "updateFile",
				params: { path: "sections/main.liquid", contents: "<main />" },
			},
			{ id: 6, method: "projectGraph" },
		]);

		assert.equal(responses[0].result.version, 1);
		assert.equal(responses[1].result.version, 1);
		assert.equal(responses[1].result.graph.edges.length, 1);
		assert.deepEqual(
			responses[2].result.affected.map((file) => file.path),
			["sections/main.liquid", "snippets/card.liquid"],
		);
		assert.deepEqual(responses[3].result.files, []);
		assert.equal(responses[5].result.graph.edges.length, 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("graph server queries cross-language behavior and JavaScript owners", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-behavior-server-"));
	try {
		await mkdir(join(root, "snippets"));
		await mkdir(join(root, "assets"));
		await writeFile(
			join(root, "snippets/card.liquid"),
			"<div data-product-card></div>",
		);
		await writeFile(
			join(root, "assets/card.js"),
			"export function initializeProductCard() { return document.querySelector('[data-product-card]'); }",
		);
		const [usages, connections] = await runServer(root, [
			{
				id: 1,
				method: "behaviorUsages",
				params: {
					subjectKind: "domHook",
					hookKind: "attribute",
					name: "data-product-card",
					role: "consumers",
				},
			},
			{
				id: 2,
				method: "behaviorConnections",
				params: { path: "snippets/card.liquid" },
			},
		]);
		assert.equal(
			usages.result.usages[0].javaScriptOwner.name,
			"initializeProductCard",
		);
		assert.equal(usages.result.role, "consumers");
		assert.equal(usages.result.certainty, "complete");
		assert.equal(
			connections.result.connections[0].consumers[0].fromPath,
			"assets/card.js",
		);
		const invalid = await runServer(root, [
			{
				id: 3,
				method: "behaviorUsages",
				params: {
					subjectKind: "domHook",
					hookKind: "attribute",
					name: "data-product-card",
				},
			},
			{
				id: 4,
				method: "behaviorUsages",
				params: {
					subjectKind: "customEvent",
					hookKind: "attribute",
					name: "card:ready",
					role: "consumers",
				},
			},
			{
				id: 5,
				method: "behaviorConnections",
				params: { path: "missing.js" },
			},
		]);
		assert.equal(invalid[0].error.code, -32602);
		assert.equal(invalid[0].error.message, "Missing string parameter role");
		assert.equal(invalid[1].error.code, -32602);
		assert.equal(
			invalid[1].error.message,
			"hookKind is valid only when subjectKind is domHook",
		);
		assert.equal(invalid[2].error.code, -32602);
		assert.equal(invalid[2].error.message, "Unknown theme path: missing.js");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("graph server uses inspect file selection and exclusion policy", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-graph-inputs-"));
	try {
		const sourceRoot = join(root, "theme");
		await mkdir(join(sourceRoot, "templates"), { recursive: true });
		await mkdir(join(sourceRoot, "snippets"));
		await writeFile(
			join(sourceRoot, "templates/index.json"),
			JSON.stringify({ sections: {}, order: [] }),
		);
		await writeFile(join(sourceRoot, "snippets/generated.liquid"), "generated");
		await writeFile(
			join(sourceRoot, "package.json"),
			JSON.stringify({ private: true }),
		);
		await writeFile(
			join(root, "nazare.theme.json"),
			JSON.stringify({ inspect: { exclude: ["snippets/**"] } }),
		);

		const [response] = await runServer(
			sourceRoot,
			[{ id: 1, method: "inspect" }],
			root,
		);
		assert.equal(response.result.version, 1);
		assert.deepEqual(
			response.result.classifications.map(
				(classification) => classification.file.path,
			),
			["templates/index.json"],
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("graph server implements MCP lifecycle and JSON-RPC errors", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-mcp-server-"));
	try {
		await writeFile(join(root, "card.nz.liquid"), "<span>Card</span>");
		const responses = await runServer(root, [
			"{invalid json",
			{ jsonrpc: "1.0", id: 1, method: "ping" },
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			{
				jsonrpc: "2.0",
				id: 3,
				method: "initialize",
				params: {},
			},
			{
				jsonrpc: "2.0",
				id: 4,
				method: "initialize",
				params: {
					protocolVersion: "unsupported-version",
					capabilities: {},
					clientInfo: { name: "test-client", version: "1" },
				},
			},
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", method: "ping" },
			{ jsonrpc: "2.0", id: 5, method: "ping" },
			{ jsonrpc: "2.0", id: 6, method: "missing/method" },
			{
				jsonrpc: "2.0",
				id: 7,
				method: "tools/call",
				params: { name: "missing-tool", arguments: {} },
			},
			{
				jsonrpc: "2.0",
				id: 8,
				method: "tools/call",
				params: { name: "node", arguments: {} },
			},
			{
				jsonrpc: "2.0",
				id: 9,
				method: "tools/call",
				params: { name: "summary", arguments: { extra: true } },
			},
			{
				jsonrpc: "2.0",
				id: 10,
				method: "notifications/initialized",
			},
			{
				jsonrpc: "2.0",
				id: 11,
				method: "tools/call",
				params: { name: "dependencies", arguments: { nodeId: "missing" } },
			},
		]);

		assert.deepEqual(
			responses.map((response) => response.id),
			[null, null, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
		);
		assert.equal(responses[0].error.code, -32700);
		assert.equal(responses[1].error.code, -32600);
		assert.equal(responses[2].error.code, -32600);
		assert.equal(responses[3].error.code, -32602);
		assert.equal(responses[4].result.protocolVersion, "2025-11-25");
		assert.deepEqual(responses[5].result, {});
		assert.equal(responses[6].error.code, -32601);
		assert.equal(responses[7].error.code, -32602);
		assert.match(responses[7].error.message, /Unknown tool/);
		assert.equal(responses[8].error.code, -32602);
		assert.equal(responses[9].error.code, -32602);
		assert.equal(responses[10].error.code, -32600);
		assert.equal(responses[11].result.isError, false);
		assert.equal("structuredContent" in responses[11].result, false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("watcher revisions external metadata through shared input providers", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-external-watcher-"));
	let server;
	try {
		await writeFile(join(root, "card.nz.liquid"), "<span>Card</span>");
		server = startLiveServer(root, { watchDebounceMs: 100 });
		server.send({ id: 1, method: "watch" });
		await waitFor(
			() => server.messages.some((message) => message.id === 1),
			"watch response",
		);
		await writeFile(
			join(root, ".theme-check.yml"),
			"extends: theme-check:recommended",
		);
		await waitFor(
			() =>
				server.messages.some(
					(message) =>
						message.method === "graph/update" &&
						typeof message.params.revision === "number",
				),
			"external input revision",
		);
		const update = server.messages.find(
			(message) => message.method === "graph/update",
		);
		assert.equal(update.params.changedPaths.includes(".theme-check.yml"), true);
		assert.equal(update.params.revision > 0, true);

		await writeFile(
			join(root, "nazare.theme.json"),
			JSON.stringify({ inspect: { exclude: ["*.nz.liquid"] } }),
		);
		await waitFor(
			() =>
				server.messages.some(
					(message) =>
						message.method === "graph/update" &&
						message.params.changedPaths.includes("nazare.theme.json"),
				),
			"config input revision",
		);
		server.send({ id: 2, method: "projectModel" });
		await waitFor(
			() => server.messages.some((message) => message.id === 2),
			"project model response",
		);
		const model = server.messages.find((message) => message.id === 2);
		assert.deepEqual(model.result.classifications, []);
	} finally {
		server?.close();
		await server?.done;
		await rm(root, { recursive: true, force: true });
	}
});

test("watcher debounces events, suppresses no-ops, and orders notifications", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-graph-watcher-"));
	let server;
	try {
		const cardPath = join(root, "card.nz.liquid");
		const badgePath = join(root, "badge.nz.liquid");
		await writeFile(cardPath, "<span>Card</span>");
		server = startLiveServer(root, { watchDebounceMs: TEST_DEBOUNCE_MS });
		server.send({ id: 1, method: "watch" });
		await waitFor(
			() => server.messages.some((message) => message.id === 1),
			"watch response",
		);

		await writeFile(cardPath, "<span>First</span>");
		await writeFile(cardPath, "<span>Second</span>");
		await writeFile(cardPath, "<span>Final</span>");
		await waitFor(
			() => watcherUpdates(server.messages).some(hasPath("card.nz.liquid")),
			"edit notification",
		);
		assert.deepEqual(
			watcherUpdates(server.messages).map((message) => message.method),
			["graph/update", "build/update"],
		);
		assert.ok(
			watcherUpdates(server.messages).every(
				(message) => message.jsonrpc === "2.0",
			),
		);
		assert.deepEqual(
			watcherUpdates(server.messages).map(
				(message) => message.params.changedPaths,
			),
			[["card.nz.liquid"], ["card.nz.liquid"]],
		);
		assert.deepEqual(
			watcherUpdates(server.messages).map((message) => message.params.revision),
			[1, 1],
		);
		// Writing the same bytes changes nothing, so it should notify nothing.
		//
		// "Nothing happened" cannot be proved by sleeping — a slow machine just
		// makes the sleep too short — so the next real change is the barrier
		// instead: notifications are ordered, so once the one for badge has
		// arrived, anything the no-op was going to send would already be here.
		await writeFile(cardPath, "<span>Final</span>");
		await writeFile(badgePath, "<strong>Badge</strong>");
		// Waiting for a count would return the moment enough messages existed,
		// with stragglers still in flight — so the barrier is a message only the
		// later change can produce. The server notifies in order, so once badge's
		// first update is here, everything the burst and the no-op were ever
		// going to send is here too.
		await waitFor(
			() => watcherUpdates(server.messages).some(hasPath("badge.nz.liquid")),
			"add notification",
		);
		assert.deepEqual(
			watcherUpdates(server.messages).map(
				(message) => message.params.changedPaths,
			),
			[
				["card.nz.liquid"],
				["card.nz.liquid"],
				["badge.nz.liquid"],
				["badge.nz.liquid"],
			],
			"the burst collapsed into one pair and the no-op sent none",
		);
		await unlink(badgePath);
		// The delete is the third revision, which is what tells it apart from the
		// add — both name the same path.
		await waitFor(
			() =>
				watcherUpdates(server.messages).some(
					(message) => message.params.revision === 3,
				),
			"delete notification",
		);
		assert.deepEqual(
			watcherUpdates(server.messages).map((message) => message.method),
			[
				"graph/update",
				"build/update",
				"graph/update",
				"build/update",
				"graph/update",
				"build/update",
			],
		);
		assert.deepEqual(
			watcherUpdates(server.messages)
				.slice(2)
				.map((message) => message.params.changedPaths),
			[
				["badge.nz.liquid"],
				["badge.nz.liquid"],
				["badge.nz.liquid"],
				["badge.nz.liquid"],
			],
		);
		assert.deepEqual(
			watcherUpdates(server.messages).map((message) => message.params.revision),
			[1, 1, 2, 2, 3, 3],
		);
	} finally {
		server?.close();
		await server?.done;
		await rm(root, { recursive: true, force: true });
	}
});
