import { watch as watchDirectory } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
	getThemeNode,
	summarizeThemeGraph,
	ThemeBuildSession,
	type ThemeInputFile,
	ThemeWorkspaceSession,
} from "@nazare/compiler";

export async function serveThemeGraph(
	root: string,
	input: Readable,
	output: Writable,
): Promise<void> {
	let session = await loadSession(root);
	let buildSession = await loadBuildSession(root);
	let stopWatching: (() => void) | undefined;
	const readline = createInterface({ input, crlfDelay: Infinity });
	for await (const line of readline) {
		if (!line.trim()) continue;
		const request = parseRequest(line);
		try {
			const result = await handleRequest(
				request,
				root,
				() => session,
				(next) => {
					session = next;
				},
				() => buildSession,
				(next) => {
					buildSession = next;
				},
				(next) => {
					stopWatching?.();
					stopWatching = next;
				},
				(update) => writeNotification(output, update),
			);
			writeResponse(output, request, { id: request.id, result });
		} catch (error) {
			writeResponse(output, request, {
				id: request.id,
				error: {
					code: "REQUEST_FAILED",
					message: error instanceof Error ? error.message : String(error),
				},
			});
		}
	}
	stopWatching?.();
}

type GraphRequest = {
	jsonrpc?: "2.0";
	id: string | number | null;
	method: string;
	params?: Record<string, unknown>;
};

async function handleRequest(
	request: GraphRequest,
	root: string,
	getSession: () => ThemeWorkspaceSession,
	setSession: (session: ThemeWorkspaceSession) => void,
	getBuildSession: () => ThemeBuildSession,
	setBuildSession: (session: ThemeBuildSession) => void,
	setWatcher: (stop: () => void) => void,
	notify: (update: unknown) => void,
): Promise<unknown> {
	if (request.method === "tools/list") return { tools: graphTools() };
	if (request.method === "tools/call") {
		const name = requiredString(request.params, "name");
		const args = request.params?.arguments;
		if (args !== undefined && (!args || typeof args !== "object")) {
			throw new Error("tools/call arguments must be an object");
		}
		const result = await handleRequest(
			{
				id: request.id,
				method: name,
				params: args as Record<string, unknown> | undefined,
			},
			root,
			getSession,
			setSession,
			getBuildSession,
			setBuildSession,
			setWatcher,
			notify,
		);
		return {
			content: [{ type: "text", text: JSON.stringify(result) }],
			structuredContent: result,
		};
	}
	if (request.method === "initialize") {
		return {
			protocolVersion: "2024-11-05",
			capabilities: { tools: {} },
			serverInfo: { name: "nazare-theme-graph", version: "1" },
			methods: [
				"inspect",
				"reload",
				"updateFile",
				"removeFile",
				"watch",
				"unwatch",
				"summary",
				"node",
				"dependencies",
				"dependents",
				"affectedPages",
				"build",
				"buildUpdate",
			],
		};
	}
	if (request.method === "reload" || request.method === "inspect") {
		const session = await loadSession(root);
		setSession(session);
		setBuildSession(await loadBuildSession(root));
		return session.getGraph();
	}
	const session = getSession();
	if (request.method === "build") return getBuildSession().getBuild();
	if (request.method === "updateFile") {
		const file = requiredFile(request.params);
		const graphUpdate = session.updateFile(file);
		getBuildSession().updateFile(file);
		return graphUpdate;
	}
	if (request.method === "buildUpdate") {
		const file = requiredFile(request.params);
		session.updateFile(file);
		return getBuildSession().updateFile(file);
	}
	if (request.method === "removeFile") {
		const path = requiredString(request.params, "path");
		const graphUpdate = session.removeFile(path);
		getBuildSession().removeFile(path);
		return graphUpdate;
	}
	if (request.method === "watch") {
		setWatcher(startWatcher(root, getSession, getBuildSession, notify));
		return { watching: true };
	}
	if (request.method === "unwatch") {
		setWatcher(() => undefined);
		return { watching: false };
	}
	const graph = session.getGraph();
	if (request.method === "summary") return summarizeThemeGraph(graph);
	const nodeId = requiredString(request.params, "nodeId");
	if (request.method === "node") return getThemeNode(graph, nodeId) ?? null;
	if (request.method === "dependencies") return session.getDependencies(nodeId);
	if (request.method === "dependents") return session.getDependents(nodeId);
	if (request.method === "affectedPages")
		return session.getAffectedPages(nodeId);
	throw new Error(`Unknown graph server method ${request.method}`);
}

const WATCH_DEBOUNCE_MS = 40;

