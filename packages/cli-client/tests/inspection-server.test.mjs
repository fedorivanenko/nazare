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

function toolContent(response) {
	return JSON.parse(response.result.content[0].text);
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

test("inspection server exposes one model-visible semantic inspect tool", async () => {
	const root = await createGraphFixture("nazare-agent-inspection-");
	try {
		const responses = await runServer(root, [
			initialize(),
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			{ jsonrpc: "2.0", id: "tools", method: "tools/list" },
			toolCall("dependencies", "inspect", {
				subject: { type: "file", path: "sections/main.liquid" },
				question: "dependencies",
				evidence: "excerpt",
			}),
			toolCall("behavior", "inspect", {
				subject: {
					type: "behavior",
					kind: "domAttribute",
					name: "data-product-card",
				},
				question: "usages",
				evidence: "excerpt",
			}),
			toolCall("impact", "inspect", {
				subject: { type: "file", path: "snippets/card.liquid" },
				question: "impact",
				limit: 10,
			}),
		]);

		assert.equal(responses[0].result.serverInfo.name, "nazare-inspect");
		assert.deepEqual(
			responses[1].result.tools.map(({ name }) => name),
			["inspect"],
		);
		assert.equal(
			responses[1].result.tools[0].inputSchema.additionalProperties,
			false,
		);
		assert.equal(
			responses[1].result.tools[0].inputSchema.properties.limit.maximum,
			50,
		);
		assert.equal(
			responses[1].result.tools[0].inputSchema.properties.evidence.default,
			"location",
		);
		assert.equal("outputSchema" in responses[1].result.tools[0], false);

		const dependencies = toolContent(responses[2]);
		assert.equal(responses[2].result.isError, false);
		assert.equal("structuredContent" in responses[2].result, false);
		assert.equal(dependencies.contractVersion, 3);
		assert.deepEqual(dependencies.subject, {
			type: "file",
			path: "sections/main.liquid",
			kind: "section",
		});
		assert.equal(
			dependencies.answer.dependencies[0].path,
			"snippets/card.liquid",
		);
		assert.equal(dependencies.answer.dependencies[0].relationship, "renders");
		assert.deepEqual(dependencies.answer.dependencies[0].locations[0], {
			path: "sections/main.liquid",
			start: { line: 1, character: 1 },
			end: { line: 1, character: 20 },
			excerpt: "{% render 'card' %}",
		});
		assert.equal(JSON.stringify(dependencies).includes("shopify-fact:"), false);
		assert.equal(JSON.stringify(dependencies).includes("evidenceIds"), false);

		const behavior = toolContent(responses[3]);
		assert.deepEqual(
			new Set(behavior.answer.usages.map(({ role }) => role)),
			new Set(["producer", "consumer"]),
		);
		assert.ok(
			behavior.answer.usages.every(({ locations }) =>
				locations.every(
					(location) =>
						location.path &&
						location.start.line >= 1 &&
						location.start.character >= 1,
				),
			),
		);

		const impact = toolContent(responses[4]);
		assert.ok(
			impact.answer.impact.some(
				(item) =>
					item.role === "affectedPage" &&
					item.path === "templates/product.json",
			),
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("metafield inspection separates proven and possible Liquid owners", async () => {
	const root = await mkdtemp(join(tmpdir(), "nazare-agent-metafield-"));
	try {
		await mkdir(join(root, "snippets"));
		await writeFile(
			join(root, "snippets/card.liquid"),
			"{% assign exact = product.metafields.custom.subtitle.value %}\n{% assign possible = item.metafields.custom.subtitle.value %}",
		);
		const responses = await runServer(root, [
			initialize(),
			{ jsonrpc: "2.0", method: "notifications/initialized" },
			toolCall("metafield", "inspect", {
				subject: {
					type: "metafield",
					owner: "product",
					namespace: "custom",
					key: "subtitle",
				},
				question: "usages",
				evidence: "excerpt",
			}),
		]);
		const result = toolContent(responses[1]);
		assert.deepEqual(
			new Set(result.answer.usages.map(({ role }) => role)),
			new Set(["reader", "possibleReader"]),
		);
		assert.equal(
			result.answer.usages.find(({ role }) => role === "possibleReader")
				.locations[0].excerpt,
			"item.metafields.custom.subtitle.value",
		);
		assert.equal(result.completeness.status, "partial");
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
			toolCall(4, "inspect", {}),
			toolCall(5, "inspect", {
				subject: { type: "file", path: "card.nz.liquid" },
				extra: true,
			}),
			toolCall(6, "inspect", {
				subject: { type: "file", path: "missing.liquid" },
			}),
		]);
		assert.equal(responses[0].error.message, "Server not initialized");
		assert.equal(responses[2].error.message, "Unknown tool: projectModel");
		assert.equal(responses[3].error.message, "subject must be an object");
		assert.equal(responses[4].error.message, "Unknown tool argument: extra");
		assert.equal(toolContent(responses[5]).status, "notFound");
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
				toolCall("excluded", "inspect", {
					subject: { type: "file", path: "snippets/generated.liquid" },
				}),
			],
			projectRoot,
		);
		assert.equal(toolContent(responses[1]).status, "notFound");
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
			toolCall("inspect-after-update", "inspect", {
				subject: { type: "file", path: "card.nz.liquid" },
			}),
		);
		await waitFor(
			() => server.messages.some(({ id }) => id === "inspect-after-update"),
			"inspect response",
		);
		const response = server.messages.find(
			({ id }) => id === "inspect-after-update",
		);
		assert.equal(toolContent(response).revision, update.params.revision);
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
			toolCall("excluded-after-update", "inspect", {
				subject: { type: "file", path: "card.nz.liquid" },
			}),
		);
		await waitFor(
			() => server.messages.some(({ id }) => id === "excluded-after-update"),
			"find response",
		);
		const response = server.messages.find(
			({ id }) => id === "excluded-after-update",
		);
		assert.equal(toolContent(response).status, "notFound");
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
