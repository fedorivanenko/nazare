import type { ProductKey } from "./canonical-key.js";
import type { CapabilityRegistry } from "./capability.js";
import type { ComputationGraph } from "./graph.js";
import { type ComputationRegistrar, registrarIdentity } from "./registrar.js";

export type NazarePipeline<Source extends ComputationRegistrar> = {
	id: string;
	version: number;
	source: Source;
	transforms: readonly ComputationRegistrar[];
	output: CapabilityRegistry;
};

export function definePipeline<Source extends ComputationRegistrar>(
	pipeline: NazarePipeline<Source>,
): NazarePipeline<Source> {
	registrarIdentity(pipeline);
	assertUniqueContributors(pipeline);
	return Object.freeze({
		...pipeline,
		transforms: Object.freeze([...pipeline.transforms]),
	});
}

export function registerPipelineComputations(
	graph: ComputationGraph,
	pipeline: NazarePipeline<ComputationRegistrar>,
): void {
	pipeline.source.registerComputations(graph);
	for (const transform of pipeline.transforms) {
		transform.registerComputations(graph);
	}
	pipeline.output.registerComputations(graph);
}

export function pipelineIdentity(
	pipeline: NazarePipeline<ComputationRegistrar>,
): ProductKey {
	return {
		id: pipeline.id,
		version: pipeline.version,
		source: registrarIdentity(pipeline.source),
		transforms: pipeline.transforms.map(registrarIdentity),
		output: pipeline.output.identities(),
	};
}

function assertUniqueContributors(
	pipeline: NazarePipeline<ComputationRegistrar>,
): void {
	const seen = new Set<string>();
	for (const registrar of [pipeline.source, ...pipeline.transforms]) {
		const identity = registrarIdentity(registrar);
		if (seen.has(identity)) {
			throw new Error(`Pipeline contributor already registered: ${identity}`);
		}
		seen.add(identity);
	}
}
