import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
	getThemeAffectedPages,
	getThemeDependencies,
	getThemeDependents,
	getThemeNode,
	type InspectNazareThemeResult,
	inspectNazareTheme,
	summarizeThemeGraph,
} from "@nazare/compiler";

export async function serveThemeGraph(
	root: string,
	input: Readable,
	output: Writable,
): Promise<void> {
	let graph = await loadGraph(root);
	const readline = createInterface({ input, crlfDelay: Infinity });
	for await (const line of readline) {
		if (!line.trim()) continue;
		const request = parseRequest(line);
		try {
			const result = await handleRequest(
				request,
				root,
				() => graph,
				(next) => {
					graph = next;
				},
			);
			writeResponse(output, { id: request.id, result });
		} catch (error) {
			writeResponse(output, {
				id: request.id,
				error: {
					code: "REQUEST_FAILED",
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}
}

type GraphRequest = {
	id: string | number | null;
	method: string;
	params?: Record<string, unknown>;
};

async function handleRequest(
	request: GraphRequest,
	root: string,
	getGraph: () => InspectNazareThemeResult,
	setGraph: (graph: InspectNazareThemeResult) => void,
): Promise<unknown> {
	if (request.method === "initialize") {
		return {
			protocolVersion: 1,
			methods: [
				"inspect",
				"reload",
				"summary",
				"node",
				"dependencies",
				"dependents",
				"affectedPages",
			],
		};
	}
	if (request.method === "reload" || request.method === "inspect") {
		const graph = await loadGraph(root);
		setGraph(graph);
		return graph;
	}
	const graph = getGraph();
	if (request.method === "summary") return summarizeThemeGraph(graph);
	const nodeId = requiredString(request.params, "nodeId");
	if (request.method === "node") return getThemeNode(graph, nodeId) ?? null;
	if (request.method === "dependencies")
		return getThemeDependencies(graph, nodeId);
	if (request.method === "dependents") return getThemeDependents(graph, nodeId);
	if (request.method === "affectedPages")
		return getThemeAffectedPages(graph, nodeId);
	throw new Error(`Unknown graph server method ${request.method}`);
}

async function loadGraph(root: string): Promise<InspectNazareThemeResult> {
	const files = await collectThemeFiles(root);
	const metafields = await optionalFile(root, ".shopify/metafields.json");
	const themeCheck = await optionalFile(root, ".theme-check.yml");
	return inspectNazareTheme(files, { metafields, themeCheck });
}

async function collectThemeFiles(
	root: string,
): Promise<{ path: string; contents: string }[]> {
	const files: { path: string; contents: string }[] = [];
	async function walk(directory: string): Promise<void> {
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if ([".git", ".nazare-out", "node_modules"].includes(entry.name))
				continue;
			const absolute = join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(absolute);
				continue;
			}
			if (!entry.isFile()) continue;
			const path = relative(root, absolute).split(sep).join("/");
			if (!isThemeFile(path)) continue;
			files.push({ path, contents: await readFile(absolute, "utf8") });
		}
	}
	await walk(root);
	return files.sort((a, b) => a.path.localeCompare(b.path));
}

function isThemeFile(path: string): boolean {
	return (
		path.endsWith(".liquid") ||
		path.endsWith(".json") ||
		path.startsWith("assets/")
	);
}

async function optionalFile(
	root: string,
	path: string,
): Promise<{ path: string; contents: string } | undefined> {
	try {
		return { path, contents: await readFile(join(root, path), "utf8") };
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			(error as NodeJS.ErrnoException).code === "ENOENT"
		)
			return undefined;
		throw error;
	}
}

function parseRequest(line: string): GraphRequest {
	const value: unknown = JSON.parse(line);
	if (!value || typeof value !== "object")
		throw new Error("Request must be an object");
	const request = value as Partial<GraphRequest>;
	if (typeof request.method !== "string" || request.method.length === 0)
		throw new Error("Request method must be a non-empty string");
	return {
		id: request.id ?? null,
		method: request.method,
		params: request.params,
	};
}

function requiredString(
	params: Record<string, unknown> | undefined,
	key: string,
): string {
	const value = params?.[key];
	if (typeof value !== "string" || value.length === 0)
		throw new Error(`Missing string parameter ${key}`);
	return value;
}

function writeResponse(output: Writable, response: unknown): void {
	output.write(`${JSON.stringify(response)}\n`);
}
