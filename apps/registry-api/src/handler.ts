// The registry HTTP surface as one pure function: (Request) => Response. Pure so
// it runs identically as a standalone node:http server or a Vercel function, and
// so every security guard is unit-testable without a socket. The guards live
// here, explicitly, rather than in a framework:
//
//   - path params validated before any store lookup (no traversal into the DB
//     key space; the id/version shapes are the only thing that reaches storage)
//   - payload file keys must be safe relative paths (a "../.." key would
//     traverse on the CONSUMER's disk during `add`, so it is refused at publish)
//   - PUT body is size-capped before parsing (no unbounded-memory DoS)
//   - the bearer token is compared in constant time (no timing oracle)
//   - malformed JSON / shape -> 400, never a 500 that leaks a stack
import { createHash, timingSafeEqual } from "node:crypto";
import type { RegistryComponent, RegistryErrorCode } from "@nazare/core";
import {
	isSafeRelativePath,
	isValidVersion,
	parseComponentId,
	validateBasicRegistryComponent,
} from "@nazare/registry";
import type { RegistryStore } from "./store.js";

export type Handler = (request: Request) => Promise<Response>;

export type HandlerOptions = {
	store: RegistryStore;
	/** Accepted publish tokens; empty means publishing is disabled. */
	tokens: string[];
	/** Max PUT body size in bytes. */
	maxBodyBytes?: number;
};

const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const IMMUTABLE_CACHE = "public, max-age=0, s-maxage=31536000, immutable";
const REVALIDATED_CACHE =
	"public, max-age=0, s-maxage=60, stale-while-revalidate=86400";
const NO_STORE_CACHE = "no-store";

export function createHandler(options: HandlerOptions): Handler {
	const { store, tokens } = options;
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

	return async (request: Request): Promise<Response> => {
		const segments = new URL(request.url).pathname
			.split("/")
			.filter((segment) => segment.length > 0);

		// Every route is /components/:scope/:name[/:version].
		if (segments[0] !== "components") return notFound();
		const [, scope, name, version, ...rest] = segments;
		if (!scope || !name || rest.length > 0) return notFound();

		const id = validateId(scope, name);
		if (!id) {
			return errorResponse(400, "MALFORMED_COMPONENT", "Invalid component id");
		}

		if (request.method === "GET" && version === undefined) {
			return getMetadata(store, id);
		}
		if (request.method === "GET") {
			return getComponent(store, id, version);
		}
		if (request.method === "PUT" && version !== undefined) {
			return putComponent(request, store, tokens, maxBodyBytes, id, version);
		}
		return errorResponse(405, "MALFORMED_COMPONENT", "Method not allowed");
	};
}

async function getMetadata(
	store: RegistryStore,
	id: string,
): Promise<Response> {
	const metadata = await store.getMetadata(id);
	if (!metadata) {
		return errorResponse(404, "COMPONENT_NOT_FOUND", `Unknown component ${id}`);
	}
	return json(200, metadata, REVALIDATED_CACHE);
}

async function getComponent(
	store: RegistryStore,
	id: string,
	version: string,
): Promise<Response> {
	let resolved = version;
	const isLatestAlias = version === "latest";
	if (isLatestAlias) {
		const metadata = await store.getMetadata(id);
		if (!metadata) {
			return errorResponse(
				404,
				"COMPONENT_NOT_FOUND",
				`Unknown component ${id}`,
			);
		}
		resolved = metadata.latest;
	} else if (!isValidVersion(version)) {
		return errorResponse(404, "VERSION_NOT_FOUND", `No version ${version}`);
	}

	const component = await store.getComponent(id, resolved);
	if (!component) {
		return errorResponse(
			404,
			"VERSION_NOT_FOUND",
			`No version ${resolved} of ${id}`,
		);
	}
	return json(
		200,
		component,
		isLatestAlias ? REVALIDATED_CACHE : IMMUTABLE_CACHE,
	);
}

