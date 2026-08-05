import {
	type ComputationGraph,
	defineComputation,
	defineProduct,
	fingerprintProductKey,
	jsonComputationCodec,
	type ProductKey,
	type ProjectFileId,
	type SourceFact,
	sourceProducts,
} from "@nazare/compiler";
import type { Diagnostic } from "@nazare/core";
import {
	type ShopifyBehavior,
	type ShopifyFileClassification,
	shopifyProducts,
} from "./products.js";

export type ShopifySchemaSetting = {
	id: string;
	type: string;
	label?: string;
	defaultValue?: ProductKey;
};

export type ShopifyFileSchema = {
	file: ProjectFileId;
	settings: readonly ShopifySchemaSetting[];
	blocks: readonly { type: string }[];
	diagnostics: readonly Diagnostic[];
};

export type ShopifyMetafieldRead = {
	id: string;
	owner: ProjectFileId;
	ownerType: string;
	namespace?: string;
	key?: string;
	dynamic: boolean;
};

export type ShopifyCapability = {
	id: string;
	owner: ProjectFileId;
	capability: string;
	evidenceId: string;
};

export type ShopifyEvidence = {
	id: string;
	owner: ProjectFileId;
	kind: string;
	strength: "explicit" | "inferred";
	data: ProductKey;
};

export type ShopifyFileClassificationResult = {
	file: ProjectFileId;
	classes: readonly string[];
	evidenceIds: readonly string[];
	uncertainty: readonly string[];
};

export const shopifySemanticProducts = {
	schema: defineProduct<ProjectFileId, ShopifyFileSchema>({
		namespace: "nazare.target.shopify",
		id: "file-schema",
		version: 1,
	}),
	metafields: defineProduct<ProjectFileId, readonly ShopifyMetafieldRead[]>({
		namespace: "nazare.target.shopify",
		id: "file-metafield-reads",
		version: 1,
	}),
	behavior: defineProduct<ProjectFileId, readonly ShopifyBehavior[]>({
		namespace: "nazare.target.shopify",
		id: "file-behavior",
		version: 1,
	}),
	evidence: defineProduct<ProjectFileId, readonly ShopifyEvidence[]>({
		namespace: "nazare.target.shopify",
		id: "file-evidence",
		version: 1,
	}),
	capabilities: defineProduct<ProjectFileId, readonly ShopifyCapability[]>({
		namespace: "nazare.target.shopify",
		id: "file-capabilities",
		version: 1,
	}),
	classification: defineProduct<ProjectFileId, ShopifyFileClassificationResult>(
		{
			namespace: "nazare.target.shopify",
			id: "semantic-classification",
			version: 1,
		},
	),
};

