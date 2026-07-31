import type { Program } from "acorn";
import {
	type DocumentNode,
	type FieldNode,
	type FragmentDefinitionNode,
	Kind,
	parse,
	type SelectionSetNode,
	type ValueNode,
} from "graphql";
import { type JavaScriptNode, walkJavaScript } from "./javascript-ast.js";
import { spanFromOffsets } from "./source.js";
import type {
	ThemeFact,
	ThemeNetworkMetafieldReference,
} from "./theme-facts.js";
import type { ThemeSourceUncertainty } from "./theme-source-frontend.js";

export type ThemeScriptNetworkAnalysis = {
	facts: ThemeFact[];
	uncertainty: ThemeSourceUncertainty[];
};

/**
 * Local-source boundary for network data:
 *
 * - Every statically visible `fetch`, `XMLHttpRequest.open`, `sendBeacon`, or
 *   parseable GraphQL-client call is recorded as local evidence.
 * - Static GraphQL metafield arguments become queryable references.
 * - Dynamic GraphQL payloads remain explicit uncertainty.
 * - Runtime responses, app proxies, remote app code, and server-side app data
 *   are opaque. This pass never guesses what those systems return.
 */
export function analyzeThemeScriptNetwork(
	path: string,
	source: string,
	program: Program,
): ThemeScriptNetworkAnalysis {
	const facts: ThemeFact[] = [];
	const uncertainty: ThemeSourceUncertainty[] = [];
	const strings = collectStaticStrings(program);
	const xhrBindings = collectXmlHttpRequestBindings(program);

	walkJavaScript(program, (node) => {
		if (node.type !== "CallExpression") return;
		const call = node;
		const callee = asNode(call.callee);
		const args = nodes(call.arguments);
		const directName = identifierName(callee);
		const method =
			callee?.type === "MemberExpression" ? memberName(callee) : undefined;
		let transport:
			| Extract<ThemeFact, { kind: "accessesNetwork" }>["transport"]
			| undefined;
		let endpointNode: JavaScriptNode | undefined;
		let optionsNode: JavaScriptNode | undefined;
		let queryNode: JavaScriptNode | undefined;

		if (directName === "fetch" || method === "fetch") {
			transport = "fetch";
			endpointNode = args[0];
			optionsNode = args[1];
		} else if (
			method === "open" &&
			callee &&
			isXmlHttpRequestCall(callee, xhrBindings)
		) {
			transport = "xmlHttpRequest";
			endpointNode = args[1];
		} else if (method === "sendBeacon") {
			transport = "sendBeacon";
			endpointNode = args[0];
			optionsNode = args[1];
		} else if (
			method === "query" ||
			method === "request" ||
			method === "mutate"
		) {
			queryNode = graphqlClientQueryNode(args, method);
			const candidate = staticString(queryNode, strings);
			if (!candidate || !looksLikeGraphql(candidate)) return;
			transport = "graphqlClient";
		} else return;

		const endpoint = staticString(endpointNode, strings);
		const methodName = requestMethod(transport, args, optionsNode, strings);
		const queryText =
			staticString(queryNode, strings) ??
			graphqlQueryFromRequest(endpoint, optionsNode, strings);
		const endpointLooksGraphql =
			endpoint?.toLowerCase().includes("graphql") === true;
		let graphql: Extract<ThemeFact, { kind: "accessesNetwork" }>["graphql"] =
			"none";
		let metafieldReferences: ThemeNetworkMetafieldReference[] = [];

		if (queryText !== undefined) {
			try {
				const document = parse(queryText, { noLocation: true });
				graphql = "static";
				metafieldReferences = collectGraphqlMetafieldReferences(document);
			} catch {
				if (looksLikeGraphql(queryText) || endpointLooksGraphql) {
					graphql = "invalid";
					pushUncertainty(
						"Static GraphQL request could not be parsed; metafield impact is partial",
						call,
					);
				}
			}
		} else if (
			endpointLooksGraphql ||
			requestMayContainGraphql(optionsNode, strings)
		) {
			graphql = "dynamic";
			pushUncertainty(
				"Dynamic local GraphQL payload prevents exact metafield request analysis",
				call,
			);
		}

		facts.push({
			kind: "accessesNetwork",
			fromPath: path,
			transport,
			endpoint,
			method: methodName,
			graphql,
			metafieldReferences,
			span: nodeSpan(call),
		});
	});
	return { facts, uncertainty };

	function nodeSpan(node: JavaScriptNode) {
		return spanFromOffsets(source, path, { start: node.start, end: node.end });
	}

	function pushUncertainty(message: string, node: JavaScriptNode): void {
		uncertainty.push({
			code: "THEME_DYNAMIC_GRAPHQL_REQUEST",
			message,
			span: nodeSpan(node),
		});
	}
}

