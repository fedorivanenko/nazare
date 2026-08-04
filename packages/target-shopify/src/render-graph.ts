import {
	type ComputationGraph,
	defineComputation,
	defineProduct,
	fingerprintProductKey,
	jsonComputationCodec,
	type ProjectFileId,
	serializeProjectFileId,
} from "@nazare/compiler";
import type { Diagnostic } from "@nazare/core";
import {
	type ShopifyDataRead,
	type ShopifyReference,
	shopifyProducts,
} from "./products.js";
import { shopifyResolutionProducts } from "./resolution.js";

export type ShopifyRenderPlan = {
	files: readonly ProjectFileId[];
};

export type ShopifyRenderEdge = {
	id: string;
	from: ProjectFileId;
	to: ProjectFileId;
	referenceId: string;
	kind: string;
};

export type ShopifyRenderScc = {
	id: string;
	nodes: readonly ProjectFileId[];
	edges: readonly ShopifyRenderEdge[];
	cyclic: boolean;
};

export type ShopifyRenderGraph = {
	nodes: readonly ProjectFileId[];
	edges: readonly ShopifyRenderEdge[];
	sccs: readonly ShopifyRenderScc[];
};

export type ShopifySccDataFlowPlan = {
	scc: ShopifyRenderScc;
	maxIterations: number;
	maxWork: number;
};

export type ShopifyFileDataFlow = {
	file: ProjectFileId;
	reads: readonly ShopifyDataRead[];
};

export type ShopifySccDataFlow = {
	sccId: string;
	files: readonly ShopifyFileDataFlow[];
	iterations: number;
	work: number;
	converged: boolean;
	diagnostics: readonly Diagnostic[];
};

export const shopifyGraphProducts = {
	dataReads: defineProduct<ProjectFileId, readonly ShopifyDataRead[]>({
		namespace: "nazare.target.shopify",
		id: "file-data-reads",
		version: 1,
	}),
	renderEdges: defineProduct<
		{ file: ProjectFileId; files: readonly ProjectFileId[] },
		readonly ShopifyRenderEdge[]
	>({
		namespace: "nazare.target.shopify",
		id: "file-render-edges",
		version: 1,
	}),
	renderGraph: defineProduct<ShopifyRenderPlan, ShopifyRenderGraph>({
		namespace: "nazare.target.shopify",
		id: "render-graph",
		version: 1,
	}),
	sccDataFlow: defineProduct<ShopifySccDataFlowPlan, ShopifySccDataFlow>({
		namespace: "nazare.target.shopify",
		id: "scc-data-flow",
		version: 1,
	}),
};

