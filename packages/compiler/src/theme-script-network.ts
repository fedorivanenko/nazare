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
import type { SourceAnalysisUncertainty } from "./source-analysis-types.js";
import type {
	ThemeFact,
	ThemeNetworkMetafieldReference,
} from "./theme-facts.js";

export type ThemeScriptNetworkAnalysis = {
	facts: ThemeFact[];
	uncertainty: SourceAnalysisUncertainty[];
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
	const uncertainty: SourceAnalysisUncertainty[] = [];
	const bindings = new JavaScriptBindingResolver(program);

	walkJavaScript(program, (node) => {
		if (node.type !== "CallExpression") return;
		const call = node;
		const callee = asNode(call.callee);
		const args = nodes(call.arguments);
		const directName = identifierName(callee);
		const method =
			callee?.type === "MemberExpression" ? memberName(callee) : undefined;
		const graphqlClientKind =
			callee?.type === "MemberExpression"
				? bindings.graphqlClientKind(asNode(callee.object), call.start)
				: undefined;
		let transport:
			| Extract<ThemeFact, { kind: "accessesNetwork" }>["transport"]
			| undefined;
		let endpointNode: JavaScriptNode | undefined;
		let optionsNode: JavaScriptNode | undefined;
		let queryNode: JavaScriptNode | undefined;

		if (
			(directName === "fetch" &&
				!bindings.hasLexicalBinding("fetch", call.start)) ||
			(method === "fetch" &&
				isUnshadowedGlobalMemberCall(
					callee,
					["window", "self", "globalThis"],
					bindings,
					call.start,
				))
		) {
			transport = "fetch";
			endpointNode = args[0];
			optionsNode = args[1];
		} else if (
			method === "open" &&
			callee &&
			isXmlHttpRequestCall(callee, bindings, call.start)
		) {
			transport = "xmlHttpRequest";
			endpointNode = args[1];
		} else if (
			method === "sendBeacon" &&
			isUnshadowedGlobalMemberCall(callee, ["navigator"], bindings, call.start)
		) {
			transport = "sendBeacon";
			endpointNode = args[0];
			optionsNode = args[1];
		} else if (
			method &&
			graphqlClientKind &&
			isSupportedGraphqlClientMethod(graphqlClientKind, method)
		) {
			queryNode = graphqlClientQueryNode(args, graphqlClientKind);
			transport = "graphqlClient";
		} else return;

		const endpoint = staticString(endpointNode, bindings);
		const methodName = requestMethod(transport, args, optionsNode, bindings);
		const queryText =
			staticString(queryNode, bindings) ??
			graphqlQueryFromRequest(endpoint, optionsNode, bindings);
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
				graphql = "invalid";
				pushUncertainty(
					"THEME_INVALID_GRAPHQL_REQUEST",
					"Static GraphQL request could not be parsed; metafield impact is partial",
					call,
				);
			}
		} else if (
			endpointLooksGraphql ||
			transport === "graphqlClient" ||
			requestMayContainGraphql(optionsNode, bindings)
		) {
			graphql = "dynamic";
			pushUncertainty(
				"THEME_DYNAMIC_GRAPHQL_REQUEST",
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

	function pushUncertainty(
		code: "THEME_DYNAMIC_GRAPHQL_REQUEST" | "THEME_INVALID_GRAPHQL_REQUEST",
		message: string,
		node: JavaScriptNode,
	): void {
		uncertainty.push({
			code,
			message,
			span: nodeSpan(node),
		});
	}
}

function isXmlHttpRequestCall(
	callee: JavaScriptNode,
	bindings: JavaScriptBindingResolver,
	offset: number,
): boolean {
	if (callee.type !== "MemberExpression") return false;
	const object = asNode(callee.object);
	if (object?.type === "NewExpression") {
		return (
			identifierName(asNode(object.callee)) === "XMLHttpRequest" &&
			!bindings.hasLexicalBinding("XMLHttpRequest", object.start)
		);
	}
	return bindings.isXmlHttpRequest(object, offset);
}

function isUnshadowedGlobalMemberCall(
	callee: JavaScriptNode | undefined,
	globalNames: string[],
	bindings: JavaScriptBindingResolver,
	offset: number,
): boolean {
	if (callee?.type !== "MemberExpression") return false;
	const objectName = identifierName(asNode(callee.object));
	return (
		objectName !== undefined &&
		globalNames.includes(objectName) &&
		!bindings.hasLexicalBinding(objectName, offset)
	);
}

function graphqlClientQueryNode(
	args: JavaScriptNode[],
	kind: GraphqlClientKind,
): JavaScriptNode | undefined {
	const specification = graphqlClientSpecification(kind);
	if (!specification) return undefined;
	const first = args[0];
	if (specification.payload === "documentArgument") return first;
	return first?.type === "ObjectExpression"
		? (objectPropertyValue(first, "query") ??
				objectPropertyValue(first, "mutation"))
		: undefined;
}

function graphqlQueryFromRequest(
	endpoint: string | undefined,
	options: JavaScriptNode | undefined,
	bindings: JavaScriptBindingResolver,
): string | undefined {
	if (endpoint && URL.canParse(endpoint, "https://nazare.invalid")) {
		const query = new URL(endpoint, "https://nazare.invalid").searchParams.get(
			"query",
		);
		if (query) return query;
	}
	if (options?.type !== "ObjectExpression") return undefined;
	const direct = objectPropertyValue(options, "query");
	const directValue = staticString(direct, bindings);
	if (directValue !== undefined) return directValue;
	const body = objectPropertyValue(options, "body");
	const bodyValue = staticString(body, bindings);
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
			!bindings.hasLexicalBinding("JSON", callee.start) &&
			memberName(callee) === "stringify"
		) {
			const payload = nodes(body.arguments)[0];
			if (payload?.type === "ObjectExpression") {
				return staticString(objectPropertyValue(payload, "query"), bindings);
			}
		}
	}
	return undefined;
}

