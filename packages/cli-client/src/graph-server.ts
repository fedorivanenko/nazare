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
	ThemeProgram,
} from "@nazare/compiler";

export async function serveThemeGraph(
	root: string,
	input: Readable,
	output: Writable,
): Promise<void> {
	let session = await loadProgram(root);
	let buildSession = await loadBuildSession(root);
	let stopWatching: (() => void) | undefined;
	let mcpInitialized = false;
	const readline = createInterface({ input, crlfDelay: Infinity });
	for await (const line of readline) {
		if (!line.trim()) continue;
		let request: GraphRequest;
		try {
			request = parseRequest(line);
		} catch (error) {
			writeErrorResponse(output, undefined, rpcError(error));
			continue;
		}
		const isMcpRequest = request.jsonrpc === "2.0";
		try {
			if (
				isMcpRequest &&
				!mcpInitialized &&
				request.method !== "initialize" &&
				request.method !== "ping"
			) {
				throw new RpcError(-32600, "Server not initialized");
			}
			if (request.method === "initialize") {
				if (request.id === undefined) {
					throw new RpcError(-32600, "initialize must be a request");
				}
				if (mcpInitialized) {
					throw new RpcError(-32600, "Server already initialized");
				}
				validateInitializeParams(request.params);
				mcpInitialized = true;
			}
			if (
				request.method === "notifications/initialized" &&
				request.id !== undefined
			) {
				throw new RpcError(
					-32600,
					"notifications/initialized must be a notification",
				);
			}
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
			if (request.id !== undefined) {
				writeResponse(output, request, { id: request.id, result });
			}
		} catch (error) {
			if (request.id !== undefined) {
				writeErrorResponse(output, request, rpcError(error));
			}
		}
	}
	stopWatching?.();
}

const SUPPORTED_MCP_PROTOCOL_VERSIONS = [
	"2025-11-25",
	"2025-03-26",
	"2024-11-05",
] as const;

class RpcError extends Error {
	constructor(
		readonly code: number,
		message: string,
		readonly data?: unknown,
	) {
		super(message);
	}
}

type GraphRequest = {
	jsonrpc?: "2.0";
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
};

