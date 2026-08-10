import type {
	SemanticInspectRequest,
	SemanticInspectSubject,
} from "./contract.js";

const TOP_LEVEL_KEYS = new Set([
	"query",
	"kinds",
	"subject",
	"facet",
	"evidence",
	"limit",
	"cursor",
]);
const PUBLIC_KINDS = ["file", "snippet", "render", "expression"] as const;
const FACETS = [
	"summary",
	"dependencies",
	"dependents",
	"usages",
	"occurrences",
] as const;
const EVIDENCE_MODES = ["none", "location", "excerpt"] as const;

export class InvalidSemanticInspectRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "InvalidSemanticInspectRequestError";
	}
}

export function parseSemanticInspectRequest(
	input: unknown,
): SemanticInspectRequest {
	const value = object(input, "inspect request");
	for (const key of Object.keys(value)) {
		if (!TOP_LEVEL_KEYS.has(key)) {
			throw new InvalidSemanticInspectRequestError(
				`Unknown inspect field ${key}`,
			);
		}
	}
	const hasQuery = "query" in value;
	const hasSubject = "subject" in value;
	if (hasQuery === hasSubject) {
		throw new InvalidSemanticInspectRequestError(
			"Inspect request needs exactly one of query or subject",
		);
	}
	const evidence = optionalEnum(value.evidence, EVIDENCE_MODES, "evidence");
	const limit = optionalPositiveInteger(value.limit, "limit");
	const cursor = optionalString(value.cursor, "cursor");
	if (hasQuery) {
		if ("facet" in value) {
			throw new InvalidSemanticInspectRequestError(
				"Discovery query does not accept a facet",
			);
		}
		const query = nonEmptyString(value.query, "query");
		let kinds: readonly (typeof PUBLIC_KINDS)[number][] | undefined;
		if (value.kinds !== undefined) {
			if (!Array.isArray(value.kinds) || value.kinds.length === 0) {
				throw new InvalidSemanticInspectRequestError(
					"kinds must be a non-empty array",
				);
			}
			kinds = [
				...new Set(
					value.kinds.map((kind) => requiredEnum(kind, PUBLIC_KINDS, "kind")),
				),
			];
		}
		return compact({ query, kinds, evidence, limit, cursor });
	}
	if ("kinds" in value) {
		throw new InvalidSemanticInspectRequestError(
			"Typed subject request does not accept kinds",
		);
	}
	const subject = parseSubject(value.subject);
	const facet = optionalEnum(value.facet, FACETS, "facet");
	return compact({ subject, facet, evidence, limit, cursor });
}

function parseSubject(input: unknown): SemanticInspectSubject {
	const value = object(input, "subject");
	const type = requiredEnum(value.type, PUBLIC_KINDS, "subject.type");
	const allowed =
		type === "file" || type === "snippet"
			? new Set(["type", type === "file" ? "path" : "handle"])
			: new Set(["type", "path", "offset"]);
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new InvalidSemanticInspectRequestError(
				`Unknown ${type} subject field ${key}`,
			);
		}
	}
	if (type === "file") {
		return { type, path: nonEmptyString(value.path, "subject.path") };
	}
	if (type === "snippet") {
		return { type, handle: nonEmptyString(value.handle, "subject.handle") };
	}
	return {
		type,
		path: nonEmptyString(value.path, "subject.path"),
		offset: nonNegativeInteger(value.offset, "subject.offset"),
	};
}

function object(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new InvalidSemanticInspectRequestError(`${name} must be an object`);
	}
	return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new InvalidSemanticInspectRequestError(
			`${name} must be a non-empty string`,
		);
	}
	return value.trim();
}

function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || !value) {
		throw new InvalidSemanticInspectRequestError(`${name} must be a string`);
	}
	return value;
}

function optionalPositiveInteger(
	value: unknown,
	name: string,
): number | undefined {
	if (value === undefined) return undefined;
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new InvalidSemanticInspectRequestError(
			`${name} must be a positive safe integer`,
		);
	}
	return Number(value);
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new InvalidSemanticInspectRequestError(
			`${name} must be a non-negative safe integer`,
		);
	}
	return Number(value);
}

function optionalEnum<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	name: string,
): Values[number] | undefined {
	return value === undefined ? undefined : requiredEnum(value, values, name);
}

function requiredEnum<const Values extends readonly string[]>(
	value: unknown,
	values: Values,
	name: string,
): Values[number] {
	if (typeof value !== "string" || !values.includes(value)) {
		throw new InvalidSemanticInspectRequestError(
			`${name} must be one of ${values.join(", ")}`,
		);
	}
	return value;
}

function compact<Value extends Record<string, unknown>>(value: Value): Value {
	return Object.fromEntries(
		Object.entries(value).filter(([, item]) => item !== undefined),
	) as Value;
}