function requestMethod(
	transport: Extract<ThemeFact, { kind: "accessesNetwork" }>["transport"],
	args: JavaScriptNode[],
	options: JavaScriptNode | undefined,
	bindings: JavaScriptBindingResolver,
): string | undefined {
	if (transport === "xmlHttpRequest")
		return staticString(args[0], bindings)?.toUpperCase();
	if (transport !== "fetch" || options?.type !== "ObjectExpression")
		return undefined;
	return staticString(
		objectPropertyValue(options, "method"),
		bindings,
	)?.toUpperCase();
}

function requestMayContainGraphql(
	options: JavaScriptNode | undefined,
	bindings: JavaScriptBindingResolver,
): boolean {
	if (options?.type !== "ObjectExpression") return false;
	if (objectPropertyValue(options, "query") !== undefined) return true;
	const body = objectPropertyValue(options, "body");
	const bodyValue = staticString(body, bindings);
	if (bodyValue !== undefined) {
		return looksLikeGraphql(bodyValue) || /["']query["']\s*:/.test(bodyValue);
	}
	if (body?.type !== "CallExpression") return false;
	const callee = asNode(body.callee);
	if (
		callee?.type !== "MemberExpression" ||
		identifierName(asNode(callee.object)) !== "JSON" ||
		bindings.hasLexicalBinding("JSON", callee.start) ||
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
				if (selection.name.value === "metafield") {
					references.push(referenceFromMetafield(selection, owner));
				} else if (selection.name.value === "metafields") {
					references.push(...referencesFromMetafields(selection, owner));
				}
				if (selection.selectionSet) {
					walkSelectionSet(
						selection.selectionSet,
						ownerAfterField(selection.name.value, owner),
						activeFragments,
					);
				}
				continue;
			}
			if (selection.kind === Kind.INLINE_FRAGMENT) {
				walkSelectionSet(
					selection.selectionSet,
					graphqlOwner(selection.typeCondition?.name.value),
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
				graphqlOwner(fragment.typeCondition.name.value),
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
	return owner && namespace && key
		? { certainty: "exact", owner, namespace, key }
		: { certainty: "partial", owner, namespace, key };
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
		return owner && namespace && key
			? { certainty: "exact" as const, owner, namespace, key }
			: { certainty: "partial" as const, owner, namespace, key };
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
	if (value?.kind !== Kind.STRING) return undefined;
	return value.value.length > 0 && value.value === value.value.trim()
		? value.value
		: undefined;
}

type SupportedGraphqlMetafieldOwner =
	| "article"
	| "blog"
	| "collection"
	| "company"
	| "company_location"
	| "customer"
	| "location"
	| "market"
	| "order"
	| "page"
	| "product"
	| "shop"
	| "variant";

const GRAPHQL_OWNER_ALIASES = {
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
} as const satisfies Readonly<Record<string, SupportedGraphqlMetafieldOwner>>;

const GRAPHQL_TRANSPARENT_OWNER_FIELDS = new Set(["edges", "node", "nodes"]);

/**
 * Owner proof is deliberately schema-free and narrow. A recognized Shopify
 * root/type establishes owner. Only connection wrappers preserve it. Any
 * unknown nested field or type condition clears owner, preventing an outer
 * product from being assigned to nested MediaImage or other HasMetafields data.
 */
function ownerAfterField(
	fieldName: string,
	owner: string | undefined,
): string | undefined {
	return (
		graphqlOwner(fieldName) ??
		(GRAPHQL_TRANSPARENT_OWNER_FIELDS.has(fieldName) ? owner : undefined)
	);
}

function graphqlOwner(
	name: string | undefined,
): SupportedGraphqlMetafieldOwner | undefined {
	if (!name) return undefined;
	const normalized = name.replace(/[^A-Za-z]/g, "").toLowerCase();
	return Object.hasOwn(GRAPHQL_OWNER_ALIASES, normalized)
		? GRAPHQL_OWNER_ALIASES[normalized as keyof typeof GRAPHQL_OWNER_ALIASES]
		: undefined;
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

type GraphqlClientKind = "graphql-request" | "apollo" | "shopify-storefront";
type GraphqlClientConstruction = "constructor" | "factory";

type GraphqlClientBindingSpec = {
	kind: GraphqlClientKind;
	importSource: string;
	importedName: string;
	construction: GraphqlClientConstruction;
	methods: readonly string[];
	payload: "documentArgument" | "operationOptions";
};

const SUPPORTED_GRAPHQL_CLIENT_BINDINGS: readonly GraphqlClientBindingSpec[] = [
	{
		kind: "graphql-request",
		importSource: "graphql-request",
		importedName: "GraphQLClient",
		construction: "constructor",
		methods: ["request"],
		payload: "documentArgument",
	},
	{
		kind: "apollo",
		importSource: "@apollo/client",
		importedName: "ApolloClient",
		construction: "constructor",
		methods: ["query", "mutate"],
		payload: "operationOptions",
	},
	{
		kind: "shopify-storefront",
		importSource: "@shopify/storefront-api-client",
		importedName: "createStorefrontApiClient",
		construction: "factory",
		methods: ["request"],
		payload: "documentArgument",
	},
];

type JavaScriptBinding = {
	name: string;
	scopeStart: number;
	scopeEnd: number;
	scopeDepth: number;
	declarationStart: number;
	hoisted: boolean;
	kind: "const" | "let" | "var" | "parameter" | "function" | "class" | "import";
	staticValue?: string;
	written: boolean;
	importSource?: string;
	importedName?: string;
	graphqlClientKind?: GraphqlClientKind;
	xmlHttpRequest?: boolean;
	initializer?: JavaScriptNode;
};

/**
 * Minimal lexical binding model for proofs used by network analysis. Exact
 * strings require one visible immutable `const` binding with no writes.
 * GraphQL clients require explicit supported import plus construction:
 * `GraphQLClient` from `graphql-request`, `ApolloClient` from `@apollo/client`,
 * or `createStorefrontApiClient` from `@shopify/storefront-api-client`.
 */
class JavaScriptBindingResolver {
	private readonly byName = new Map<string, JavaScriptBinding[]>();

	constructor(program: Program) {
		const root = program as JavaScriptNode;
		walkJavaScript(program, (node, parent, ancestors) => {
			if (node.type === "ImportDeclaration") {
				const source = literalString(asNode(node.source));
				for (const specifier of nodes(node.specifiers)) {
					const local = identifierName(asNode(specifier.local));
					if (!local) continue;
					const importedName =
						specifier.type === "ImportSpecifier"
							? identifierName(asNode(specifier.imported))
							: specifier.type === "ImportDefaultSpecifier"
								? "default"
								: "*";
					this.add(local, root, 0, node.start, "import", true, {
						importSource: source,
						importedName,
					});
				}
				return;
			}
			if (isFunction(node)) {
				for (const parameter of nodes(node.params)) {
					for (const name of bindingNames(parameter)) {
						this.add(
							name,
							node,
							ancestors.length,
							node.start,
							"parameter",
							true,
						);
					}
				}
				const ownName =
					node.type === "FunctionExpression"
						? identifierName(asNode(node.id))
						: undefined;
				if (ownName) {
					this.add(
						ownName,
						node,
						ancestors.length,
						node.start,
						"function",
						true,
					);
				}
			}
			if (node.type === "FunctionDeclaration") {
				const name = identifierName(asNode(node.id));
				const scope = lexicalScope(ancestors.slice(0, -1), root);
				if (name)
					this.add(name, scope.node, scope.depth, node.start, "function", true);
			}
			if (node.type === "ClassDeclaration") {
				const name = identifierName(asNode(node.id));
				const scope = lexicalScope(ancestors.slice(0, -1), root);
				if (name)
					this.add(name, scope.node, scope.depth, node.start, "class", false);
			}
			if (node.type !== "VariableDeclarator") return;
			const declaration =
				parent?.type === "VariableDeclaration" ? parent : undefined;
			const declarationKind = declaration?.kind;
			if (
				declarationKind !== "const" &&
				declarationKind !== "let" &&
				declarationKind !== "var"
			) {
				return;
			}
			const scope =
				declarationKind === "var"
					? functionScope(ancestors.slice(0, -1), root)
					: lexicalScope(ancestors.slice(0, -1), root);
			const initializer = asNode(node.init);
			for (const name of bindingNames(asNode(node.id))) {
				this.add(
					name,
					scope.node,
					scope.depth,
					node.start,
					declarationKind,
					declarationKind === "var",
					{
						initializer,
						staticValue:
							declarationKind === "const"
								? literalString(initializer)
								: undefined,
					},
				);
			}
		});
		this.collectWrites(program);
		this.resolveConstructedBindings();
	}

	hasLexicalBinding(name: string, offset: number): boolean {
		return (this.byName.get(name) ?? []).some(
			(binding) => offset >= binding.scopeStart && offset <= binding.scopeEnd,
		);
	}

	staticString(node: JavaScriptNode | undefined): string | undefined {
		const name = identifierName(node);
		if (!name || !node) return undefined;
		const binding = this.resolve(name, node.start);
		return binding?.kind === "const" && !binding.written
			? binding.staticValue
			: undefined;
	}

	graphqlClientKind(
		node: JavaScriptNode | undefined,
		offset: number,
	): GraphqlClientKind | undefined {
		const name = identifierName(node);
		if (!name) return undefined;
		const binding = this.resolve(name, offset);
		return binding && !binding.written ? binding.graphqlClientKind : undefined;
	}

	isXmlHttpRequest(node: JavaScriptNode | undefined, offset: number): boolean {
		const name = identifierName(node);
		if (!name) return false;
		const binding = this.resolve(name, offset);
		return binding?.xmlHttpRequest === true && !binding.written;
	}

	private add(
		name: string,
		scope: JavaScriptNode,
		scopeDepth: number,
		declarationStart: number,
		kind: JavaScriptBinding["kind"],
		hoisted: boolean,
		extra: Partial<JavaScriptBinding> = {},
	): void {
		const binding: JavaScriptBinding = {
			name,
			scopeStart: scope.start,
			scopeEnd: scope.end,
			scopeDepth,
			declarationStart,
			hoisted,
			kind,
			written: false,
			...extra,
		};
		const bindings = this.byName.get(name) ?? [];
		bindings.push(binding);
		this.byName.set(name, bindings);
	}

	private resolve(name: string, offset: number): JavaScriptBinding | undefined {
		const visible = (this.byName.get(name) ?? []).filter(
			(binding) =>
				offset >= binding.scopeStart &&
				offset <= binding.scopeEnd &&
				(binding.hoisted || binding.declarationStart <= offset),
		);
		if (visible.length === 0) return undefined;
		const deepest = Math.max(...visible.map((binding) => binding.scopeDepth));
		const candidates = visible.filter(
			(binding) => binding.scopeDepth === deepest,
		);
		return candidates.length === 1 ? candidates[0] : undefined;
	}

	private collectWrites(program: Program): void {
		walkJavaScript(program, (node) => {
			let target: JavaScriptNode | undefined;
			if (node.type === "AssignmentExpression") target = asNode(node.left);
			else if (node.type === "UpdateExpression") target = asNode(node.argument);
			else return;
			const name = identifierName(target);
			if (!name || !target) return;
			const binding = this.resolve(name, target.start);
			if (binding) binding.written = true;
		});
	}

	private resolveConstructedBindings(): void {
		for (const bindings of this.byName.values()) {
			for (const binding of bindings) {
				if (binding.kind !== "const" || binding.written) continue;
				const initializer = binding.initializer;
				if (!initializer) continue;
				if (initializer.type === "NewExpression") {
					const importedConstructor = this.resolveImportedBinding(
						asNode(initializer.callee),
						initializer.start,
					);
					binding.graphqlClientKind = graphqlClientKindForBinding(
						importedConstructor,
						"constructor",
					);
					if (
						identifierName(asNode(initializer.callee)) === "XMLHttpRequest" &&
						!this.hasLexicalBinding("XMLHttpRequest", initializer.start)
					) {
						binding.xmlHttpRequest = true;
					}
				}
				if (initializer.type === "CallExpression") {
					const factory = this.resolveImportedBinding(
						asNode(initializer.callee),
						initializer.start,
					);
					binding.graphqlClientKind = graphqlClientKindForBinding(
						factory,
						"factory",
					);
				}
			}
		}
	}

	private resolveImportedBinding(
		node: JavaScriptNode | undefined,
		offset: number,
	): JavaScriptBinding | undefined {
		const name = identifierName(node);
		if (!name) return undefined;
		const binding = this.resolve(name, offset);
		return binding?.kind === "import" ? binding : undefined;
	}
}

function graphqlClientKindForBinding(
	binding: JavaScriptBinding | undefined,
	construction: GraphqlClientConstruction,
): GraphqlClientKind | undefined {
	if (!binding?.importSource || !binding.importedName) return undefined;
	return SUPPORTED_GRAPHQL_CLIENT_BINDINGS.find(
		(specification) =>
			specification.importSource === binding.importSource &&
			specification.importedName === binding.importedName &&
			specification.construction === construction,
	)?.kind;
}

function graphqlClientSpecification(
	kind: GraphqlClientKind,
): GraphqlClientBindingSpec | undefined {
	return SUPPORTED_GRAPHQL_CLIENT_BINDINGS.find(
		(specification) => specification.kind === kind,
	);
}

function isSupportedGraphqlClientMethod(
	kind: GraphqlClientKind,
	method: string,
): boolean {
	return graphqlClientSpecification(kind)?.methods.includes(method) === true;
}

function isFunction(node: JavaScriptNode): boolean {
	return (
		node.type === "FunctionDeclaration" ||
		node.type === "FunctionExpression" ||
		node.type === "ArrowFunctionExpression"
	);
}

function lexicalScope(
	ancestors: JavaScriptNode[],
	root: JavaScriptNode,
): { node: JavaScriptNode; depth: number } {
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		const node = ancestors[index];
		if (
			node.type === "BlockStatement" ||
			node.type === "Program" ||
			node.type === "ForStatement" ||
			node.type === "ForInStatement" ||
			node.type === "ForOfStatement" ||
			node.type === "SwitchStatement"
		) {
			return { node, depth: index };
		}
	}
	return { node: root, depth: 0 };
}

function functionScope(
	ancestors: JavaScriptNode[],
	root: JavaScriptNode,
): { node: JavaScriptNode; depth: number } {
	for (let index = ancestors.length - 1; index >= 0; index -= 1) {
		const node = ancestors[index];
		if (isFunction(node) || node.type === "Program") {
			return { node, depth: index };
		}
	}
	return { node: root, depth: 0 };
}

function bindingNames(node: JavaScriptNode | undefined): string[] {
	if (!node) return [];
	const name = identifierName(node);
	if (name) return [name];
	if (node.type === "RestElement") return bindingNames(asNode(node.argument));
	if (node.type === "AssignmentPattern") return bindingNames(asNode(node.left));
	if (node.type === "ArrayPattern")
		return nodes(node.elements).flatMap(bindingNames);
	if (node.type === "ObjectPattern") {
		return nodes(node.properties).flatMap((property) =>
			property.type === "RestElement"
				? bindingNames(asNode(property.argument))
				: bindingNames(asNode(property.value)),
		);
	}
	return [];
}

function staticString(
	node: JavaScriptNode | undefined,
	bindings: JavaScriptBindingResolver,
): string | undefined {
	const literal = literalString(node);
	if (literal !== undefined) return literal;
	return bindings.staticString(node);
}

function literalString(node: JavaScriptNode | undefined): string | undefined {
	if (!node) return undefined;
	if (node.type === "Literal" && typeof node.value === "string")
		return node.value;
	const template = node;
	if (
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
