import { watch as watchDirectory } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
	matchesThemeGlob,
	ThemeBuildSession,
	type ThemeInputFile,
} from "@nazare/compiler";
import type { ShopifyBehavior } from "@nazare/target-shopify";
import {
	collectThemeInputFiles,
	isInspectThemeFile,
	readInspectExcludePatterns,
} from "./inspect-input.js";
import {
	PROJECT_METADATA_KEYS,
	ShopifyQuerySession,
} from "./shopify-query-session.js";

export type ThemeGraphServerOptions = {
	projectRoot: string;
	/**
	 * How long to wait for a path to stop changing before rebuilding it.
	 *
	 * An editor writing a file produces several events, and a caller that cares
	 * how many notifications a burst of edits collapses into has to be able to
	 * say what "a burst" means — a machine under load can spread three writes
	 * over half a second, which is an eternity next to the default.
	 */
	watchDebounceMs?: number;
};

export async function serveThemeGraph(
	root: string,
	input: Readable,
	output: Writable,
	options: ThemeGraphServerOptions,
): Promise<void> {
	const initial = await loadServerState(root, options.projectRoot);
	let buildSession = initial.buildSession;
	let querySession = initial.querySession;
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
				options.projectRoot,
				() => buildSession,
				(next) => {
					buildSession = next;
				},
				() => querySession,
				(next) => {
					querySession = next;
				},
				(next) => {
					stopWatching?.();
					stopWatching = next;
				},
				(update) => writeNotification(output, update),
				options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
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

const NON_DOM_BEHAVIOR_SUBJECT_KINDS = [
	"customProperty",
	"customEvent",
	"customElement",
] as const;
const BEHAVIOR_SUBJECT_KINDS = [
	"domHook",
	...NON_DOM_BEHAVIOR_SUBJECT_KINDS,
] as const;
const DOM_HOOK_KINDS = ["class", "id", "attribute"] as const;
const BEHAVIOR_QUERY_ROLES = ["all", "producers", "consumers"] as const;

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
	projectRoot: string,
	getBuildSession: () => ThemeBuildSession,
	setBuildSession: (session: ThemeBuildSession) => void,
	getQuerySession: () => ShopifyQuerySession,
	setQuerySession: (session: ShopifyQuerySession) => void,
	setWatcher: (stop: () => void) => void,
	notify: (update: unknown) => void,
	debounceMs: number,
): Promise<unknown> {
	if (request.method === "ping") return {};
	if (request.method === "notifications/initialized") return {};
	if (request.method === "tools/list") return { tools: GRAPH_TOOLS };
	if (request.method === "tools/call") {
		const name = requiredString(request.params, "name");
		if (!GRAPH_TOOL_NAMES.has(name)) {
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
				projectRoot,
				getBuildSession,
				setBuildSession,
				getQuerySession,
				setQuerySession,
				setWatcher,
				notify,
				debounceMs,
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
		const state = await loadServerState(root, projectRoot);
		setBuildSession(state.buildSession);
		setQuerySession(state.querySession);
		return request.method === "inspect"
			? state.querySession.projectModel()
			: state.querySession.projectGraph();
	}
	const querySession = getQuerySession();
	if (request.method === "projectModel") return querySession.projectModel();
	if (request.method === "projectGraph") return querySession.projectGraph();
	if (request.method === "impact") {
		return querySession.impact([requiredString(request.params, "path")]);
	}
	if (request.method === "behaviorIndex") {
		return querySession.behaviorIndex({
			behaviorKind: optionalString(request.params, "behaviorKind"),
		});
	}
	if (request.method === "metafieldIndex") {
		return querySession.metafieldIndex({
			ownerType: optionalString(request.params, "ownerType"),
			namespace: optionalString(request.params, "namespace"),
		});
	}
	if (request.method === "unusedFiles") {
		return querySession.unusedFiles(requiredStrings(request.params, "roots"));
	}
	if (request.method === "build") return getBuildSession().getBuild();
	if (request.method === "updateFile") {
		const file = requiredFile(request.params);
		const result = getBuildSession().updateFile(file).graphUpdate;
		await querySession.updateFile(file);
		return result;
	}
	if (request.method === "buildUpdate") {
		const file = requiredFile(request.params);
		const result = getBuildSession().updateFile(file);
		await querySession.updateFile(file);
		return result;
	}
	if (request.method === "removeFile") {
		const path = requiredString(request.params, "path");
		const result = getBuildSession().removeFile(path).graphUpdate;
		await querySession.removeFile(path);
		return result;
	}
	if (request.method === "watch") {
		setWatcher(
			startWatcher(
				root,
				projectRoot,
				getBuildSession,
				setBuildSession,
				getQuerySession,
				notify,
				debounceMs,
			),
		);
		return { watching: true };
	}
	if (request.method === "unwatch") {
		setWatcher(() => undefined);
		return { watching: false };
	}
	if (request.method === "summary") {
		const model = await querySession.projectModel();
		return {
			version: model.version,
			fileCount: querySession.session.snapshot().fileIds.length,
			declarationCount: model.declarations.length,
			referenceCount: model.references.length,
			evidenceCount: model.evidence.length,
			uncertaintyCount: model.uncertainty.length,
		};
	}
	if (request.method === "fileImpact") {
		const path = requiredString(request.params, "path");
		const [impact, dependencies] = await Promise.all([
			querySession.impact([path]),
			querySession.dependencyIndex(),
		]);
		const directDependencies = dependencies.records.filter(
			(record) => record.from.path === path,
		);
		const directDependents = dependencies.records.filter(
			(record) => record.to.path === path,
		);
		return {
			version: impact.version,
			path,
			dependencies: directDependencies.map((record) => record.to.path),
			dependents: directDependents.map((record) => record.from.path),
			affectedPages: (await querySession.affectedPages(path)).pages.map(
				(file) => file.path,
			),
			uncertainty: impact.uncertainty,
		};
	}
	if (request.method === "renderOccurrences") {
		const path = requiredString(request.params, "path");
		const dependencies = await querySession.dependencyIndex();
		return dependencies.records.filter(
			(record) => record.from.path === path || record.to.path === path,
		);
	}
	if (request.method === "behaviorUsages") {
		const query = behaviorQueryParams(request.params);
		const role = requiredEnum(request.params, "role", BEHAVIOR_QUERY_ROLES);
		const index = await querySession.behaviorIndex({
			behaviorKind: query.subjectKind,
		});
		const usages = index.records
			.filter((record) => behaviorMatches(record.data, query, role))
			.map((record) => behaviorUsage(record));
		return {
			version: index.version,
			query,
			role,
			usages,
			certainty: "complete",
			uncertainty: [],
			evidence: index.evidence,
		};
	}
	if (request.method === "behaviorConnections") {
		const path = requiredString(request.params, "path");
		if (
			!querySession.session
				.snapshot()
				.fileIds.some((file) => file.path === path)
		)
			throw new RpcError(-32602, `Unknown theme path: ${path}`);
		const index = await querySession.behaviorIndex({ behaviorKind: null });
		const owned = index.records.filter((record) => record.owner.path === path);
		const connections = owned.map((record) => {
			const data = isObject(record.data) ? record.data : {};
			const matching = index.records.filter(
				(candidate) =>
					isObject(candidate.data) &&
					candidate.data.subjectKind === data.subjectKind &&
					candidate.data.name === data.name,
			);
			return {
				id: record.id,
				subjectKind: data.subjectKind,
				name: data.name,
				producers: matching
					.filter((candidate) => behaviorRole(candidate.data) === "producers")
					.map(behaviorUsage),
				consumers: matching
					.filter((candidate) => behaviorRole(candidate.data) === "consumers")
					.map(behaviorUsage),
			};
		});
		return {
			version: index.version,
			path,
			connections,
			certainty: "complete",
			uncertainty: [],
			evidence: index.evidence,
		};
	}
	if (request.method === "evidence") {
		const recordId = requiredString(request.params, "recordId");
		const model = await querySession.projectModel();
		return model.evidence.filter((record) => record.id === recordId);
	}
	if (
		["node", "dependencies", "dependents", "affectedPages"].includes(
			request.method,
		)
	) {
		const nodeId = requiredString(request.params, "nodeId");
		if (request.method === "node") {
			const model = await querySession.projectModel();
			return (
				model.declarations.find(
					(record) => record.id === nodeId || record.owner.path === nodeId,
				) ??
				model.references.find(
					(record) => record.id === nodeId || record.owner.path === nodeId,
				) ??
				null
			);
		}
		if (request.method === "dependencies") {
			const index = await querySession.dependencyIndex();
			return index.records.filter((record) => record.from.path === nodeId);
		}
		if (request.method === "dependents") {
			return (await querySession.dependencyIndex(nodeId)).records;
		}
		return (await querySession.affectedPages(nodeId)).pages;
	}
	throw new RpcError(-32601, `Method not found: ${request.method}`);
}

/** Long enough to coalesce an editor's save, short enough to feel immediate. */
const DEFAULT_WATCH_DEBOUNCE_MS = 40;

function startWatcher(
	root: string,
	projectRoot: string,
	getBuildSession: () => ThemeBuildSession,
	setBuildSession: (session: ThemeBuildSession) => void,
	getQuerySession: () => ShopifyQuerySession,
	notify: (update: unknown) => void,
	debounceMs: number,
): () => void {
	let closed = false;
	let pending = Promise.resolve();
	const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	const schedule = (relativePath: string): void => {
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
								message: error instanceof Error ? error.message : String(error),
							},
						});
					});
			}, debounceMs),
		);
	};
	const watchers = [
		watchDirectory(root, { recursive: true }, (_event, filename) => {
			const relativePath = filename?.toString().split("\\").join("/");
			if (relativePath && isWatchedPath(relativePath)) schedule(relativePath);
		}),
	];
	if (resolve(projectRoot) !== resolve(root)) {
		watchers.push(
			watchDirectory(projectRoot, { recursive: true }, (_event, filename) => {
				const projectPath = filename?.toString().split("\\").join("/");
				if (projectPath && isExternalInspectPath(projectPath)) {
					schedule(projectPath);
				}
			}),
		);
	}

	async function processWatchedPath(relativePath: string): Promise<void> {
		if (closed) return;
		if (isInspectThemeFile(relativePath)) {
			try {
				const contents = await readFile(join(root, relativePath), "utf8");
				const file = { path: relativePath, contents };
				const buildUpdate = getBuildSession().updateFile(file);
				await getQuerySession().updateFile(file);
				const graphUpdate = buildUpdate.graphUpdate;
				if (closed) return;
				if (graphUpdate.changedPaths.length > 0) {
					notify({ method: "graph/update", params: graphUpdate });
				}
				if (buildUpdate.changedPaths.length > 0) {
					notify({ method: "build/update", params: buildUpdate });
				}
			} catch (error) {
				if (!isNotFound(error)) throw error;
				const buildUpdate = getBuildSession().removeFile(relativePath);
				await getQuerySession().removeFile(relativePath);
				const graphUpdate = buildUpdate.graphUpdate;
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
		const exclude = await readInspectExcludePatterns(projectRoot);
		const metafields = await optionalFile(
			projectRoot,
			".shopify/metafields.json",
		);
		const themeCheck = await optionalFile(projectRoot, ".theme-check.yml");
		setBuildSession(
			new ThemeBuildSession(await collectThemeInputFiles(root, projectRoot), {
				exclude,
				metafields,
				themeCheck,
			}),
		);
		const querySession = getQuerySession();
		const previousQueryRevision = querySession.session.snapshot().revision;
		let queryRevision = previousQueryRevision;
		if (relativePath === "nazare.theme.json") {
			queryRevision = await querySession.replaceFiles(
				(await collectThemeInputFiles(root, projectRoot)).filter(
					(file) =>
						!exclude.some((pattern) => matchesThemeGlob(file.path, pattern)),
				),
			);
			queryRevision = await querySession.updateExternalInput(
				PROJECT_METADATA_KEYS.config,
				{ exclude },
			);
		}
		if (relativePath === ".shopify/metafields.json") {
			queryRevision = await querySession.updateExternalInput(
				PROJECT_METADATA_KEYS.metafields,
				metafields?.contents ?? null,
			);
		}
		if (relativePath === ".theme-check.yml") {
			queryRevision = await querySession.updateExternalInput(
				PROJECT_METADATA_KEYS.themeCheck,
				themeCheck?.contents ?? null,
			);
		}
		if (!closed && queryRevision !== previousQueryRevision) {
			notify({
				method: "graph/update",
				params: { changedPaths: [relativePath], revision: queryRevision },
			});
		}
	}

	return () => {
		closed = true;
		for (const timer of debounceTimers.values()) clearTimeout(timer);
		debounceTimers.clear();
		for (const watcher of watchers) watcher.close();
	};
}

function isWatchedPath(path: string): boolean {
	return isInspectThemeFile(path) || isExternalInspectPath(path);
}

function isExternalInspectPath(path: string): boolean {
	return (
		path === ".shopify/metafields.json" ||
		path === ".theme-check.yml" ||
		path === "nazare.theme.json"
	);
}

function isNotFound(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === "ENOENT"
	);
}