async function handleRequest(
	request: GraphRequest,
	root: string,
	getSession: () => ThemeProgram,
	setSession: (session: ThemeProgram) => void,
	getBuildSession: () => ThemeBuildSession,
	setBuildSession: (session: ThemeBuildSession) => void,
	setWatcher: (stop: () => void) => void,
	notify: (update: unknown) => void,
): Promise<unknown> {
	if (request.method === "ping") return {};
	if (request.method === "notifications/initialized") return {};
	if (request.method === "tools/list") return { tools: graphTools() };
	if (request.method === "tools/call") {
		const name = requiredString(request.params, "name");
		if (!graphTools().some((tool) => tool.name === name)) {
			throw new RpcError(-32602, `Unknown tool: ${name}`);
		}
		const args = request.params?.arguments;
		if (
			args !== undefined &&
			(!args || typeof args !== "object" || Array.isArray(args))
		) {
			throw new RpcError(-32602, "tools/call arguments must be an object");
		}
		validateToolArguments(name, args as Record<string, unknown> | undefined);
		try {
			const result = await handleRequest(
				{
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
				...(isObject(result) ? { structuredContent: result } : {}),
				isError: false,
			};
		} catch (error) {
			if (error instanceof RpcError) throw error;
			const message = error instanceof Error ? error.message : String(error);
			return {
				content: [{ type: "text", text: message }],
				isError: true,
			};
		}
	}
	if (request.method === "initialize") {
		const requestedVersion = requiredString(request.params, "protocolVersion");
		return {
			protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSIONS.includes(
				requestedVersion as (typeof SUPPORTED_MCP_PROTOCOL_VERSIONS)[number],
			)
				? requestedVersion
				: SUPPORTED_MCP_PROTOCOL_VERSIONS[0],
			capabilities: { tools: {} },
			serverInfo: { name: "nazare-theme-graph", version: "1" },
		};
	}
	if (request.method === "reload" || request.method === "inspect") {
		const session = await loadProgram(root);
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
	if (
		["node", "dependencies", "dependents", "affectedPages"].includes(
			request.method,
		)
	) {
		const nodeId = requiredString(request.params, "nodeId");
		if (request.method === "node") return getThemeNode(graph, nodeId) ?? null;
		if (request.method === "dependencies")
			return session.getDependencies(nodeId);
		if (request.method === "dependents") return session.getDependents(nodeId);
		return session.getAffectedPages(nodeId);
	}
	throw new RpcError(-32601, `Method not found: ${request.method}`);
}

const WATCH_DEBOUNCE_MS = 40;

function startWatcher(
	root: string,
	getSession: () => ThemeProgram,
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
								params: {
									message:
										error instanceof Error ? error.message : String(error),
								},
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

async function loadProgram(root: string): Promise<ThemeProgram> {
	const files = await collectThemeFiles(root);
	const metafields = await optionalFile(root, ".shopify/metafields.json");
	const themeCheck = await optionalFile(root, ".theme-check.yml");
	return new ThemeProgram(files, { metafields, themeCheck });
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
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		throw new RpcError(-32700, "Parse error");
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new RpcError(-32600, "Invalid Request");
	}
	const request = value as Record<string, unknown>;
	if (request.jsonrpc !== undefined && request.jsonrpc !== "2.0") {
		throw new RpcError(-32600, 'Invalid Request: jsonrpc must be "2.0"');
	}
	if (typeof request.method !== "string" || request.method.length === 0) {
		throw new RpcError(-32600, "Invalid Request: method must be non-empty");
	}
	if (
		request.id !== undefined &&
		typeof request.id !== "string" &&
		typeof request.id !== "number"
	) {
		throw new RpcError(
			-32600,
			"Invalid Request: id must be a string or number",
		);
	}
	if (
		request.params !== undefined &&
		(!request.params ||
			typeof request.params !== "object" ||
			Array.isArray(request.params))
	) {
		throw new RpcError(-32602, "Invalid params: expected an object");
	}
	return {
		jsonrpc: request.jsonrpc as "2.0" | undefined,
		id: request.id as string | number | undefined,
		method: request.method,
		params: request.params as Record<string, unknown> | undefined,
	};
}

function validateInitializeParams(
	params: Record<string, unknown> | undefined,
): void {
	requiredString(params, "protocolVersion");
	if (!isObject(params?.capabilities)) {
		throw new RpcError(-32602, "Invalid initialize capabilities");
	}
	const clientInfo = params?.clientInfo;
	if (!isObject(clientInfo)) {
		throw new RpcError(-32602, "Invalid initialize clientInfo");
	}
	requiredString(clientInfo, "name");
	requiredString(clientInfo, "version");
}

function isObject(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateToolArguments(
	name: string,
	args: Record<string, unknown> | undefined,
): void {
	const allowedKeys = name === "summary" ? [] : ["nodeId"];
	const unknownKeys = Object.keys(args ?? {}).filter(
		(key) => !allowedKeys.includes(key),
	);
	if (unknownKeys.length > 0) {
		throw new RpcError(
			-32602,
			`Unknown tool argument: ${unknownKeys.sort()[0]}`,
		);
	}
}

function requiredFile(
	params: Record<string, unknown> | undefined,
): ThemeInputFile {
	const path = requiredString(params, "path");
	const contents = params?.contents;
	if (typeof contents !== "string") {
		throw new RpcError(-32602, "Missing string parameter contents");
	}
	return { path, contents };
}

function requiredString(
	params: Record<string, unknown> | undefined,
	key: string,
): string {
	const value = params?.[key];
	if (typeof value !== "string" || value.length === 0)
		throw new RpcError(-32602, `Missing string parameter ${key}`);
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
		additionalProperties: false,
	};
	return [
		{
			name: "summary",
			description: "Summarize the current theme graph.",
			inputSchema: { type: "object", additionalProperties: false },
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
	output.write(
		`${JSON.stringify(
			isObject(notification)
				? { jsonrpc: "2.0", ...notification }
				: notification,
		)}\n`,
	);
}

function writeResponse(
	output: Writable,
	request: GraphRequest,
	response: { id: string | number; result: unknown },
): void {
	const payload =
		request.jsonrpc === "2.0" ? { jsonrpc: "2.0", ...response } : response;
	output.write(`${JSON.stringify(payload)}\n`);
}

function writeErrorResponse(
	output: Writable,
	request: GraphRequest | undefined,
	error: RpcError,
): void {
	const payload = {
		jsonrpc: "2.0",
		id: request?.id ?? null,
		error: {
			code: error.code,
			message: error.message,
			...(error.data === undefined ? {} : { data: error.data }),
		},
	};
	output.write(`${JSON.stringify(payload)}\n`);
}

function rpcError(error: unknown): RpcError {
	if (error instanceof RpcError) return error;
	return new RpcError(
		-32603,
		error instanceof Error ? error.message : String(error),
	);
}
