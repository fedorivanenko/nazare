import type { Diagnostic } from "@nazare/core";
import type { ThemeMetafieldSnapshot } from "./theme-external-types.js";
import type { ThemeDataAccessRecord } from "./theme-facts.js";

export type { ThemeMetafieldSnapshot } from "./theme-external-types.js";

export type ThemeMetafieldDefinitionRecord = {
	id: string;
	owner: string;
	namespace: string;
	key: string;
	type?: string;
};

export type ThemeMetafieldReadRecord = {
	id: string;
	fromPath: string;
	owner: string;
	namespace: string;
	key: string;
	definitionId?: string;
	dataAccessId: string;
};

export type ThemeMetafieldAnalysis = {
	definitions: ThemeMetafieldDefinitionRecord[];
	reads: ThemeMetafieldReadRecord[];
	issues: Diagnostic[];
	state: "unknown" | "present" | "invalid";
	path: string;
	pulledAt?: string;
};

export type ThemeMetafieldDefinitionCollection = Pick<
	ThemeMetafieldAnalysis,
	"definitions" | "issues" | "state" | "path" | "pulledAt"
>;

export function collectMetafieldDefinitions(
	snapshot: ThemeMetafieldSnapshot | undefined,
): ThemeMetafieldDefinitionCollection {
	const path = snapshot?.path ?? ".shopify/metafields.json";
	let value: unknown;
	if (!snapshot) {
		value = undefined;
	} else {
		try {
			value = JSON.parse(snapshot.contents);
		} catch (error) {
			return {
				definitions: [],
				state: "invalid",
				path,
				pulledAt: snapshot.pulledAt,
				issues: [
					{
						severity: "warning",
						code: "THEME_METAFIELDS_JSON_INVALID",
						message: `Invalid metafield snapshot: ${error instanceof Error ? error.message : String(error)}`,
						phase: "parse",
					},
				],
			};
		}
	}
	if (snapshot && !isSupportedMetafieldSnapshot(value)) {
		return {
			definitions: [],
			state: "invalid",
			path,
			pulledAt: snapshot.pulledAt,
			issues: [
				{
					severity: "warning",
					code: "THEME_METAFIELDS_SHAPE_INVALID",
					message: `Unsupported metafield snapshot shape in ${path}`,
					phase: "parse",
				},
			],
		};
	}
	const definitions: ThemeMetafieldDefinitionRecord[] = [];
	for (const item of findDefinitionCandidates(value)) {
		const owner = normalizeOwner(
			stringValue(item.owner ?? item.ownerType ?? item.resourceType),
		);
		const namespace = stringValue(item.namespace);
		const key = stringValue(item.key);
		if (!owner || !namespace || !key) continue;
		const id = metafieldDefinitionId(owner, namespace, key);
		if (!definitions.some((definition) => definition.id === id)) {
			definitions.push({
				id,
				owner,
				namespace,
				key,
				type: typeValue(item.type ?? item.valueType ?? item.value_type),
			});
		}
	}
	return {
		definitions: definitions.sort((a, b) => a.id.localeCompare(b.id)),
		issues: [],
		state: snapshot ? "present" : "unknown",
		path,
		pulledAt: snapshot?.pulledAt,
	};
}

