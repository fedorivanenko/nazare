import { watch as watchDirectory } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import {
	collectThemeInputFiles,
	isInspectThemeFile,
	matchesInspectGlob,
	readInspectExcludePatterns,
} from "./inspect-input.js";
import {
	INSPECT_TOOL,
	InspectInputError,
	inspectForAgent,
} from "./inspection-agent.js";
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
	const querySession = await loadQuerySession(root, options.projectRoot);
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
			try {
				if (
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
				const result = await handleRequest(request, () => querySession);
				if (request.id !== undefined) {
					await writer.write(responsePayload(request.id, result));
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

const MAX_TOOL_RESULT_BYTES = 64 * 1024;

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
	jsonrpc: "2.0";
	id?: string | number;
	method: string;
	params?: Record<string, unknown>;
};

async function handleRequest(
	request: InspectionRequest,
	getQuerySession: () => ShopifyQuerySession,
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
		try {
			const result = await handleRequest(
				{
					jsonrpc: "2.0",
					method: name,
					params: args as Record<string, unknown> | undefined,
				},
				getQuerySession,
			);
			if (!isObject(result)) {
				throw new RpcError(
					-32603,
					"Inspection tool returned a non-object result",
				);
			}
			const serialized = JSON.stringify(result);
			const resultBytes = Buffer.byteLength(serialized);
			if (resultBytes > MAX_TOOL_RESULT_BYTES) {
				return {
					content: [
						{
							type: "text",
							text: `Tool result is ${resultBytes} bytes; maximum is ${MAX_TOOL_RESULT_BYTES}. Lower limit or continue with cursor.`,
						},
					],
					isError: true,
				};
			}
			return {
				content: [{ type: "text", text: serialized }],
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
	const querySession = getQuerySession();
	if (request.method === "inspect") {
		try {
			return await inspectForAgent(querySession, request.params);
		} catch (error) {
			if (error instanceof InspectInputError) {
				throw new RpcError(-32602, error.message);
			}
			throw error;
		}
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
	if (request.jsonrpc !== "2.0") {
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
		jsonrpc: "2.0",
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

function requiredString(
	params: Record<string, unknown> | undefined,
	key: string,
): string {
	const value = params?.[key];
	if (typeof value !== "string" || value.length === 0)
		throw new RpcError(-32602, `Missing string parameter ${key}`);
	return value;
}

const INSPECTION_TOOLS = Object.freeze([INSPECT_TOOL]);
const INSPECTION_TOOL_NAMES = new Set<string>([INSPECT_TOOL.name]);

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

function responsePayload(id: string | number, result: unknown): unknown {
	return { jsonrpc: "2.0", id, result };
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