export function registerShopifySemanticComputations(
	graph: ComputationGraph,
): void {
	graph.register(
		defineComputation(
			shopifySemanticProducts.schema,
			async (context, file) => {
				const source = await context.get(sourceProducts.facts.product(file));
				const schemaFact = source.facts.find(
					(fact) => fact.kind === "liquid.schema",
				);
				return parseSchema(file, schemaFact?.data);
			},
			{
				cache: jsonComputationCodec(),
				diagnostics: (result) => result.diagnostics,
			},
		),
	);

	graph.register(
		defineComputation(
			shopifySemanticProducts.metafields,
			async (context, file) => {
				const source = await context.get(sourceProducts.facts.product(file));
				return source.facts.flatMap((fact) => metafieldRead(file, fact));
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifySemanticProducts.behavior,
			async (context, file) => {
				const facts = await context.get(shopifyProducts.facts.product(file));
				return facts.facts.filter(
					(fact): fact is ShopifyBehavior => fact.kind === "behavior",
				);
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifySemanticProducts.evidence,
			async (context, file) => {
				const [classification, schema, metafields, behavior, references] =
					await Promise.all([
						context.get(shopifyProducts.classification.product(file)),
						context.get(shopifySemanticProducts.schema.product(file)),
						context.get(shopifySemanticProducts.metafields.product(file)),
						context.get(shopifySemanticProducts.behavior.product(file)),
						context.get(shopifyProducts.references.product(file)),
					]);
				return collectEvidence(
					classification,
					schema,
					metafields,
					behavior,
					references,
				);
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifySemanticProducts.capabilities,
			async (context, file) => {
				const evidence = await context.get(
					shopifySemanticProducts.evidence.product(file),
				);
				return evidence.flatMap((record) => {
					const capability = evidenceCapability(record);
					return capability
						? [
								{
									id: `shopify-capability:${record.id}`,
									owner: file,
									capability,
									evidenceId: record.id,
								},
							]
						: [];
				});
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifySemanticProducts.classification,
			async (context, file) => {
				const [evidence, capabilities] = await Promise.all([
					context.get(shopifySemanticProducts.evidence.product(file)),
					context.get(shopifySemanticProducts.capabilities.product(file)),
				]);
				const classes = new Set<string>();
				if (capabilities.some((item) => item.capability === "shopify.schema"))
					classes.add("configurable");
				if (capabilities.some((item) => item.capability === "browser.behavior"))
					classes.add("interactive");
				if (capabilities.some((item) => item.capability === "shopify.render"))
					classes.add("composed");
				if (
					capabilities.some((item) => item.capability === "shopify.metafields")
				)
					classes.add("data-driven");
				if (classes.size === 0) classes.add("static");
				return {
					file,
					classes: [...classes].sort(),
					evidenceIds: evidence.map((record) => record.id).sort(),
					uncertainty: evidence
						.filter((record) => record.kind === "dynamic-reference")
						.map(() => "Dynamic references prevent complete classification"),
				};
			},
			{ cache: jsonComputationCodec() },
		),
	);
}

function parseSchema(
	file: ProjectFileId,
	data: ProductKey | undefined,
): ShopifyFileSchema {
	if (!isRecord(data) || typeof data.body !== "string") {
		return { file, settings: [], blocks: [], diagnostics: [] };
	}
	try {
		const parsed: unknown = JSON.parse(data.body);
		if (!isRecord(parsed) || !Array.isArray(parsed.settings)) {
			return { file, settings: [], blocks: [], diagnostics: [] };
		}
		return {
			file,
			settings: parsed.settings.flatMap((setting) => parseSetting(setting)),
			blocks: Array.isArray(parsed.blocks)
				? parsed.blocks.flatMap((block) => parseBlock(block))
				: [],
			diagnostics: [],
		};
	} catch (error) {
		return {
			file,
			settings: [],
			blocks: [],
			diagnostics: [
				{
					severity: "error",
					code: "SHOPIFY_SCHEMA_PARSE_ERROR",
					message: `Invalid Shopify schema in ${file.path}: ${errorMessage(error)}`,
					phase: "parse",
				},
			],
		};
	}
}

function parseSetting(value: unknown): ShopifySchemaSetting[] {
	if (
		!isRecord(value) ||
		typeof value.id !== "string" ||
		typeof value.type !== "string"
	)
		return [];
	return [
		{
			id: value.id,
			type: value.type,
			...(typeof value.label === "string" ? { label: value.label } : {}),
			...(isProductKeyValue(value.default)
				? { defaultValue: value.default }
				: {}),
		},
	];
}

function parseBlock(value: unknown): { type: string }[] {
	return isRecord(value) && typeof value.type === "string"
		? [{ type: value.type }]
		: [];
}

function metafieldRead(
	file: ProjectFileId,
	fact: SourceFact,
): ShopifyMetafieldRead[] {
	if (fact.kind !== "liquid.read" || !isRecord(fact.data)) return [];
	if (
		typeof fact.data.root !== "string" ||
		!Array.isArray(fact.data.path) ||
		fact.data.path[0] !== "metafields"
	)
		return [];
	const namespace =
		typeof fact.data.path[1] === "string" ? fact.data.path[1] : undefined;
	const key =
		typeof fact.data.path[2] === "string" ? fact.data.path[2] : undefined;
	const dynamic =
		fact.data.hasDynamicPathSegments === true || !namespace || !key;
	return [
		{
			id: `shopify-metafield:${fingerprintProductKey({ file, sourceFact: fact.id })}`,
			owner: file,
			ownerType: fact.data.root,
			...(namespace ? { namespace } : {}),
			...(key ? { key } : {}),
			dynamic,
		},
	];
}

function collectEvidence(
	classification: ShopifyFileClassification,
	schema: ShopifyFileSchema,
	metafields: readonly ShopifyMetafieldRead[],
	behavior: readonly ShopifyBehavior[],
	references: readonly { id: string; static: boolean; referenceKind: string }[],
): ShopifyEvidence[] {
	const records: ShopifyEvidence[] = [
		evidence(classification.file, "file-role", "explicit", {
			role: classification.role,
		}),
	];
	if (schema.settings.length > 0) {
		records.push(
			evidence(classification.file, "schema", "explicit", {
				settings: schema.settings.map((setting) => setting.id),
			}),
		);
	}
	for (const read of metafields) {
		records.push(
			evidence(classification.file, "metafield-read", "explicit", {
				readId: read.id,
				dynamic: read.dynamic,
			}),
		);
	}
	for (const fact of behavior) {
		records.push(
			evidence(classification.file, "behavior", "explicit", {
				factId: fact.id,
			}),
		);
	}
	for (const reference of references) {
		records.push(
			evidence(
				classification.file,
				reference.static ? "render-reference" : "dynamic-reference",
				reference.static ? "explicit" : "inferred",
				{ referenceId: reference.id, kind: reference.referenceKind },
			),
		);
	}
	return records.sort((left, right) => left.id.localeCompare(right.id));
}

function evidence(
	owner: ProjectFileId,
	kind: string,
	strength: ShopifyEvidence["strength"],
	data: ProductKey,
): ShopifyEvidence {
	return {
		id: `shopify-evidence:${fingerprintProductKey({ owner, kind, strength, data })}`,
		owner,
		kind,
		strength,
		data,
	};
}

function evidenceCapability(evidence: ShopifyEvidence): string | undefined {
	if (evidence.kind === "schema") return "shopify.schema";
	if (evidence.kind === "metafield-read") return "shopify.metafields";
	if (evidence.kind === "behavior") return "browser.behavior";
	if (evidence.kind === "render-reference") return "shopify.render";
	if (evidence.kind === "dynamic-reference") return "shopify.dynamic-render";
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProductKeyValue(value: unknown): value is ProductKey {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return true;
	if (typeof value === "number") return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isProductKeyValue);
	return isRecord(value) && Object.values(value).every(isProductKeyValue);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