function collectStaticStrings(program: Program): Map<string, string> {
	const candidates = new Map<string, Set<string>>();
	walkJavaScript(program, (node) => {
		if (node.type !== "VariableDeclarator") return;
		const name = identifierName(asNode(node.id));
		const value = literalString(asNode(node.init));
		if (!name || value === undefined) return;
		const values = candidates.get(name) ?? new Set<string>();
		values.add(value);
		candidates.set(name, values);
	});
	return new Map(
		[...candidates]
			.filter(([, values]) => values.size === 1)
			.map(([name, values]) => [name, [...values][0]]),
	);
}

function collectXmlHttpRequestBindings(program: Program): Set<string> {
	const result = new Set<string>();
	walkJavaScript(program, (node) => {
		if (node.type !== "VariableDeclarator") return;
		const name = identifierName(asNode(node.id));
		const init = asNode(node.init);
		if (
			name &&
			init?.type === "NewExpression" &&
			identifierName(asNode(init.callee)) === "XMLHttpRequest"
		) {
			result.add(name);
		}
	});
	return result;
}

function isXmlHttpRequestCall(
	callee: JavaScriptNode,
	bindings: ReadonlySet<string>,
): boolean {
	if (callee.type !== "MemberExpression") return false;
	const object = asNode(callee.object);
	if (object?.type === "NewExpression") {
		return identifierName(asNode(object.callee)) === "XMLHttpRequest";
	}
	const name = identifierName(object);
	return name !== undefined && bindings.has(name);
}

function graphqlClientQueryNode(
	args: JavaScriptNode[],
	method: string,
): JavaScriptNode | undefined {
	if (method === "request") return args[0];
	const first = args[0];
	return first?.type === "ObjectExpression"
		? (objectPropertyValue(first, "query") ??
				objectPropertyValue(first, "mutation"))
		: first;
}

function graphqlQueryFromRequest(
	endpoint: string | undefined,
	options: JavaScriptNode | undefined,
	strings: ReadonlyMap<string, string>,
): string | undefined {
	if (endpoint) {
		try {
			const query = new URL(
				endpoint,
				"https://nazare.invalid",
			).searchParams.get("query");
			if (query) return query;
		} catch {
			// Endpoint is still valid network evidence even when not URL-parseable.
		}
	}
	if (options?.type !== "ObjectExpression") return undefined;
	const direct = objectPropertyValue(options, "query");
	const directValue = staticString(direct, strings);
	if (directValue !== undefined) return directValue;
	const body = objectPropertyValue(options, "body");
	const bodyValue = staticString(body, strings);
	if (bodyValue !== undefined) {
		try {
			const parsed: unknown = JSON.parse(bodyValue);
			if (
				parsed &&
				typeof parsed === "object" &&
				"query" in parsed &&
				typeof parsed.query === "string"
			) {
				return parsed.query;
			}
		} catch {
			if (looksLikeGraphql(bodyValue)) return bodyValue;
		}
	}
	if (body?.type === "CallExpression") {
		const callee = asNode(body.callee);
		if (
			callee?.type === "MemberExpression" &&
			identifierName(asNode(callee.object)) === "JSON" &&
			memberName(callee) === "stringify"
		) {
			const payload = nodes(body.arguments)[0];
			if (payload?.type === "ObjectExpression") {
				return staticString(objectPropertyValue(payload, "query"), strings);
			}
		}
	}
	return undefined;
}

