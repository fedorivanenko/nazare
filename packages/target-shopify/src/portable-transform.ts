import {
	type ComputationGraph,
	type ComputationRegistrar,
	defineComputation,
	defineComputationRegistrar,
	fingerprintProductKey,
	productKeyCodec,
} from "@nazare/compiler/computation";
import {
	type PortableApplicationModel,
	type PortableApplicationPlan,
	type PortableRenderEdge,
	type PortableRenderTree,
	portableApplicationModel,
} from "@nazare/compiler/portable";
import {
	type ProjectFileId,
	serializeProjectFileId,
} from "@nazare/compiler/project";
import {
	type ParsedSourceFile,
	sourceProducts,
} from "@nazare/compiler/source-products";
import {
	type ShopifyDeclaration,
	type ShopifyFileClassification,
	shopifyProducts,
} from "./products.js";
import {
	type ShopifyRenderGraph,
	shopifyGraphProducts,
} from "./render-graph.js";
import {
	type ShopifyFileSchema,
	type ShopifyMetafieldRead,
	shopifySemanticProducts,
} from "./semantic-products.js";

type PortableRecord = {
	file: ProjectFileId;
	classification: ShopifyFileClassification;
	declarations: readonly ShopifyDeclaration[];
	schema: ShopifyFileSchema;
	metafields: readonly ShopifyMetafieldRead[];
	parsed: ParsedSourceFile;
};

export function shopifyPortableTransform(): ComputationRegistrar {
	return defineComputationRegistrar(
		{ id: "nazare.transform.shopify-portable", version: 1 },
		registerShopifyPortableTransform,
	);
}

export function registerShopifyPortableTransform(
	graph: ComputationGraph,
): void {
	graph.register(
		defineComputation(
			portableApplicationModel,
			async (context, plan) => {
				const files = [...plan.files].sort(compareFiles);
				const renderGraph = await context.get(
					shopifyGraphProducts.renderGraph.product({ files }),
				);
				const records = await Promise.all(
					files.map(async (file) => {
						const [classification, declarations, schema, metafields, parsed] =
							await Promise.all([
								context.get(shopifyProducts.classification.product(file)),
								context.get(shopifyProducts.declarations.product(file)),
								context.get(shopifySemanticProducts.schema.product(file)),
								context.get(shopifySemanticProducts.metafields.product(file)),
								context.get(sourceProducts.parsed.product(file)),
							]);
						return {
							file,
							classification,
							declarations,
							schema,
							metafields,
							parsed,
						};
					}),
				);
				return portableModel(plan, renderGraph, records);
			},
			{
				cache: productKeyCodec(),
				diagnostics: (model) => model.diagnostics,
				uncertainty: (model) => model.uncertainty,
			},
		),
	);
}

function portableModel(
	plan: PortableApplicationPlan,
	renderGraph: ShopifyRenderGraph,
	records: readonly PortableRecord[],
): PortableApplicationModel {
	return {
		components: records.flatMap((record) =>
			record.declarations.flatMap((declaration) =>
				[
					"section",
					"snippet",
					"themeBlock",
					"component",
					"nazareComponent",
				].includes(declaration.role)
					? [
							{
								id: declaration.id,
								name: declaration.name,
								source: record.file,
								kind: declaration.role,
							},
						]
					: [],
			),
		),
		renderTrees: plan.roots.map((root) => renderTree(root, renderGraph)),
		routes: records.flatMap((record) =>
			record.classification.role === "templateJson" ||
			record.classification.role === "templateLiquid"
				? [
						{
							id: `portable-route:${fingerprintProductKey(record.file)}`,
							path: templateRoute(record.file.path),
							source: record.file,
						},
					]
				: [],
		),
		contracts: records.flatMap((record) =>
			record.schema.settings.length > 0
				? [
						{
							id: `portable-contract:${fingerprintProductKey(record.file)}`,
							owner: record.file,
							inputs: record.schema.settings.map((setting) => ({
								name: setting.id,
								type: setting.type,
								required: false,
							})),
						},
					]
				: [],
		),
		dataRequirements: records.flatMap((record) =>
			record.metafields.map((read) => ({
				id: `portable-data:${read.id}`,
				owner: record.file,
				kind: "metafield",
				data: {
					ownerType: read.ownerType,
					...(read.namespace ? { namespace: read.namespace } : {}),
					...(read.key ? { key: read.key } : {}),
					dynamic: read.dynamic,
				},
			})),
		),
		assets: records.flatMap((record) =>
			record.classification.role === "asset"
				? [
						{
							id: `portable-asset:${fingerprintProductKey(record.file)}`,
							path: record.file.path,
							source: record.file,
						},
					]
				: [],
		),
		diagnostics: records.flatMap((record) => [
			...record.parsed.diagnostics,
			...record.schema.diagnostics,
		]),
		uncertainty: records.flatMap((record) =>
			record.parsed.uncertainty.map((boundary) => ({
				code: boundary.code,
				message: boundary.message,
				file: record.file.path,
			})),
		),
	};
}

function renderTree(
	root: ProjectFileId,
	graph: ShopifyRenderGraph,
): PortableRenderTree {
	const visited = new Map<string, ProjectFileId>();
	const edges: PortableRenderEdge[] = [];
	const pending = [root];
	while (pending.length > 0) {
		const file = pending.pop();
		if (!file) continue;
		const identity = serializeProjectFileId(file);
		if (visited.has(identity)) continue;
		visited.set(identity, file);
		for (const edge of graph.edges.filter(
			(candidate) => serializeProjectFileId(candidate.from) === identity,
		)) {
			edges.push({
				id: edge.id,
				from: edge.from,
				to: edge.to,
				kind: edge.kind,
			});
			pending.push(edge.to);
		}
	}
	return {
		root,
		nodes: [...visited.values()].sort(compareFiles),
		edges: edges.sort((left, right) => left.id.localeCompare(right.id)),
	};
}

function templateRoute(path: string): string {
	const name = path
		.replace(/^templates\//, "")
		.replace(/\.(?:json|liquid)$/, "");
	return name === "index" ? "/" : `/${name}`;
}

function compareFiles(left: ProjectFileId, right: ProjectFileId): number {
	return serializeProjectFileId(left).localeCompare(
		serializeProjectFileId(right),
	);
}
