import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable, Writable } from "node:stream";
import test from "node:test";
import { serveThemeGraph } from "../dist/graph-server.js";

async function runServer(root, requests) {
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
	);
	return responses;
}

function startLiveServer(root) {
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
	const done = serveThemeGraph(root, input, output);
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
				id: 4,
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
			responses[1].result.tools.every(
				(tool) => tool.inputSchema.additionalProperties === false,
			),
		);
		assert.ok(responses[2].result.structuredContent.fileCount >= 1);
		assert.equal(responses[2].result.isError, false);
		assert.equal(responses[3].result.revision, 1);
		assert.ok(responses[3].result.changedOutputPaths.length > 0);
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

test("watcher debounces events, suppresses no-ops, and orders notifications", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-graph-watcher-"));
	let server;
	try {
		const cardPath = join(root, "card.nz.liquid");
		const badgePath = join(root, "badge.nz.liquid");
		await writeFile(cardPath, "<span>Card</span>");
		server = startLiveServer(root);
		server.send({ id: 1, method: "watch" });
		await waitFor(
			() => server.messages.some((message) => message.id === 1),
			"watch response",
		);

		await writeFile(cardPath, "<span>First</span>");
		await writeFile(cardPath, "<span>Second</span>");
		await writeFile(cardPath, "<span>Final</span>");
		await waitFor(
			() => watcherUpdates(server.messages).length === 2,
			"debounced edit notifications",
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
		await delay(150);
		assert.equal(watcherUpdates(server.messages).length, 2);

		await writeFile(cardPath, "<span>Final</span>");
		await delay(150);
		assert.equal(watcherUpdates(server.messages).length, 2);

		await writeFile(badgePath, "<strong>Badge</strong>");
		await waitFor(
			() => watcherUpdates(server.messages).length === 4,
			"add notifications",
		);
		await unlink(badgePath);
		await waitFor(
			() => watcherUpdates(server.messages).length === 6,
			"delete notifications",
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
