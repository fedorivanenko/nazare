import {
	type CapabilityProvider,
	type ComputationGraph,
	defineCapability,
	defineCapabilityProvider,
	defineComputation,
	defineProduct,
	fingerprintProductKey,
	jsonComputationCodec,
	type ProjectFileId,
	type SourceFact,
	sourceProducts,
} from "@nazare/compiler";
import { registerShopifyQueryComputations } from "./query-products.js";
import { registerShopifyGraphComputations } from "./render-graph.js";
import { registerShopifyResolutionComputations } from "./resolution.js";
import {
	classifyShopifyFile,
	type ShopifyFileRole,
	shopifyResourceName,
} from "./role.js";
import { registerShopifySemanticComputations } from "./semantic-products.js";

export type ShopifyFileClassification = {
	file: ProjectFileId;
	role: ShopifyFileRole;
};

export type ShopifyDeclaration = {
	kind: "declaration";
	id: string;
	owner: ProjectFileId;
	role: ShopifyFileRole | "localeKey" | "component";
	name: string;
};

export type ShopifyReference = {
	kind: "reference";
	id: string;
	owner: ProjectFileId;
	referenceKind: string;
	siteId: string;
	targetRole?: ShopifyFileRole;
	targetName?: string;
	targetPath?: string;
	targetRelative?: boolean;
	static: boolean;
};

export type ShopifyDataRead = {
	kind: "dataRead";
	id: string;
	owner: ProjectFileId;
	object: string;
	name: string;
};

export type ShopifyBehavior = {
	kind: "behavior";
	id: string;
	owner: ProjectFileId;
	data: SourceFact["data"];
};

export type ShopifyTargetFact =
	| ShopifyDeclaration
	| ShopifyReference
	| ShopifyDataRead
	| ShopifyBehavior;

export type ShopifyTargetFacts = {
	file: ProjectFileId;
	role: ShopifyFileRole;
	facts: readonly ShopifyTargetFact[];
};

export const shopifyProducts = {
	classification: defineProduct<ProjectFileId, ShopifyFileClassification>({
		namespace: "nazare.target.shopify",
		id: "file-classification",
		version: 1,
	}),
	facts: defineProduct<ProjectFileId, ShopifyTargetFacts>({
		namespace: "nazare.target.shopify",
		id: "file-facts",
		version: 1,
	}),
	declarations: defineProduct<ProjectFileId, readonly ShopifyDeclaration[]>({
		namespace: "nazare.target.shopify",
		id: "file-declarations",
		version: 1,
	}),
	references: defineProduct<ProjectFileId, readonly ShopifyReference[]>({
		namespace: "nazare.target.shopify",
		id: "file-references",
		version: 1,
	}),
};

export type ShopifySemanticCapability = {
	targetId: "shopify";
	products: typeof shopifyProducts;
};

export const shopifySemanticCapability =
	defineCapability<ShopifySemanticCapability>("nazare.semantic.shopify");

export function shopifySemanticTarget(): CapabilityProvider<ShopifySemanticCapability> {
	return defineCapabilityProvider({
		capability: shopifySemanticCapability,
		id: "nazare.target.shopify",
		version: 1,
		value: { targetId: "shopify", products: shopifyProducts },
		registerComputations: registerShopifyComputations,
	});
}