async function putComponent(
	request: Request,
	store: RegistryStore,
	tokens: string[],
	maxBodyBytes: number,
	id: string,
	version: string,
): Promise<Response> {
	if (!authorized(request, tokens)) {
		return errorResponse(
			401,
			"UNAUTHORIZED",
			"A valid publish token is required",
		);
	}
	if (!isValidVersion(version)) {
		return errorResponse(
			400,
			"MALFORMED_COMPONENT",
			`Invalid version ${version}`,
		);
	}

	let raw: string;
	try {
		raw = await readBodyCapped(request, maxBodyBytes);
	} catch {
		return errorResponse(413, "MALFORMED_COMPONENT", "Request body too large");
	}

	let body: unknown;
	try {
		body = JSON.parse(raw);
	} catch {
		return errorResponse(400, "MALFORMED_COMPONENT", "Body is not valid JSON");
	}

	const invalid = validateComponent(body, id, version);
	if (invalid) return errorResponse(400, "MALFORMED_COMPONENT", invalid);

	const outcome = await store.putComponent(body as RegistryComponent);
	if (outcome === "exists") {
		return errorResponse(
			409,
			"VERSION_EXISTS",
			`${id}@${version} is already published`,
		);
	}
	return json(201, { id, version });
}

// --- validation ------------------------------------------------------------

function validateId(scope: string, name: string): string | undefined {
	try {
		const id = `@${scope}/${name}`;
		parseComponentId(id); // throws on anything but @scope/name
		return id;
	} catch {
		return undefined;
	}
}

// Returns an error message, or undefined when the body is a well-formed
// RegistryComponent whose id/version match the route.
function validateComponent(
	body: unknown,
	id: string,
	version: string,
): string | undefined {
	if (typeof body !== "object" || body === null)
		return "Body must be an object";
	const candidate = body as Record<string, unknown>;

	if (candidate.id !== id) return `id must equal ${id}`;
	if (candidate.version !== version) return `version must equal ${version}`;

	if (!isStringMap(candidate.dependencies)) {
		return "dependencies must be a map of strings";
	}
	if (!isStringMap(candidate.files)) {
		return "files must be a map of strings";
	}
	const files = candidate.files as Record<string, string>;
	if (Object.keys(files).length === 0) return "files must not be empty";
	for (const path of Object.keys(files)) {
		if (!isSafeRelativePath(path)) {
			return `unsafe file path "${path}"`;
		}
	}
	return validateBasicRegistryComponent(body as RegistryComponent);
}

function isStringMap(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	return Object.values(value as Record<string, unknown>).every(
		(entry) => typeof entry === "string",
	);
}

// --- auth ------------------------------------------------------------------

function authorized(request: Request, tokens: string[]): boolean {
	if (tokens.length === 0) return false;
	const header = request.headers.get("authorization") ?? "";
	const match = /^Bearer (.+)$/.exec(header);
	if (!match) return false;
	const provided = digest(match[1]);
	// Hash both sides to a fixed length and compare in constant time; never
	// early-return, so timing does not reveal which token (or its length).
	let ok = false;
	for (const token of tokens) {
		if (timingSafeEqual(provided, digest(token))) ok = true;
	}
	return ok;
}

function digest(value: string): Buffer {
	return createHash("sha256").update(value).digest();
}

// --- body ------------------------------------------------------------------

async function readBodyCapped(
	request: Request,
	maxBytes: number,
): Promise<string> {
	if (!request.body) return "";
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > maxBytes) {
			await reader.cancel();
			throw new Error("body too large");
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

// --- responses -------------------------------------------------------------

function json(
	status: number,
	body: unknown,
	cacheControl = NO_STORE_CACHE,
): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
			"cache-control": cacheControl,
		},
	});
}

function errorResponse(
	status: number,
	code: RegistryErrorCode,
	message: string,
): Response {
	return json(status, { error: { code, message } });
}

function notFound(): Response {
	return errorResponse(404, "COMPONENT_NOT_FOUND", "Not found");
}