function requestMethod(
	transport: Extract<ThemeFact, { kind: "accessesNetwork" }>["transport"],
	args: JavaScriptNode[],
	options: JavaScriptNode | undefined,
	strings: ReadonlyMap<string, string>,
): string | undefined {
	if (transport === "xmlHttpRequest")
		return staticString(args[0], strings)?.toUpperCase();
	if (transport !== "fetch" || options?.type !== "ObjectExpression")
		return undefined;
	return staticString(
		objectPropertyValue(options, "method"),
		strings,
	)?.toUpperCase();
}

function requestMayContainGraphql(
	options: JavaScriptNode | undefined,
	strings: ReadonlyMap<string, string>,
): boolean {
	if (options?.type !== "ObjectExpression") return false;
	if (objectPropertyValue(options, "query") !== undefined) return true;
	const body = objectPropertyValue(options, "body");
	const bodyValue = staticString(body, strings);
	if (bodyValue !== undefined) {
		return looksLikeGraphql(bodyValue) || /["']query["']\s*:/.test(bodyValue);
	}
	if (body?.type !== "CallExpression") return false;
	const callee = asNode(body.callee);
	if (
		callee?.type !== "MemberExpression" ||
		identifierName(asNode(callee.object)) !== "JSON" ||
		memberName(callee) !== "stringify"
	) {
		return false;
	}
	const payload = nodes(body.arguments)[0];
	return (
		payload?.type === "ObjectExpression" &&
		objectPropertyValue(payload, "query") !== undefined
	);
}

function collectGraphqlMetafieldReferences(
	document: DocumentNode,
): ThemeNetworkMetafieldReference[] {
	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const definition of document.definitions) {
		if (definition.kind === Kind.FRAGMENT_DEFINITION) {
			fragments.set(definition.name.value, definition);
		}
	}
	const references: ThemeNetworkMetafieldReference[] = [];
	for (const definition of document.definitions) {
		if (definition.kind !== Kind.OPERATION_DEFINITION) continue;
		walkSelectionSet(definition.selectionSet, undefined, new Set());
	}
	return dedupeReferences(references);

	function walkSelectionSet(
		selectionSet: SelectionSetNode,
		owner: string | undefined,
		activeFragments: Set<string>,
	): void {
		for (const selection of selectionSet.selections) {
			if (selection.kind === Kind.FIELD) {
				const nextOwner = graphqlOwner(selection.name.value) ?? owner;
				if (selection.name.value === "metafield") {
					references.push(referenceFromMetafield(selection, nextOwner));
				} else if (selection.name.value === "metafields") {
					references.push(...referencesFromMetafields(selection, nextOwner));
				}
				if (selection.selectionSet) {
					walkSelectionSet(selection.selectionSet, nextOwner, activeFragments);
				}
				continue;
			}
			if (selection.kind === Kind.INLINE_FRAGMENT) {
				walkSelectionSet(
					selection.selectionSet,
					graphqlOwner(selection.typeCondition?.name.value) ?? owner,
					activeFragments,
				);
				continue;
			}
			const name = selection.name.value;
			if (activeFragments.has(name)) continue;
			const fragment = fragments.get(name);
			if (!fragment) continue;
			const next = new Set(activeFragments).add(name);
			walkSelectionSet(
				fragment.selectionSet,
				graphqlOwner(fragment.typeCondition.name.value) ?? owner,
				next,
			);
		}
	}
}

function referenceFromMetafield(
	field: FieldNode,
	owner: string | undefined,
): ThemeNetworkMetafieldReference {
	const namespace = stringArgument(field, "namespace");
	const key = stringArgument(field, "key");
	return {
		owner,
		namespace,
		key,
		certainty: owner && namespace && key ? "exact" : "partial",
	};
}

function referencesFromMetafields(
	field: FieldNode,
	owner: string | undefined,
): ThemeNetworkMetafieldReference[] {
	const identifiers = field.arguments?.find(
		(argument) => argument.name.value === "identifiers",
	)?.value;
	if (!identifiers || identifiers.kind !== Kind.LIST) {
		return [{ owner, certainty: "partial" }];
	}
	return identifiers.values.map((value) => {
		if (value.kind !== Kind.OBJECT) return { owner, certainty: "partial" };
		const namespace = stringObjectField(value, "namespace");
		const key = stringObjectField(value, "key");
		return {
			owner,
			namespace,
			key,
			certainty: owner && namespace && key ? "exact" : "partial",
		};
	});
}

