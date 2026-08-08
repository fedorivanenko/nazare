import {
	type DocumentNode,
	type FieldNode,
	type FragmentDefinitionNode,
	Kind,
	parse,
	type SelectionSetNode,
	type ValueNode,
} from "graphql";

export type ShopifyGraphqlMetafieldReference = {
	owner?: string;
	namespace?: string;
	key?: string;
	certainty: "exact" | "partial";
};

export function extractShopifyGraphqlMetafields(
	query: string,
): ShopifyGraphqlMetafieldReference[] {
	let document: DocumentNode;
	try {
		document = parse(query, { noLocation: true });
	} catch {
		return [];
	}
	const fragments = new Map<string, FragmentDefinitionNode>();
	for (const definition of document.definitions) {
		if (definition.kind === Kind.FRAGMENT_DEFINITION)
			fragments.set(definition.name.value, definition);
	}
	const references: ShopifyGraphqlMetafieldReference[] = [];
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
				if (selection.name.value === "metafield")
					references.push(referenceFromMetafield(selection, owner));
				else if (selection.name.value === "metafields")
					references.push(...referencesFromMetafields(selection, owner));
				if (selection.selectionSet)
					walkSelectionSet(
						selection.selectionSet,
						ownerAfterField(selection.name.value, owner),
						activeFragments,
					);
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
			walkSelectionSet(
				fragment.selectionSet,
				graphqlOwner(fragment.typeCondition.name.value),
				new Set(activeFragments).add(name),
			);
		}
	}
}

function referenceFromMetafield(
	field: FieldNode,
	owner: string | undefined,
): ShopifyGraphqlMetafieldReference {
	const namespace = stringArgument(field, "namespace");
	const key = stringArgument(field, "key");
	return owner && namespace && key
		? { certainty: "exact", owner, namespace, key }
		: { certainty: "partial", owner, namespace, key };
}

function referencesFromMetafields(
	field: FieldNode,
	owner: string | undefined,
): ShopifyGraphqlMetafieldReference[] {
	const identifiers = field.arguments?.find(
		(argument) => argument.name.value === "identifiers",
	)?.value;
	if (!identifiers || identifiers.kind !== Kind.LIST)
		return [{ owner, certainty: "partial" }];
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

type SupportedShopifyMetafieldOwner =
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

const SHOPIFY_GRAPHQL_OWNER_ALIASES = {
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
} as const satisfies Readonly<Record<string, SupportedShopifyMetafieldOwner>>;

const TRANSPARENT_OWNER_FIELDS = new Set(["edges", "node", "nodes"]);

function ownerAfterField(
	fieldName: string,
	owner: string | undefined,
): string | undefined {
	return (
		graphqlOwner(fieldName) ??
		(TRANSPARENT_OWNER_FIELDS.has(fieldName) ? owner : undefined)
	);
}

function graphqlOwner(
	name: string | undefined,
): SupportedShopifyMetafieldOwner | undefined {
	if (!name) return undefined;
	const normalized = name.replace(/[^A-Za-z]/g, "").toLowerCase();
	return Object.hasOwn(SHOPIFY_GRAPHQL_OWNER_ALIASES, normalized)
		? SHOPIFY_GRAPHQL_OWNER_ALIASES[
				normalized as keyof typeof SHOPIFY_GRAPHQL_OWNER_ALIASES
			]
		: undefined;
}

function dedupeReferences(
	references: ShopifyGraphqlMetafieldReference[],
): ShopifyGraphqlMetafieldReference[] {
	const byKey = new Map<string, ShopifyGraphqlMetafieldReference>();
	for (const reference of references) {
		const key = `${reference.owner ?? ""}\0${reference.namespace ?? ""}\0${reference.key ?? ""}\0${reference.certainty}`;
		byKey.set(key, reference);
	}
	return [...byKey.values()].sort((left, right) =>
		JSON.stringify(left).localeCompare(JSON.stringify(right)),
	);
}
