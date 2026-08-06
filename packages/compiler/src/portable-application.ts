import type { Diagnostic } from "@nazare/core";
import type { ProductKey } from "./computation/canonical-key.js";
import {
	type Capability,
	type CapabilityProvider,
	defineCapability,
	defineCapabilityProvider,
} from "./computation/capability.js";
import {
	defineComputation,
	productKeyValueCodec,
} from "./computation/computation.js";
import type { ComputationGraph } from "./computation/graph.js";
import {
	defineProduct,
	type Product,
	type ProductDefinition,
} from "./computation/product.js";
import type { ProjectFileId } from "./project/file-id.js";

export type PortableApplicationPlan = {
	files: readonly ProjectFileId[];
	roots: readonly ProjectFileId[];
};

export type PortableComponent = {
	id: string;
	name: string;
	source: ProjectFileId;
	kind: string;
};

export type PortableRenderEdge = {
	id: string;
	from: ProjectFileId;
	to: ProjectFileId;
	kind: string;
};

export type PortableRenderTree = {
	root: ProjectFileId;
	nodes: readonly ProjectFileId[];
	edges: readonly PortableRenderEdge[];
};

export type PortableRoute = {
	id: string;
	path: string;
	source: ProjectFileId;
};

export type PortableContract = {
	id: string;
	owner: ProjectFileId;
	inputs: readonly { name: string; type: string; required: boolean }[];
};

export type PortableDataRequirement = {
	id: string;
	owner: ProjectFileId;
	kind: string;
	data: ProductKey;
};

export type PortableAsset = {
	id: string;
	path: string;
	source: ProjectFileId;
};

export type PortableApplicationModel = {
	components: readonly PortableComponent[];
	renderTrees: readonly PortableRenderTree[];
	routes: readonly PortableRoute[];
	contracts: readonly PortableContract[];
	dataRequirements: readonly PortableDataRequirement[];
	assets: readonly PortableAsset[];
	diagnostics: readonly Diagnostic[];
	uncertainty: readonly { code: string; message: string; file?: string }[];
};

export const portableApplicationModel = defineProduct<
	PortableApplicationPlan,
	PortableApplicationModel
>({
	namespace: "nazare.portable",
	id: "application-model",
	version: 1,
});

export type PortableOutput<Result extends ProductKey = ProductKey> = {
	product(
		plan: PortableApplicationPlan,
	): Product<PortableApplicationPlan, Result>;
};

export const portableOutputCapability: Capability<PortableOutput> =
	defineCapability("nazare.output.portable-application");

export function definePortableOutputProvider<Result extends ProductKey>(input: {
	id: string;
	version: number;
	emit(model: PortableApplicationModel): Promise<Result> | Result;
}): CapabilityProvider<PortableOutput<Result>> {
	const definition: ProductDefinition<PortableApplicationPlan, Result> =
		defineProduct({
			namespace: "nazare.output",
			id: input.id,
			version: input.version,
		});
	const output: PortableOutput<Result> = Object.freeze({
		product: (plan) => definition.product(plan),
	});
	return defineCapabilityProvider({
		capability: portableOutputCapability as unknown as Capability<
			PortableOutput<Result>
		>,
		id: input.id,
		version: input.version,
		value: output,
		registerComputations(graph: ComputationGraph) {
			graph.register(
				defineComputation(
					definition,
					async (context, plan) =>
						input.emit(
							await context.get(portableApplicationModel.product(plan)),
						),
					{ cache: productKeyValueCodec() },
				),
			);
		},
	});
}
