import { watch as watchDirectory } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { ShopifyBehavior, ShopifyEvidence } from "@nazare/target-shopify";
import {
	collectThemeInputFiles,
	isInspectThemeFile,
	matchesInspectGlob,
	readInspectExcludePatterns,
} from "./inspect-input.js";
import {
	PROJECT_METADATA_KEYS,
	ShopifyQuerySession,
} from "./shopify-query-session.js";

export type InspectionServerOptions = {
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

export async function serveInspection(
	root: string,
	input: Readable,
	output: Writable,
	options: InspectionServerOptions,
): Promise<void> {
	let querySession = await loadQuerySession(root, options.projectRoot);
	const writer = new JsonLineWriter(output);
	let notificationsEnabled = false;
	const stopWatching = startWatcher(
		root,
		options.projectRoot,
		() => querySession,
		(update) => {
			if (!notificationsEnabled) return;
			void writer.write(notificationPayload(update)).catch(() => undefined);
		},
		options.watchDebounceMs ?? DEFAULT_WATCH_DEBOUNCE_MS,
	);
	let mcpInitialized = false;
	const readline = createInterface({ input, crlfDelay: Infinity });
	try {
		for await (const line of readline) {
			if (!line.trim()) continue;
			let request: InspectionRequest;
			try {
				request = parseRequest(line);
			} catch (error) {
				await writer.write(errorResponsePayload(undefined, rpcError(error)));
				continue;
			}
			const isMcpRequest = request.jsonrpc === "2.0";
			if (!isMcpRequest) notificationsEnabled = true;
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
				if (request.method === "notifications/initialized") {
					notificationsEnabled = true;
				}
				const result = await handleRequest(
					request,
					root,
					options.projectRoot,
					() => querySession,
					(next) => {
						querySession = next;
					},
				);
				if (request.id !== undefined) {
					await writer.write(responsePayload(request, request.id, result));
				}
			} catch (error) {
				if (request.id !== undefined) {
					await writer.write(errorResponsePayload(request, rpcError(error)));
				}
			}
		}
	} finally {
		stopWatching();
		await writer.flush();
	}
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
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const MAX_TOOL_RESULT_BYTES = 512 * 1024;

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

type InspectionRequest = {
	jsonrpc?: "2.0";
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
};

async function handleRequest(
	request: InspectionRequest,
	root: string,
	projectRoot: string,
	getQuerySession: () => ShopifyQuerySession,
	setQuerySession: (session: ShopifyQuerySession) => void,
): Promise<unknown> {
	if (request.method === "ping") return {};
	if (request.method === "notifications/initialized") return {};
	if (request.method === "tools/list") return { tools: INSPECTION_TOOLS };
	if (request.method === "tools/call") {
		const name = requiredString(request.params, "name");
		if (!INSPECTION_TOOL_NAMES.has(name)) {
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
				getQuerySession,
				setQuerySession,
			);
			const structuredContent = structuredToolResult(name, result);
			const serialized = JSON.stringify(structuredContent);
			const resultBytes = Buffer.byteLength(serialized);
			if (resultBytes > MAX_TOOL_RESULT_BYTES) {
				return {
					content: [
						{
							type: "text",
							text: `Tool result is ${resultBytes} bytes; maximum is ${MAX_TOOL_RESULT_BYTES}. Use a targeted or paginated inspection tool.`,
						},
					],
					isError: true,
				};
			}
			return {
				content: [{ type: "text", text: serialized }],
				structuredContent,
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
			serverInfo: { name: "nazare-inspect", version: "1" },
		};
	}
	if (request.method === "reload" || request.method === "inspect") {
		const session = await loadQuerySession(root, projectRoot);
		setQuerySession(session);
		return request.method === "inspect"
			? session.projectModel()
			: session.projectGraph();
	}
	const querySession = getQuerySession();
	if (request.method === "projectModel") return querySession.projectModel();
	if (request.method === "projectGraph") return querySession.projectGraph();
	if (request.method === "impact") {
		return querySession.impact([requiredString(request.params, "path")]);
	}
	if (request.method === "behaviorIndex") {
		const index = await querySession.behaviorIndex({
			behaviorKind: optionalString(request.params, "behaviorKind"),
		});
		const page = paginate(index.records, request.params);
		return {
			version: index.version,
			records: page.items,
			total: page.total,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
			evidence: includeEvidence(request.params)
				? evidenceForFacts(
						index.evidence,
						page.items.map((record) => record.id),
					)
				: [],
		};
	}
	if (request.method === "metafieldIndex") {
		const index = await querySession.metafieldIndex({
			ownerType: optionalString(request.params, "ownerType"),
			namespace: optionalString(request.params, "namespace"),
		});
		const page = paginate(index.records, request.params);
		return {
			version: index.version,
			records: page.items,
			total: page.total,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
			evidence: includeEvidence(request.params)
				? evidenceForFacts(
						index.evidence,
						page.items.map((record) => record.id),
					)
				: [],
		};
	}
	if (request.method === "unusedFiles") {
		return querySession.unusedFiles(requiredStrings(request.params, "roots"));
	}
	if (request.method === "build") {
		return querySession.buildProducts({ scope: { kind: "workspace" } });
	}
	if (request.method === "updateFile" || request.method === "buildUpdate") {
		const file = requiredFile(request.params);
		const previousRevision = querySession.session.snapshot().revision;
		const revision = await querySession.updateFile(file);
		return request.method === "buildUpdate"
			? buildUpdate(querySession, file.path, previousRevision, revision)
			: graphUpdate(file.path, previousRevision, revision);
	}
	if (request.method === "removeFile") {
		const path = requiredString(request.params, "path");
		const previousRevision = querySession.session.snapshot().revision;
		const revision = await querySession.removeFile(path);
		return graphUpdate(path, previousRevision, revision);
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
		const matching = index.records.filter((record) =>
			behaviorMatches(record.data, query, role),
		);
		const page = paginate(matching, request.params);
		return {
			version: index.version,
			query,
			role,
			usages: page.items.map((record) => behaviorUsage(record)),
			total: page.total,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
			certainty: "complete",
			uncertainty: [],
			evidence: includeEvidence(request.params)
				? evidenceForFacts(
						index.evidence,
						page.items.map((record) => record.id),
					)
				: [],
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
		const page = paginate(owned, request.params);
		const evidenceIds = new Set<string>();
		const connections = page.items.map((record) => {
			evidenceIds.add(record.id);
			const data = isObject(record.data) ? record.data : {};
			const matching = index.records.filter(
				(candidate) =>
					isObject(candidate.data) &&
					candidate.data.subjectKind === data.subjectKind &&
					candidate.data.name === data.name,
			);
			const producers = matching.filter(
				(candidate) => behaviorRole(candidate.data) === "producers",
			);
			const consumers = matching.filter(
				(candidate) => behaviorRole(candidate.data) === "consumers",
			);
			for (const candidate of [
				...producers.slice(0, MAX_PAGE_LIMIT),
				...consumers.slice(0, MAX_PAGE_LIMIT),
			]) {
				evidenceIds.add(candidate.id);
			}
			return {
				id: record.id,
				subjectKind: data.subjectKind,
				name: data.name,
				producers: producers.slice(0, MAX_PAGE_LIMIT).map(behaviorUsage),
				producerCount: producers.length,
				consumers: consumers.slice(0, MAX_PAGE_LIMIT).map(behaviorUsage),
				consumerCount: consumers.length,
			};
		});
		return {
			version: index.version,
			path,
			connections,
			total: page.total,
			...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
			certainty: "complete",
			uncertainty: [],
			evidence: includeEvidence(request.params)
				? evidenceForFacts(index.evidence, evidenceIds)
				: [],
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

function graphUpdate(
	path: string,
	previousRevision: number,
	revision: number,
): { changedPaths: string[]; revision: number } {
	return {
		changedPaths: revision === previousRevision ? [] : [path],
		revision,
	};
}

async function buildUpdate(
	session: ShopifyQuerySession,
	path: string,
	previousRevision: number,
	revision: number,
): Promise<{
	changedPaths: string[];
	changedOutputPaths: string[];
	revision: number;
}> {
	if (revision === previousRevision) {
		return { changedPaths: [], changedOutputPaths: [], revision };
	}
	const build = await session.buildProducts({ scope: { kind: "workspace" } });
	return {
		changedPaths: [path],
		changedOutputPaths: build.emission.files.map((file) => file.path),
		revision,
	};
}

/** Long enough to coalesce an editor's save, short enough to feel immediate. */
const DEFAULT_WATCH_DEBOUNCE_MS = 40;

function startWatcher(
	root: string,
	projectRoot: string,
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
							method: "inspection/error",
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
			const session = getQuerySession();
			const previousRevision = session.session.snapshot().revision;
			let revision: number;
			try {
				const contents = await readFile(join(root, relativePath), "utf8");
				revision = await session.updateFile({ path: relativePath, contents });
			} catch (error) {
				if (!isNotFound(error)) throw error;
				revision = await session.removeFile(relativePath);
			}
			if (closed || revision === previousRevision) return;
			const update = graphUpdate(relativePath, previousRevision, revision);
			if (closed) return;
			notify({ method: "inspection/update", params: update });
			return;
		}
		const exclude = await readInspectExcludePatterns(projectRoot);
		const metafields = await optionalFile(
			projectRoot,
			".shopify/metafields.json",
		);
		const themeCheck = await optionalFile(projectRoot, ".theme-check.yml");
		const querySession = getQuerySession();
		const previousQueryRevision = querySession.session.snapshot().revision;
		let queryRevision = previousQueryRevision;
		if (relativePath === "nazare.theme.json") {
			queryRevision = await querySession.replaceFiles(
				(await collectThemeInputFiles(root, projectRoot)).filter(
					(file) =>
						!exclude.some((pattern) => matchesInspectGlob(file.path, pattern)),
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
				method: "inspection/update",
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

async function loadQuerySession(
	root: string,
	projectRoot: string,
): Promise<ShopifyQuerySession> {
	const files = await collectThemeInputFiles(root, projectRoot);
	const exclude = await readInspectExcludePatterns(projectRoot);
	const metafields = await optionalFile(
		projectRoot,
		".shopify/metafields.json",
	);
	const themeCheck = await optionalFile(projectRoot, ".theme-check.yml");
	return ShopifyQuerySession.create(
		files.filter(
			(file) =>
				!exclude.some((pattern) => matchesInspectGlob(file.path, pattern)),
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

function parseRequest(line: string): InspectionRequest {
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
			return ["behaviorKind", "limit", "cursor", "includeEvidence"];
		case "metafieldIndex":
			return ["ownerType", "namespace", "limit", "cursor", "includeEvidence"];
		case "unusedFiles":
			return ["roots"];
		case "node":
		case "dependencies":
		case "dependents":
		case "affectedPages":
			return ["nodeId"];
		case "fileImpact":
		case "renderOccurrences":
			return ["path"];
		case "behaviorConnections":
			return ["path", "limit", "cursor", "includeEvidence"];
		case "behaviorUsages":
			return [
				"subjectKind",
				"hookKind",
				"name",
				"role",
				"limit",
				"cursor",
				"includeEvidence",
			];
		case "evidence":
			return ["recordId"];
		default:
			throw new RpcError(-32602, `Unknown tool: ${name}`);
	}
}

function structuredToolResult(
	name: string,
	result: unknown,
): Record<string, unknown> {
	if (Array.isArray(result)) return { contractVersion: 1, items: result };
	if (isObject(result)) return { contractVersion: 1, ...result };
	return name === "node"
		? { contractVersion: 1, node: result ?? null }
		: { contractVersion: 1, value: result ?? null };
}

function paginate<Item>(
	items: readonly Item[],
	params: Record<string, unknown> | undefined,
): {
	items: readonly Item[];
	total: number;
	nextCursor?: string;
} {
	const limitValue = params?.limit;
	const limit =
		limitValue === undefined
			? DEFAULT_PAGE_LIMIT
			: requiredInteger(params, "limit", 1, MAX_PAGE_LIMIT);
	const cursorValue = params?.cursor;
	let offset = 0;
	if (cursorValue !== undefined) {
		if (
			typeof cursorValue !== "string" ||
			!/^(0|[1-9]\d*)$/.test(cursorValue)
		) {
			throw new RpcError(-32602, "Invalid cursor");
		}
		offset = Number(cursorValue);
		if (!Number.isSafeInteger(offset) || offset > items.length) {
			throw new RpcError(-32602, "Invalid cursor");
		}
	}
	const page = items.slice(offset, offset + limit);
	const nextOffset = offset + page.length;
	return {
		items: page,
		total: items.length,
		...(nextOffset < items.length ? { nextCursor: String(nextOffset) } : {}),
	};
}

function includeEvidence(params: Record<string, unknown> | undefined): boolean {
	const value = params?.includeEvidence;
	if (value === undefined) return true;
	if (typeof value !== "boolean") {
		throw new RpcError(-32602, "includeEvidence must be a boolean");
	}
	return value;
}

function evidenceForFacts(
	evidence: readonly ShopifyEvidence[],
	factIds: Iterable<string>,
): ShopifyEvidence[] {
	const ids = new Set(factIds);
	return evidence.filter((record) => {
		const data = record.data;
		if (!isObject(data)) return false;
		return ["factId", "readId", "referenceId"].some((key) => {
			const value = data[key];
			return typeof value === "string" && ids.has(value);
		});
	});
}

function requiredInteger(
	params: Record<string, unknown> | undefined,
	key: string,
	minimum: number,
	maximum: number,
): number {
	const value = params?.[key];
	if (
		typeof value !== "number" ||
		!Number.isSafeInteger(value) ||
		value < minimum ||
		value > maximum
	) {
		throw new RpcError(
			-32602,
			`${key} must be an integer from ${minimum} to ${maximum}`,
		);
	}
	return value;
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

function requiredFile(params: Record<string, unknown> | undefined): {
	path: string;
	contents: string;
} {
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

function inspectionTools(): {
	name: string;
	description: string;
	inputSchema: object;
	outputSchema: object;
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
	const paginationProperties = {
		limit: { type: "integer", minimum: 1, maximum: MAX_PAGE_LIMIT },
		cursor: { type: "string", pattern: "^(0|[1-9]\\d*)$" },
		includeEvidence: { type: "boolean" },
	};
	const behavior = {
		type: "object",
		properties: {
			...paginationProperties,
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
	const tools = [
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
				properties: {
					behaviorKind: { type: "string" },
					...paginationProperties,
				},
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
					...paginationProperties,
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
			inputSchema: {
				type: "object",
				properties: {
					path: { type: "string" },
					...paginationProperties,
				},
				required: ["path"],
				additionalProperties: false,
			},
		},
		{
			name: "evidence",
			description: "Get semantic evidence on demand by record ID.",
			inputSchema: recordId,
		},
	];
	return tools.map((tool) => ({
		...tool,
		outputSchema: {
			type: "object",
			properties: { contractVersion: { const: 1 } },
			required: ["contractVersion"],
			additionalProperties: true,
		},
	}));
}

const INSPECTION_TOOLS = Object.freeze(inspectionTools());
const INSPECTION_TOOL_NAMES = new Set(INSPECTION_TOOLS.map(({ name }) => name));

class JsonLineWriter {
	private pending: Promise<void> = Promise.resolve();
	private failure: unknown;

	constructor(private readonly output: Writable) {}

	write(payload: unknown): Promise<void> {
		const line = `${JSON.stringify(payload)}\n`;
		const write = this.pending.then(
			() =>
				new Promise<void>((resolve, reject) => {
					this.output.write(line, (error) => {
						if (error) reject(error);
						else resolve();
					});
				}),
		);
		this.pending = write.catch((error: unknown) => {
			this.failure ??= error;
		});
		return write;
	}

	async flush(): Promise<void> {
		await this.pending;
		if (this.failure) throw this.failure;
	}
}

function notificationPayload(notification: unknown): unknown {
	return isObject(notification)
		? { jsonrpc: "2.0", ...notification }
		: notification;
}

function responsePayload(
	request: InspectionRequest,
	id: string | number,
	result: unknown,
): unknown {
	const response = { id, result };
	return request.jsonrpc === "2.0" ? { jsonrpc: "2.0", ...response } : response;
}

function errorResponsePayload(
	request: InspectionRequest | undefined,
	error: RpcError,
): unknown {
	return {
		jsonrpc: "2.0",
		id: request?.id ?? null,
		error: {
			code: error.code,
			message: error.message,
			...(error.data === undefined ? {} : { data: error.data }),
		},
	};
}

function rpcError(error: unknown): RpcError {
	if (error instanceof RpcError) return error;
	return new RpcError(
		-32603,
		error instanceof Error ? error.message : String(error),
	);
}