async function loadServerState(
	root: string,
	projectRoot: string,
): Promise<{
	buildSession: ThemeBuildSession;
	querySession: ShopifyQuerySession;
}> {
	const files = await collectThemeInputFiles(root, projectRoot);
	const exclude = await readInspectExcludePatterns(projectRoot);
	const metafields = await optionalFile(
		projectRoot,
		".shopify/metafields.json",
	);
	const themeCheck = await optionalFile(projectRoot, ".theme-check.yml");
	return {
		buildSession: new ThemeBuildSession(files, {
			exclude,
			metafields,
			themeCheck,
		}),
		querySession: await ShopifyQuerySession.create(
			files.filter(
				(file) =>
					!exclude.some((pattern) => matchesThemeGlob(file.path, pattern)),
			),
			{
				[PROJECT_METADATA_KEYS.config]: { exclude },
				...(metafields
					? { [PROJECT_METADATA_KEYS.metafields]: metafields.contents }
					: {}),
				...(themeCheck
					? { [PROJECT_METADATA_KEYS.themeCheck]: themeCheck.contents }
					: {}),
			},
		),
	};
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
	const allowedKeys = toolArgumentKeys(name);
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

function toolArgumentKeys(name: string): string[] {
	switch (name) {
		case "summary":
		case "projectModel":
		case "projectGraph":
			return [];
		case "impact":
			return ["path"];
		case "behaviorIndex":
			return ["behaviorKind"];
		case "metafieldIndex":
			return ["ownerType", "namespace"];
		case "unusedFiles":
			return ["roots"];
		case "node":
		case "dependencies":
		case "dependents":
		case "affectedPages":
			return ["nodeId"];
		case "fileImpact":
		case "renderOccurrences":
		case "behaviorConnections":
			return ["path"];
		case "behaviorUsages":
			return ["subjectKind", "hookKind", "name", "role"];
		case "evidence":
			return ["recordId"];
		default:
			throw new RpcError(-32602, `Unknown tool: ${name}`);
	}
}

type BehaviorQuery = {
	subjectKind: (typeof BEHAVIOR_SUBJECT_KINDS)[number];
	name: string;
	hookKind?: (typeof DOM_HOOK_KINDS)[number];
};

function behaviorQueryParams(
	params: Record<string, unknown> | undefined,
): BehaviorQuery {
	const subjectKind = requiredEnum(
		params,
		"subjectKind",
		BEHAVIOR_SUBJECT_KINDS,
	);
	const name = requiredString(params, "name");
	if (subjectKind !== "domHook") {
		if (params?.hookKind !== undefined) {
			throw new RpcError(
				-32602,
				"hookKind is valid only when subjectKind is domHook",
			);
		}
		return { subjectKind, name };
	}
	return {
		subjectKind,
		name,
		hookKind: requiredEnum(params, "hookKind", DOM_HOOK_KINDS),
	};
}

function behaviorMatches(
	data: ShopifyBehavior["data"],
	query: BehaviorQuery,
	role: (typeof BEHAVIOR_QUERY_ROLES)[number],
): boolean {
	if (!isObject(data)) return false;
	if (data.subjectKind !== query.subjectKind || data.name !== query.name)
		return false;
	if (query.hookKind && data.hookKind !== query.hookKind) return false;
	return role === "all" || behaviorRole(data) === role;
}

function behaviorRole(
	data: ShopifyBehavior["data"],
): "producers" | "consumers" {
	if (!isObject(data)) return "consumers";
	return ["emits", "defines", "dispatches"].includes(String(data.operation))
		? "producers"
		: "consumers";
}

function behaviorUsage(record: ShopifyBehavior): Record<string, unknown> {
	return {
		...(isObject(record.data) ? record.data : {}),
		id: record.id,
		fromPath: record.owner.path,
	};
}

function requiredEnum<const Values extends readonly string[]>(
	params: Record<string, unknown> | undefined,
	key: string,
	values: Values,
): Values[number] {
	const value = requiredString(params, key);
	if (!values.includes(value)) {
		throw new RpcError(-32602, `Invalid ${key}: ${value}`);
	}
	return value;
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

function optionalString(
	params: Record<string, unknown> | undefined,
	key: string,
): string | null {
	const value = params?.[key];
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.length === 0)
		throw new RpcError(-32602, `Invalid string parameter ${key}`);
	return value;
}

function requiredStrings(
	params: Record<string, unknown> | undefined,
	key: string,
): string[] {
	const value = params?.[key];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string"))
		throw new RpcError(-32602, `Missing string-array parameter ${key}`);
	return value;
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
	const path = {
		type: "object",
		properties: { path: { type: "string" } },
		required: ["path"],
		additionalProperties: false,
	};
	const behavior = {
		type: "object",
		properties: {
			subjectKind: {
				type: "string",
				enum: BEHAVIOR_SUBJECT_KINDS,
			},
			hookKind: { type: "string", enum: DOM_HOOK_KINDS },
			name: { type: "string" },
			role: { type: "string", enum: BEHAVIOR_QUERY_ROLES },
		},
		required: ["subjectKind", "name", "role"],
		additionalProperties: false,
		oneOf: [
			{
				properties: { subjectKind: { const: "domHook" } },
				required: ["hookKind"],
			},
			{
				properties: {
					subjectKind: {
						enum: NON_DOM_BEHAVIOR_SUBJECT_KINDS,
					},
				},
				not: { required: ["hookKind"] },
			},
		],
	};
	const recordId = {
		type: "object",
		properties: { recordId: { type: "string" } },
		required: ["recordId"],
		additionalProperties: false,
	};
	return [
		{
			name: "projectModel",
			description: "Get versioned Shopify project semantic model.",
			inputSchema: { type: "object", additionalProperties: false },
		},
		{
			name: "projectGraph",
			description: "Get lazily materialized Shopify project graph.",
			inputSchema: { type: "object", additionalProperties: false },
		},
		{
			name: "impact",
			description: "Get transitive impact for one changed project path.",
			inputSchema: path,
		},
		{
			name: "behaviorIndex",
			description: "Get versioned behavior records and evidence.",
			inputSchema: {
				type: "object",
				properties: { behaviorKind: { type: "string" } },
				additionalProperties: false,
			},
		},
		{
			name: "metafieldIndex",
			description: "Get versioned metafield records and evidence.",
			inputSchema: {
				type: "object",
				properties: {
					ownerType: { type: "string" },
					namespace: { type: "string" },
				},
				additionalProperties: false,
			},
		},
		{
			name: "unusedFiles",
			description: "Get files unreachable from supplied root paths.",
			inputSchema: {
				type: "object",
				properties: {
					roots: { type: "array", items: { type: "string" } },
				},
				required: ["roots"],
				additionalProperties: false,
			},
		},
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
		{
			name: "fileImpact",
			description:
				"Explain one theme file's usage, dependencies, dependents, affected pages, diagnostics, and uncertainty.",
			inputSchema: path,
		},
		{
			name: "renderOccurrences",
			description:
				"Get source render/include occurrences where a file is caller or target.",
			inputSchema: path,
		},
		{
			name: "behaviorUsages",
			description:
				"Find producers, consumers, JavaScript owners, and explicit analysis uncertainty for a behavior subject.",
			inputSchema: behavior,
		},
		{
			name: "behaviorConnections",
			description:
				"Find typed cross-language behavior connections and explicit analysis uncertainty for one source file.",
			inputSchema: path,
		},
		{
			name: "evidence",
			description: "Get semantic evidence on demand by record ID.",
			inputSchema: recordId,
		},
	];
}

const GRAPH_TOOLS = Object.freeze(graphTools());
const GRAPH_TOOL_NAMES = new Set(GRAPH_TOOLS.map(({ name }) => name));

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