function startWatcher(
	root: string,
	getSession: () => ThemeWorkspaceSession,
	getBuildSession: () => ThemeBuildSession,
	notify: (update: unknown) => void,
): () => void {
	let closed = false;
	let pending = Promise.resolve();
	const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const watcher = watchDirectory(
		root,
		{ recursive: true },
		(_event, filename) => {
			const relativePath = filename?.toString().split("\\").join("/");
			if (!relativePath || !isWatchedPath(relativePath)) return;
			const previousTimer = debounceTimers.get(relativePath);
			if (previousTimer) clearTimeout(previousTimer);
			debounceTimers.set(
				relativePath,
				setTimeout(() => {
					debounceTimers.delete(relativePath);
					pending = pending
						.then(() => processWatchedPath(relativePath))
						.catch((error) => {
							if (closed) return;
							notify({
								method: "graph/error",
								error: error instanceof Error ? error.message : String(error),
							});
						});
				}, WATCH_DEBOUNCE_MS),
			);
		},
	);

	async function processWatchedPath(relativePath: string): Promise<void> {
		if (closed) return;
		const session = getSession();
		if (isThemeFile(relativePath)) {
			try {
				const contents = await readFile(join(root, relativePath), "utf8");
				const file = { path: relativePath, contents };
				const graphUpdate = session.updateFile(file);
				const buildUpdate = getBuildSession().updateFile(file);
				if (closed) return;
				if (graphUpdate.changedPaths.length > 0) {
					notify({ method: "graph/update", params: graphUpdate });
				}
				if (buildUpdate.changedPaths.length > 0) {
					notify({ method: "build/update", params: buildUpdate });
				}
			} catch (error) {
				if (!isNotFound(error)) throw error;
				const graphUpdate = session.removeFile(relativePath);
				const buildUpdate = getBuildSession().removeFile(relativePath);
				if (closed) return;
				if (graphUpdate.changedPaths.length > 0) {
					notify({ method: "graph/update", params: graphUpdate });
				}
				if (buildUpdate.changedPaths.length > 0) {
					notify({ method: "build/update", params: buildUpdate });
				}
			}
			return;
		}
		const update = await session.updateExternalArtifacts({
			metafields: await optionalFile(root, ".shopify/metafields.json"),
			themeCheck: await optionalFile(root, ".theme-check.yml"),
		});
		if (!closed && update.changedPaths.length > 0) {
			notify({ method: "graph/update", params: update });
		}
	}

	return () => {
		closed = true;
		for (const timer of debounceTimers.values()) clearTimeout(timer);
		debounceTimers.clear();
		watcher.close();
	};
}

function isWatchedPath(path: string): boolean {
	return (
		isThemeFile(path) ||
		path === ".shopify/metafields.json" ||
		path === ".theme-check.yml"
	);
}

function isNotFound(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

async function loadSession(root: string): Promise<ThemeWorkspaceSession> {
	const files = await collectThemeFiles(root);
	const metafields = await optionalFile(root, ".shopify/metafields.json");
	const themeCheck = await optionalFile(root, ".theme-check.yml");
	return new ThemeWorkspaceSession(files, { metafields, themeCheck });
}

async function loadBuildSession(root: string): Promise<ThemeBuildSession> {
	return new ThemeBuildSession(await collectThemeFiles(root));
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
		jsonrpc: request.jsonrpc,
		id: request.id ?? null,
		method: request.method,
		params: request.params,
	};
}

function requiredFile(
	params: Record<string, unknown> | undefined,
): ThemeInputFile {
	const path = requiredString(params, "path");
	const contents = params?.contents;
	if (typeof contents !== "string") {
		throw new Error("Missing string parameter contents");
	}
	return { path, contents };
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

function graphTools(): {
	name: string;
	description: string;
	inputSchema: object;
}[] {
	const nodeId = {
		type: "object",
		properties: { nodeId: { type: "string" } },
		required: ["nodeId"],
	};
	return [
		{
			name: "summary",
			description: "Summarize the current theme graph.",
			inputSchema: { type: "object" },
		},
		{ name: "node", description: "Get one graph node.", inputSchema: nodeId },
		{
			name: "dependencies",
			description: "Get direct dependencies.",
			inputSchema: nodeId,
		},
		{
			name: "dependents",
			description: "Get direct dependents.",
			inputSchema: nodeId,
		},
		{
			name: "affectedPages",
			description: "Get affected pages.",
			inputSchema: nodeId,
		},
	];
}

function writeNotification(output: Writable, notification: unknown): void {
	output.write(`${JSON.stringify(notification)}\n`);
}

function writeResponse(
	output: Writable,
	request: GraphRequest,
	response: { id: string | number | null; result?: unknown; error?: unknown },
): void {
	const payload =
		request.jsonrpc === "2.0" ? { jsonrpc: "2.0", ...response } : response;
	output.write(`${JSON.stringify(payload)}\n`);
}
