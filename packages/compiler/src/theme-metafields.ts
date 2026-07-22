import type { Diagnostic } from "@nazare/core";
import type { ThemeDataAccessRecord } from "./theme-facts.js";

export type ThemeMetafieldSnapshot = {
	path?: string;
	contents: string;
	pulledAt?: string;
};

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

export function analyzeMetafields(
	snapshot: ThemeMetafieldSnapshot | undefined,
	dataAccesses: ThemeDataAccessRecord[],
): ThemeMetafieldAnalysis {
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
				reads: [],
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
	const byKey = new Map(
		definitions.map((definition) => [
			definitionKey(definition.owner, definition.namespace, definition.key),
			definition,
		]),
	);
	const reads: ThemeMetafieldReadRecord[] = [];
	for (const access of dataAccesses) {
		const match = metafieldPath(access);
		if (!match) continue;
		const definition = byKey.get(
			definitionKey(match.owner, match.namespace, match.key),
		);
		reads.push({
			id: `metafield-read:${access.id}`,
			fromPath: access.fromPath,
			...match,
			definitionId: definition?.id,
			dataAccessId: access.id,
		});
	}
	const issues: Diagnostic[] = reads
		.filter((read) => snapshot && !read.definitionId)
		.map((read) => ({
			severity: "warning" as const,
			code: "THEME_METAFIELD_UNRESOLVED",
			message: `Metafield ${read.owner}.metafields.${read.namespace}.${read.key} is not defined in ${path}`,
			phase: "resolve" as const,
		}));
	return {
		definitions: definitions.sort((a, b) => a.id.localeCompare(b.id)),
		reads: reads.sort((a, b) => a.id.localeCompare(b.id)),
		issues,
		state: snapshot ? "present" : "unknown",
		path,
		pulledAt: snapshot?.pulledAt,
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
	if (parts[0] !== "metafields" || !parts[1] || !parts[2]) return undefined;
	return { owner: access.object, namespace: parts[1], key: parts[2] };
}

function findDefinitionCandidates(value: unknown): Record<string, unknown>[] {
	if (Array.isArray(value)) return value.filter(isRecord);
	if (!isRecord(value)) return [];
	for (const key of [
		"definitions",
		"metafields",
		"metafieldDefinitions",
		"data",
	]) {
		if (Array.isArray(value[key])) return value[key].filter(isRecord);
	}
	const nested: Record<string, unknown>[] = [];
	for (const [owner, namespaces] of Object.entries(value)) {
		if (!isRecord(namespaces)) continue;
		for (const [namespace, keys] of Object.entries(namespaces)) {
			if (!isRecord(keys)) continue;
			for (const [key, definition] of Object.entries(keys)) {
				if (!isRecord(definition)) continue;
				nested.push({ owner, namespace, key, ...definition });
			}
		}
	}
	return nested.length > 0
		? nested
		: Object.values(value).flatMap((child) => findDefinitionCandidates(child));
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
function definitionKey(owner: string, namespace: string, key: string): string {
	return `${owner}:${namespace}:${key}`.toLowerCase();
}