function stringArgument(field: FieldNode, name: string): string | undefined {
	return stringValue(
		field.arguments?.find((argument) => argument.name.value === name)?.value,
	);
}

function stringObjectField(
	value: Extract<ValueNode, { kind: typeof Kind.OBJECT }>,
	name: string,
): string | undefined {
	return stringValue(
		value.fields.find((field) => field.name.value === name)?.value,
	);
}

function stringValue(value: ValueNode | undefined): string | undefined {
	return value?.kind === Kind.STRING ? value.value : undefined;
}

function graphqlOwner(name: string | undefined): string | undefined {
	if (!name) return undefined;
	const normalized = name.replace(/[^A-Za-z]/g, "").toLowerCase();
	const owners: Record<string, string> = {
		article: "article",
		articles: "article",
		blog: "blog",
		blogs: "blog",
		collection: "collection",
		collections: "collection",
		company: "company",
		companies: "company",
		companylocation: "company_location",
		companylocations: "company_location",
		customer: "customer",
		customers: "customer",
		location: "location",
		locations: "location",
		market: "market",
		markets: "market",
		order: "order",
		orders: "order",
		page: "page",
		pages: "page",
		product: "product",
		products: "product",
		productvariant: "variant",
		productvariants: "variant",
		shop: "shop",
		variant: "variant",
		variants: "variant",
	};
	return owners[normalized];
}

function dedupeReferences(
	references: ThemeNetworkMetafieldReference[],
): ThemeNetworkMetafieldReference[] {
	const byKey = new Map<string, ThemeNetworkMetafieldReference>();
	for (const reference of references) {
		const key = `${reference.owner ?? ""}\0${reference.namespace ?? ""}\0${reference.key ?? ""}\0${reference.certainty}`;
		byKey.set(key, reference);
	}
	return [...byKey.values()].sort((left, right) => {
		const leftKey = JSON.stringify(left);
		const rightKey = JSON.stringify(right);
		return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
	});
}

function objectPropertyValue(
	object: JavaScriptNode,
	name: string,
): JavaScriptNode | undefined {
	if (object.type !== "ObjectExpression") return undefined;
	for (const property of nodes(object.properties)) {
		if (property.type !== "Property") continue;
		const key =
			identifierName(asNode(property.key)) ??
			literalString(asNode(property.key));
		if (key === name) return asNode(property.value);
	}
	return undefined;
}

function staticString(
	node: JavaScriptNode | undefined,
	strings: ReadonlyMap<string, string>,
): string | undefined {
	const literal = literalString(node);
	if (literal !== undefined) return literal;
	const name = identifierName(node);
	return name ? strings.get(name) : undefined;
}

function literalString(node: JavaScriptNode | undefined): string | undefined {
	if (!node) return undefined;
	if (node.type === "Literal" && typeof node.value === "string")
		return node.value;
	const template =
		node.type === "TaggedTemplateExpression" ? asNode(node.quasi) : node;
	if (
		!template ||
		template.type !== "TemplateLiteral" ||
		nodes(template.expressions).length > 0
	)
		return undefined;
	const quasi = nodes(template.quasis)[0];
	const value = quasi?.value;
	return value &&
		typeof value === "object" &&
		"cooked" in value &&
		typeof value.cooked === "string"
		? value.cooked
		: undefined;
}

function looksLikeGraphql(value: string): boolean {
	return /\b(query|mutation|subscription|fragment)\b|\bmetafields?\s*\(/.test(
		value,
	);
}

function memberName(node: JavaScriptNode): string | undefined {
	if (node.type !== "MemberExpression") return undefined;
	return node.computed
		? literalString(asNode(node.property))
		: identifierName(asNode(node.property));
}

function identifierName(node: JavaScriptNode | undefined): string | undefined {
	return node?.type === "Identifier" && typeof node.name === "string"
		? node.name
		: undefined;
}

function asNode(value: unknown): JavaScriptNode | undefined {
	return value && typeof value === "object" && "type" in value
		? (value as JavaScriptNode)
		: undefined;
}

function nodes(value: unknown): JavaScriptNode[] {
	if (!Array.isArray(value)) return [];
	return value.map(asNode).filter((node): node is JavaScriptNode => !!node);
}
