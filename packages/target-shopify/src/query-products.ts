import {
	type ComputationContext,
	type ComputationGraph,
	defineComputation,
	defineProduct,
	jsonComputationCodec,
	type ProjectFileId,
	serializeProjectFileId,
} from "@nazare/compiler";
import {
	type ShopifyBehavior,
	type ShopifyDeclaration,
	type ShopifyReference,
	shopifyProducts,
} from "./products.js";
import {
	type ShopifyRenderGraph,
	shopifyGraphProducts,
} from "./render-graph.js";
import { shopifyResolutionProducts } from "./resolution.js";
import {
	type ShopifyEvidence,
	type ShopifyFileClassificationResult,
	type ShopifyMetafieldRead,
	shopifySemanticProducts,
} from "./semantic-products.js";

export type ShopifyQueryScope = {
	files: readonly ProjectFileId[];
};

export type ShopifyProjectModelQuery = ShopifyQueryScope;
export type ShopifyProjectGraphQuery = ShopifyQueryScope;

export type ShopifyDependencyIndexQuery = ShopifyQueryScope & {
	target: ProjectFileId | null;
};

export type ShopifyBehaviorIndexQuery = ShopifyQueryScope & {
	behaviorKind: string | null;
};

export type ShopifyMetafieldIndexQuery = ShopifyQueryScope & {
	ownerType: string | null;
	namespace: string | null;
};

export type ShopifyImpactQuery = ShopifyQueryScope & {
	changed: readonly ProjectFileId[];
};

export type ShopifyUnusedFilesQuery = ShopifyQueryScope & {
	roots: readonly ProjectFileId[];
};

export type VersionedShopifyQuery = { version: number };

export type ShopifyProjectModelResult = VersionedShopifyQuery & {
	declarations: readonly ShopifyDeclaration[];
	references: readonly ShopifyReference[];
	classifications: readonly ShopifyFileClassificationResult[];
	evidence: readonly ShopifyEvidence[];
	uncertainty: readonly string[];
};

export type ShopifyProjectGraphResult = VersionedShopifyQuery & {
	graph: ShopifyRenderGraph;
};

export type ShopifyDependencyRecord = {
	id: string;
	from: ProjectFileId;
	to: ProjectFileId;
	referenceId: string;
	kind: string;
};

export type ShopifyDependencyIndexResult = VersionedShopifyQuery & {
	records: readonly ShopifyDependencyRecord[];
	uncertainty: readonly string[];
};

export type ShopifyBehaviorIndexResult = VersionedShopifyQuery & {
	records: readonly ShopifyBehavior[];
	evidence: readonly ShopifyEvidence[];
};

export type ShopifyMetafieldIndexResult = VersionedShopifyQuery & {
	records: readonly ShopifyMetafieldRead[];
	evidence: readonly ShopifyEvidence[];
};

export type ShopifyImpactResult = VersionedShopifyQuery & {
	changed: readonly ProjectFileId[];
	affected: readonly ProjectFileId[];
	reasons: readonly ShopifyDependencyRecord[];
	uncertainty: readonly string[];
};

export type ShopifyAffectedPagesResult = VersionedShopifyQuery & {
	pages: readonly ProjectFileId[];
	impact: ShopifyImpactResult;
};

export type ShopifyUnusedFilesResult = VersionedShopifyQuery & {
	files: readonly ProjectFileId[];
	uncertainty: readonly string[];
};

export const shopifyQueryProducts = {
	projectModel: defineProduct<
		ShopifyProjectModelQuery,
		ShopifyProjectModelResult
	>({
		namespace: "nazare.target.shopify.query",
		id: "project-model",
		version: 1,
	}),
	projectGraph: defineProduct<
		ShopifyProjectGraphQuery,
		ShopifyProjectGraphResult
	>({
		namespace: "nazare.target.shopify.query",
		id: "project-graph",
		version: 1,
	}),
	dependencyIndex: defineProduct<
		ShopifyDependencyIndexQuery,
		ShopifyDependencyIndexResult
	>({
		namespace: "nazare.target.shopify.query",
		id: "dependency-index",
		version: 1,
	}),
	impact: defineProduct<ShopifyImpactQuery, ShopifyImpactResult>({
		namespace: "nazare.target.shopify.query",
		id: "impact",
		version: 1,
	}),
	behaviorIndex: defineProduct<
		ShopifyBehaviorIndexQuery,
		ShopifyBehaviorIndexResult
	>({
		namespace: "nazare.target.shopify.query",
		id: "behavior-index",
		version: 1,
	}),
	metafieldIndex: defineProduct<
		ShopifyMetafieldIndexQuery,
		ShopifyMetafieldIndexResult
	>({
		namespace: "nazare.target.shopify.query",
		id: "metafield-index",
		version: 1,
	}),
	affectedPages: defineProduct<ShopifyImpactQuery, ShopifyAffectedPagesResult>({
		namespace: "nazare.target.shopify.query",
		id: "affected-pages",
		version: 1,
	}),
	unusedFiles: defineProduct<ShopifyUnusedFilesQuery, ShopifyUnusedFilesResult>(
		{
			namespace: "nazare.target.shopify.query",
			id: "unused-files",
			version: 1,
		},
	),
};