export function collectMetafieldReads(
	dataAccesses: ThemeDataAccessRecord[],
): ThemeMetafieldReadRecord[] {
	const readsById = new Map<string, ThemeMetafieldReadRecord>();
	for (const access of dataAccesses) {
		const match = metafieldPath(access);
		if (!match) continue;
		const read = {
			id: `metafield-read:${access.id}`,
			fromPath: access.fromPath,
			...match,
			dataAccessId: access.id,
		};
		readsById.set(read.id, read);
	}
	return [...readsById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function joinMetafieldReads(
	definitions: ThemeMetafieldDefinitionRecord[],
	reads: ThemeMetafieldReadRecord[],
): ThemeMetafieldReadRecord[] {
	const byKey = new Map(
		definitions.map((definition) => [
			metafieldJoinKey(definition.owner, definition.namespace, definition.key),
			definition,
		]),
	);
	return reads.map((read) => {
		const definition =
			read.owner === "unknown"
				? undefined
				: byKey.get(metafieldJoinKey(read.owner, read.namespace, read.key));
		return { ...read, definitionId: definition?.id };
	});
}

export function analyzeMetafields(
	snapshot: ThemeMetafieldSnapshot | undefined,
	dataAccesses: ThemeDataAccessRecord[],
): ThemeMetafieldAnalysis {
	const collection = collectMetafieldDefinitions(snapshot);
	if (collection.state === "invalid") {
		return { ...collection, reads: [] };
	}
	const reads = joinMetafieldReads(
		collection.definitions,
		collectMetafieldReads(dataAccesses),
	);
	const issues: Diagnostic[] = reads
		.filter((read) => snapshot && !read.definitionId)
		.map((read) => ({
			severity: "warning" as const,
			code: "THEME_METAFIELD_UNRESOLVED",
			message: `Metafield ${read.owner}.metafields.${read.namespace}.${read.key} is not defined in ${collection.path}`,
			phase: "resolve" as const,
		}));
	return {
		...collection,
		reads,
		issues: [...collection.issues, ...issues],
	};
}

export function metafieldDefinitionId(
	owner: string,
	namespace: string,
	key: string,
): string {
	return `metafield:${owner}:${namespace}:${key}`;
}

function metafieldPath(
	access: ThemeDataAccessRecord,
): { owner: string; namespace: string; key: string } | undefined {
	if (!access.propertyPath) return undefined;
	const parts = access.propertyPath.split(".");
	const offset = access.object === "metafields" ? 0 : 1;
	if (access.object !== "metafields" && parts[0] !== "metafields")
		return undefined;
	if (!parts[offset] || !parts[offset + 1]) return undefined;
	return {
		owner: access.object === "metafields" ? "unknown" : access.object,
		namespace: parts[offset],
		key: parts[offset + 1],
	};
}

const METAFIELD_CONTAINER_KEYS = new Set([
	"data",
	"definitions",
	"metafieldDefinitions",
	"metafields",
]);
const METAFIELD_OWNER_NAMES = new Set([
	"article",
	"blog",
	"cart",
	"collection",
	"company",
	"company_location",
	"customer",
	"draft_order",
	"fulfillment_service",
	"location",
	"market",
	"order",
	"page",
	"product",
	"product_variant",
	"shop",
	"variant",
]);

function isSupportedMetafieldSnapshot(value: unknown): boolean {
	if (Array.isArray(value)) return true;
	if (!isRecord(value)) return false;
	if (
		stringValue(value.namespace) &&
		stringValue(value.key) &&
		(value.owner || value.ownerType || value.resourceType)
	) {
		return true;
	}
	return Object.keys(value).some(
		(key) =>
			METAFIELD_CONTAINER_KEYS.has(key) ||
			METAFIELD_OWNER_NAMES.has(key.toLowerCase()),
	);
}

function findDefinitionCandidates(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) {
		return value.flatMap((item) =>
			isRecord(item) ? findDefinitionCandidates(item) : [],
		);
	}
	if (!isRecord(value)) return [];
	if (
		stringValue(value.namespace) &&
		stringValue(value.key) &&
		(value.owner || value.ownerType || value.resourceType)
	) {
		return [value];
	}
	const candidates: Record<string, unknown>[] = [];
	for (const [key, child] of Object.entries(value)) {
		if (METAFIELD_CONTAINER_KEYS.has(key)) {
			candidates.push(...findDefinitionCandidates(child));
			continue;
		}
		if (!METAFIELD_OWNER_NAMES.has(key.toLowerCase()) || !isRecord(child))
			continue;
		for (const [namespace, keys] of Object.entries(child)) {
			if (!isRecord(keys)) continue;
			for (const [metafieldKey, definition] of Object.entries(keys)) {
				if (!isRecord(definition)) continue;
				candidates.push({
					owner: key,
					namespace,
					key: metafieldKey,
					...definition,
				});
			}
		}
	}
	return candidates;
}
function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function stringValue(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}
function normalizeOwner(value: string | undefined): string | undefined {
	return value?.replace(/^resource_type:/i, "").toLowerCase();
}
function typeValue(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (isRecord(value)) return stringValue(value.name ?? value.category);
	return undefined;
}
export function metafieldJoinKey(
	owner: string,
	namespace: string,
	key: string,
): string {
	return `${owner}:${namespace}:${key}`.toLowerCase();
}