function registerShopifyComputations(graph: ComputationGraph): void {
	const targetIdentityInput = "nazare.target.shopify.identity";
	const identityUpdate = graph.beginUpdate();
	identityUpdate.setInput(targetIdentityInput, "nazare.target.shopify@1");
	identityUpdate.commit();

	graph.register(
		defineComputation(
			shopifyProducts.classification,
			async (context, file) => {
				await context.input(targetIdentityInput);
				const source = await context.get(
					sourceProducts.classified.product(file),
				);
				return { file: source.id, role: classifyShopifyFile(source.id.path) };
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyProducts.facts,
			async (context, file) => {
				const classification = await context.get(
					shopifyProducts.classification.product(file),
				);
				const source = await context.get(sourceProducts.facts.product(file));
				const importPaths = nazareImportPaths(source.facts);
				const facts: ShopifyTargetFact[] = [
					...roleDeclarations(classification),
					...source.facts.flatMap((fact) =>
						enrichSourceFact(classification, fact, importPaths),
					),
				];
				if (
					classification.role === "templateJson" ||
					classification.role === "sectionGroup" ||
					classification.role === "locale"
				) {
					const parsed = await context.get(sourceProducts.parsed.product(file));
					facts.push(...jsonTargetFacts(classification, parsed.syntax.value));
				}
				return { file: classification.file, role: classification.role, facts };
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyProducts.declarations,
			async (context, file) => {
				const target = await context.get(shopifyProducts.facts.product(file));
				return target.facts.filter(
					(fact): fact is ShopifyDeclaration => fact.kind === "declaration",
				);
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyProducts.references,
			async (context, file) => {
				const target = await context.get(shopifyProducts.facts.product(file));
				return target.facts.filter(
					(fact): fact is ShopifyReference => fact.kind === "reference",
				);
			},
			{ cache: jsonComputationCodec() },
		),
	);

	registerShopifyResolutionComputations(graph);
	registerShopifyGraphComputations(graph);
	registerShopifySemanticComputations(graph);
	registerShopifyQueryComputations(graph);
}

function roleDeclarations(
	classification: ShopifyFileClassification,
): ShopifyDeclaration[] {
	if (
		classification.role === "other" ||
		classification.role === "settingsData"
	) {
		return [];
	}
	const name =
		classification.role === "asset"
			? (classification.file.path.split("/").at(-1) ?? classification.file.path)
			: shopifyResourceName(classification.file.path);
	return [declaration(classification, classification.role, name)];
}

function enrichSourceFact(
	classification: ShopifyFileClassification,
	fact: SourceFact,
	importPaths: ReadonlyMap<string, string>,
): ShopifyTargetFact[] {
	if (fact.kind === "liquid.reference" && isRecord(fact.data)) {
		const referenceKind = stringValue(fact.data.kind) ?? "liquid";
		const targetName = stringValue(fact.data.name);
		return [
			reference(classification, referenceKind, {
				siteId: fact.id,
				targetRole: liquidTargetRole(referenceKind),
				targetName,
				static: targetName !== undefined,
			}),
		];
	}
	if (fact.kind === "dependency" && isRecord(fact.data)) {
		const targetPath = stringValue(fact.data.path);
		return [
			reference(classification, stringValue(fact.data.kind) ?? "dependency", {
				siteId: fact.id,
				targetPath,
				targetRelative: fact.data.relative === true,
				static: targetPath !== undefined,
			}),
		];
	}
	if (fact.kind === "nazare.render" && isRecord(fact.data)) {
		const target = stringValue(fact.data.target);
		const targetPath = target ? importPaths.get(target) : undefined;
		return [
			reference(classification, "nazare-render", {
				siteId: fact.id,
				targetPath,
				targetRelative: true,
				static: targetPath !== undefined,
			}),
		];
	}
	if (fact.kind === "nazare.component" && isRecord(fact.data)) {
		return [
			declaration(
				classification,
				"component",
				stringValue(fact.data.componentKind) ??
					shopifyResourceName(classification.file.path),
			),
		];
	}
	if (fact.kind === "liquid.settings-read" && isRecord(fact.data)) {
		const object = stringValue(fact.data.object);
		const name = stringValue(fact.data.name);
		if (!object || !name) return [];
		return [
			{
				kind: "dataRead",
				id: targetFactId(classification.file, "data-read", fact.id),
				owner: classification.file,
				object,
				name,
			},
		];
	}
	if (fact.kind === "source.behavior") {
		return [
			{
				kind: "behavior",
				id: targetFactId(classification.file, "behavior", fact.data),
				owner: classification.file,
				data: fact.data,
			},
		];
	}
	return [];
}

function nazareImportPaths(
	facts: readonly SourceFact[],
): ReadonlyMap<string, string> {
	const imports = new Map<string, string>();
	for (const fact of facts) {
		if (fact.kind !== "dependency" || !isRecord(fact.data)) continue;
		const localName = stringValue(fact.data.localName);
		const path = stringValue(fact.data.path);
		if (localName && path) imports.set(localName, path);
	}
	return imports;
}

function jsonTargetFacts(
	classification: ShopifyFileClassification,
	value: unknown,
): ShopifyTargetFact[] {
	if (classification.role === "locale" && isRecord(value)) {
		return flattenLocaleKeys(value).map((name) =>
			declaration(classification, "localeKey", name),
		);
	}
	if (
		(classification.role === "templateJson" ||
			classification.role === "sectionGroup") &&
		isRecord(value) &&
		isRecord(value.sections)
	) {
		return Object.entries(value.sections).flatMap(([instanceId, section]) => {
			if (!isRecord(section)) return [];
			const targetName = stringValue(section.type);
			return [
				reference(classification, "section", {
					siteId: `json-section:${instanceId}`,
					targetRole: "section",
					targetName,
					static: targetName !== undefined,
				}),
			];
		});
	}
	return [];
}

function declaration(
	classification: ShopifyFileClassification,
	role: ShopifyDeclaration["role"],
	name: string,
): ShopifyDeclaration {
	return {
		kind: "declaration",
		id: targetFactId(classification.file, `declaration:${role}`, name),
		owner: classification.file,
		role,
		name,
	};
}

function reference(
	classification: ShopifyFileClassification,
	referenceKind: string,
	fields: Omit<ShopifyReference, "kind" | "id" | "owner" | "referenceKind">,
): ShopifyReference {
	return {
		kind: "reference",
		id: targetFactId(classification.file, `reference:${referenceKind}`, fields),
		owner: classification.file,
		referenceKind,
		...fields,
	};
}

function targetFactId(
	file: ProjectFileId,
	kind: string,
	data: unknown,
): string {
	return `shopify-fact:${fingerprintProductKey({ file, kind, data: jsonValue(data) })}`;
}

function liquidTargetRole(kind: string): ShopifyFileRole | undefined {
	if (kind === "snippet") return "snippet";
	if (kind === "section") return "section";
	if (kind === "section-group") return "sectionGroup";
	if (kind === "layout") return "layout";
	return undefined;
}

function flattenLocaleKeys(
	value: Record<string, unknown>,
	prefix = "",
): string[] {
	return Object.entries(value).flatMap(([key, child]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		return isRecord(child) ? flattenLocaleKeys(child, path) : [path];
	});
}

function jsonValue(value: unknown) {
	return JSON.parse(JSON.stringify(value));
}

function stringValue(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