export function registerShopifyGraphComputations(
	graph: ComputationGraph,
): void {
	graph.register(
		defineComputation(
			shopifyGraphProducts.dataReads,
			async (context, file) => {
				const facts = await context.get(shopifyProducts.facts.product(file));
				return facts.facts.filter(
					(fact): fact is ShopifyDataRead => fact.kind === "dataRead",
				);
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyGraphProducts.renderEdges,
			async (context, plan) => {
				const resolutions = await context.get(
					shopifyResolutionProducts.fileResolutions.product(plan),
				);
				return resolutions.flatMap((resolution) =>
					isRenderReference(resolution.reference)
						? resolution.targetFiles.map((target) => ({
								id: `shopify-render-edge:${resolution.reference.id}:${serializeProjectFileId(target)}`,
								from: plan.file,
								to: target,
								referenceId: resolution.reference.id,
								kind: resolution.reference.referenceKind,
							}))
						: [],
				);
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyGraphProducts.renderGraph,
			async (context, plan) => {
				const nodes = [...plan.files].sort(compareFiles);
				const edges = (
					await Promise.all(
						nodes.map((file) =>
							context.get(
								shopifyGraphProducts.renderEdges.product({
									file,
									files: nodes,
								}),
							),
						),
					)
				)
					.flat()
					.sort((left, right) => left.id.localeCompare(right.id));
				return { nodes, edges, sccs: partitionSccs(nodes, edges) };
			},
			{ cache: jsonComputationCodec() },
		),
	);

	graph.register(
		defineComputation(
			shopifyGraphProducts.sccDataFlow,
			async (context, plan) => {
				validateBudget(plan);
				const readsByFile = new Map<string, Map<string, ShopifyDataRead>>();
				for (const file of plan.scc.nodes) {
					const reads = await context.get(
						shopifyGraphProducts.dataReads.product(file),
					);
					readsByFile.set(
						serializeProjectFileId(file),
						new Map(reads.map((read) => [read.id, read])),
					);
				}
				let work = 0;
				for (
					let iteration = 1;
					iteration <= plan.maxIterations;
					iteration += 1
				) {
					let changed = false;
					for (const edge of plan.scc.edges) {
						const source = readsByFile.get(serializeProjectFileId(edge.from));
						const target = readsByFile.get(serializeProjectFileId(edge.to));
						if (!source || !target) continue;
						for (const read of target.values()) {
							work += 1;
							if (work > plan.maxWork) {
								return boundedDataFlow(
									plan,
									readsByFile,
									iteration,
									work,
									"work",
								);
							}
							if (!source.has(read.id)) {
								source.set(read.id, read);
								changed = true;
							}
						}
					}
					if (!changed) {
						return dataFlowResult(
							plan.scc.id,
							plan.scc.nodes,
							readsByFile,
							iteration,
							work,
							true,
							[],
						);
					}
				}
				return boundedDataFlow(
					plan,
					readsByFile,
					plan.maxIterations,
					work,
					"iterations",
				);
			},
			{
				cache: jsonComputationCodec(),
				diagnostics: (result) => result.diagnostics,
			},
		),
	);
}

function partitionSccs(
	nodes: readonly ProjectFileId[],
	edges: readonly ShopifyRenderEdge[],
): ShopifyRenderScc[] {
	const files = new Map(
		nodes.map((file) => [serializeProjectFileId(file), file]),
	);
	const adjacency = new Map<string, string[]>(
		[...files.keys()].map((identity) => [identity, []]),
	);
	for (const edge of edges) {
		const from = serializeProjectFileId(edge.from);
		const to = serializeProjectFileId(edge.to);
		if (adjacency.has(from) && adjacency.has(to)) adjacency.get(from)?.push(to);
	}
	for (const targets of adjacency.values()) targets.sort();
	let nextIndex = 0;
	const indices = new Map<string, number>();
	const lowLinks = new Map<string, number>();
	const stack: string[] = [];
	const onStack = new Set<string>();
	const components: string[][] = [];

	const visit = (node: string): void => {
		indices.set(node, nextIndex);
		lowLinks.set(node, nextIndex);
		nextIndex += 1;
		stack.push(node);
		onStack.add(node);
		for (const target of adjacency.get(node) ?? []) {
			if (!indices.has(target)) {
				visit(target);
				lowLinks.set(
					node,
					Math.min(
						lowLinks.get(node) as number,
						lowLinks.get(target) as number,
					),
				);
			} else if (onStack.has(target)) {
				lowLinks.set(
					node,
					Math.min(lowLinks.get(node) as number, indices.get(target) as number),
				);
			}
		}
		if (lowLinks.get(node) !== indices.get(node)) return;
		const component: string[] = [];
		let member: string | undefined;
		do {
			member = stack.pop();
			if (!member) break;
			onStack.delete(member);
			component.push(member);
		} while (member !== node);
		components.push(component.sort());
	};
	for (const node of [...files.keys()].sort())
		if (!indices.has(node)) visit(node);

	return components
		.map((component) => {
			const identities = new Set(component);
			const componentEdges = edges.filter(
				(edge) =>
					identities.has(serializeProjectFileId(edge.from)) &&
					identities.has(serializeProjectFileId(edge.to)),
			);
			const componentNodes = component.map(
				(identity) => files.get(identity) as ProjectFileId,
			);
			return {
				id: `shopify-scc:${fingerprintProductKey(component)}`,
				nodes: componentNodes,
				edges: componentEdges,
				cyclic:
					component.length > 1 ||
					componentEdges.some(
						(edge) =>
							serializeProjectFileId(edge.from) ===
							serializeProjectFileId(edge.to),
					),
			};
		})
		.sort((left, right) => left.id.localeCompare(right.id));
}

function isRenderReference(reference: ShopifyReference): boolean {
	return [
		"snippet",
		"section",
		"section-group",
		"layout",
		"nazare-render",
	].includes(reference.referenceKind);
}

function validateBudget(plan: ShopifySccDataFlowPlan): void {
	if (!Number.isSafeInteger(plan.maxIterations) || plan.maxIterations < 1) {
		throw new TypeError("Shopify SCC data-flow maxIterations must be positive");
	}
	if (!Number.isSafeInteger(plan.maxWork) || plan.maxWork < 1) {
		throw new TypeError("Shopify SCC data-flow maxWork must be positive");
	}
}

function boundedDataFlow(
	plan: ShopifySccDataFlowPlan,
	reads: ReadonlyMap<string, ReadonlyMap<string, ShopifyDataRead>>,
	iterations: number,
	work: number,
	budget: "iterations" | "work",
): ShopifySccDataFlow {
	return dataFlowResult(
		plan.scc.id,
		plan.scc.nodes,
		reads,
		iterations,
		work,
		false,
		[
			{
				severity: "error",
				code: "SHOPIFY_DATA_FLOW_BUDGET_EXCEEDED",
				message: `Shopify data flow exceeded ${budget} budget in ${plan.scc.id}`,
				phase: "check",
			},
		],
	);
}

function dataFlowResult(
	sccId: string,
	files: readonly ProjectFileId[],
	reads: ReadonlyMap<string, ReadonlyMap<string, ShopifyDataRead>>,
	iterations: number,
	work: number,
	converged: boolean,
	diagnostics: readonly Diagnostic[],
): ShopifySccDataFlow {
	return {
		sccId,
		files: files.map((file) => ({
			file,
			reads: [
				...(reads.get(serializeProjectFileId(file))?.values() ?? []),
			].sort((left, right) => left.id.localeCompare(right.id)),
		})),
		iterations,
		work,
		converged,
		diagnostics,
	};
}

function compareFiles(left: ProjectFileId, right: ProjectFileId): number {
	return serializeProjectFileId(left).localeCompare(
		serializeProjectFileId(right),
	);
}
