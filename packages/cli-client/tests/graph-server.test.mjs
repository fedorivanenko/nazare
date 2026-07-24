import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Writable } from "node:stream";
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
		Readable.from(`${requests.map(JSON.stringify).join("\n")}\n`),
		output,
	);
	return responses;
}

test("graph server supports MCP tools and build updates", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-graph-server-"));
	try {
		await writeFile(join(root, "card.nz.liquid"), "<span>Card</span>");
		const responses = await runServer(root, [
			{ jsonrpc: "2.0", id: 1, method: "initialize" },
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
		assert.equal(responses[0].result.capabilities.tools !== undefined, true);
		assert.ok(
			responses[1].result.tools.some((tool) => tool.name === "affectedPages"),
		);
		assert.ok(responses[2].result.structuredContent.fileCount >= 1);
		assert.equal(responses[3].result.revision, 1);
		assert.ok(responses[3].result.changedOutputPaths.length > 0);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