export function registerShopifyQueryComputations(
	graph: ComputationGraph,
): void {
	graph.register(
		defineComputation(
			shopifyQueryProducts.projectModel,
			async (context, query) => {
				const records = await Promise.all(
					query.files.map(async (file) => ({
						declarations: await context.get(
							shopifyProducts.declarations.product(file),
						),
						references: await context.get(
							shopifyProducts.references.product(file),
						),
						classification: await context.get(
							shopifySemanticProducts.classification.product(file),
						),
						evidence: await context.get(
							shopifySemanticProducts.evidence.product(file),
						),
					})),
				);
				return {
					version: 1,
					declarations: records.flatMap((record) => record.declarations),
					references: records.flatMap((record) => record.references),
					classifications: records.map((record) => record.classification),
					evidence: records.flatMap((record) => record.evidence),
					uncertainty: records.flatMap(
						(record) => record.classification.uncertainty,
					),
				};
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyQueryProducts.projectGraph,
			async (context, query) => ({
				version: 1,
				graph: await context.get(
					shopifyGraphProducts.renderGraph.product(query),
				),
			}),
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyQueryProducts.dependencyIndex,
			async (context, query) => {
				const result = await dependencyRecords(context, query.files);
				const targetIdentity = query.target
					? serializeProjectFileId(query.target)
					: undefined;
				return {
					version: 1,
					records: targetIdentity
						? result.records.filter(
								(record) =>
									serializeProjectFileId(record.to) === targetIdentity,
							)
						: result.records,
					uncertainty: result.uncertainty,
				};
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyQueryProducts.impact,
			async (context, query) => {
				const dependencies = await dependencyRecords(context, query.files);
				const affected = new Map(
					query.changed.map((file) => [serializeProjectFileId(file), file]),
				);
				const reasons: ShopifyDependencyRecord[] = [];
				let changed = true;
				while (changed) {
					changed = false;
					for (const record of dependencies.records) {
						if (!affected.has(serializeProjectFileId(record.to))) continue;
						const source = serializeProjectFileId(record.from);
						if (affected.has(source)) continue;
						affected.set(source, record.from);
						reasons.push(record);
						changed = true;
					}
				}
				return {
					version: 1,
					changed: [...query.changed].sort(compareFiles),
					affected: [...affected.values()].sort(compareFiles),
					reasons,
					uncertainty: dependencies.uncertainty,
				};
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyQueryProducts.behaviorIndex,
			async (context, query) => {
				const records = (
					await Promise.all(
						query.files.map((file) =>
							context.get(shopifySemanticProducts.behavior.product(file)),
						),
					)
				).flat();
				const filtered = query.behaviorKind
					? records.filter(
							(record) =>
								isRecord(record.data) &&
								record.data.subjectKind === query.behaviorKind,
						)
					: records;
				const evidence = await evidenceForOwners(
					context,
					filtered.map((record) => record.owner),
					"behavior",
				);
				return { version: 1, records: filtered, evidence };
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyQueryProducts.metafieldIndex,
			async (context, query) => {
				const records = (
					await Promise.all(
						query.files.map((file) =>
							context.get(shopifySemanticProducts.metafields.product(file)),
						),
					)
				).flat();
				const filtered = records.filter(
					(record) =>
						(!query.ownerType || record.ownerType === query.ownerType) &&
						(!query.namespace || record.namespace === query.namespace),
				);
				const evidence = await evidenceForOwners(
					context,
					filtered.map((record) => record.owner),
					"metafield-read",
				);
				return { version: 1, records: filtered, evidence };
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyQueryProducts.affectedPages,
			async (context, query) => {
				const impact = await context.get(
					shopifyQueryProducts.impact.product(query),
				);
				const pages: ProjectFileId[] = [];
				for (const file of impact.affected) {
					const classification = await context.get(
						shopifyProducts.classification.product(file),
					);
					if (
						classification.role === "templateJson" ||
						classification.role === "templateLiquid"
					)
						pages.push(file);
				}
				return { version: 1, pages: pages.sort(compareFiles), impact };
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyQueryProducts.unusedFiles,
			async (context, query) => {
				const dependencies = await dependencyRecords(context, query.files);
				const used = new Set([
					...query.roots.map(serializeProjectFileId),
					...dependencies.records.map((record) =>
						serializeProjectFileId(record.to),
					),
				]);
				return {
					version: 1,
					files: query.files
						.filter((file) => !used.has(serializeProjectFileId(file)))
						.sort(compareFiles),
					uncertainty: dependencies.uncertainty,
				};
			},
			{ cache: jsonComputationCodec() },
		),
	);
}

async function dependencyRecords(
	context: ComputationContext,
	files: readonly ProjectFileId[],
): Promise<{
	records: ShopifyDependencyRecord[];
	uncertainty: string[];
}> {
	const resolutions = (
		await Promise.all(
			files.map((file) =>
				context.get(
					shopifyResolutionProducts.fileResolutions.product({ file, files }),
				),
			),
		)
	).flat();
	return {
		records: resolutions
			.flatMap((resolution) =>
				resolution.targetFiles.map((target) => ({
					id: `shopify-dependency:${resolution.reference.id}:${serializeProjectFileId(target)}`,
					from: resolution.reference.owner,
					to: target,
					referenceId: resolution.reference.id,
					kind: resolution.reference.referenceKind,
				})),
			)
			.sort((left, right) => left.id.localeCompare(right.id)),
		uncertainty: resolutions.flatMap((resolution) =>
			resolution.uncertainty.map((boundary) => boundary.message),
		),
	};
}

async function evidenceForOwners(
	context: ComputationContext,
	owners: readonly ProjectFileId[],
	kind: string,
): Promise<ShopifyEvidence[]> {
	const unique = new Map(
		owners.map((owner) => [serializeProjectFileId(owner), owner]),
	);
	return (
		await Promise.all(
			[...unique.values()].map((owner) =>
				context.get(shopifySemanticProducts.evidence.product(owner)),
			),
		)
	)
		.flat()
		.filter((record) => record.kind === kind);
}

function compareFiles(left: ProjectFileId, right: ProjectFileId): number {
	return serializeProjectFileId(left).localeCompare(
		serializeProjectFileId(right),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
