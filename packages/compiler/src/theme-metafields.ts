import type { Diagnostic } from "@nazare/core";
import { compareCanonicalStrings } from "./canonical-order.js";
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
	const scan = scanDefinitionCandidates(value);
	if (snapshot && !scan.recognized) {
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
	for (const item of scan.candidates) {
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
	const possiblyTruncatedOwners = snapshot
		? findPossiblyTruncatedOwners(value)
		: [];
	return {
		definitions: definitions.sort((a, b) =>
			compareCanonicalStrings(a.id, b.id),
		),
		issues: possiblyTruncatedOwners.map((owner) => ({
			severity: "warning",
			code: "THEME_METAFIELDS_POSSIBLY_TRUNCATED",
			message: `Metafield snapshot contains exactly ${SHOPIFY_METAFIELD_PULL_PAGE_SIZE} ${owner} definitions; Shopify CLI pulls may be truncated at one page`,
			phase: "parse" as const,
		})),
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
	return [...readsById.values()].sort((a, b) =>
		compareCanonicalStrings(a.id, b.id),
	);
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

const SHOPIFY_METAFIELD_PULL_PAGE_SIZE = 250;

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

/**
 * Result of reading a snapshot. `recognized` says the value was structurally a
 * metafield snapshot, which is not the same as it containing definitions: a
 * store with no metafields exports an empty list, and that is valid.
 *
 * Recognition is a result of the scan rather than a separate predicate. Two
 * functions encoding these shape rules had to agree about every accepted
 * layout, and nothing made them: the previous predicate accepted any array,
 * so `[1, 2, 3]` was a supported snapshot that yielded no definitions and one
 * THEME_METAFIELD_UNRESOLVED warning per metafield read in the theme.
 */
type MetafieldSnapshotScan = {
	recognized: boolean;
	candidates: Record<string, unknown>[];
};

function scanDefinitionCandidates(value: unknown): MetafieldSnapshotScan {
	if (Array.isArray(value)) {
		const scans = value.map((item) => scanDefinitionCandidates(item));
		return {
			// An empty list is a recognized, empty snapshot; a list holding
			// anything unrecognizable is not a snapshot at all.
			recognized: scans.every((scan) => scan.recognized),
			candidates: scans.flatMap((scan) => scan.candidates),
		};
	}
	if (!isRecord(value)) return { recognized: false, candidates: [] };
	if (
		stringValue(value.namespace) &&
		stringValue(value.key) &&
		(value.owner || value.ownerType || value.resourceType)
	) {
		return { recognized: true, candidates: [value] };
	}
	let recognized = false;
	const candidates: Record<string, unknown>[] = [];
	for (const [key, child] of Object.entries(value)) {
		if (METAFIELD_CONTAINER_KEYS.has(key)) {
			const scan = scanDefinitionCandidates(child);
			recognized ||= scan.recognized;
			candidates.push(...scan.candidates);
			continue;
		}
		if (!METAFIELD_OWNER_NAMES.has(key.toLowerCase())) continue;
		// What `shopify` writes to .shopify/metafields.json: each owner maps to a
		// list of definitions that carry their own key and namespace. An owner
		// with no definitions is an empty list, which is why an owner key alone
		// is enough to recognize the file.
		if (Array.isArray(child)) {
			recognized = true;
			for (const definition of child) {
				if (!isRecord(definition)) continue;
				if (
					!stringValue(definition.key) ||
					!stringValue(definition.namespace)
				) {
					continue;
				}
				candidates.push({ ...definition, owner: key });
			}
			continue;
		}
		if (!isRecord(child)) continue;
		recognized = true;
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
	return { recognized, candidates };
}
function findPossiblyTruncatedOwners(value: unknown): string[] {
	if (!isRecord(value)) return [];
	const owners = new Set<string>();
	for (const [key, child] of Object.entries(value)) {
		if (METAFIELD_CONTAINER_KEYS.has(key)) {
			for (const owner of findPossiblyTruncatedOwners(child)) owners.add(owner);
			continue;
		}
		if (
			METAFIELD_OWNER_NAMES.has(key.toLowerCase()) &&
			Array.isArray(child) &&
			child.length === SHOPIFY_METAFIELD_PULL_PAGE_SIZE
		) {
			owners.add(key.toLowerCase());
		}
	}
	return [...owners].sort(compareCanonicalStrings);
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
