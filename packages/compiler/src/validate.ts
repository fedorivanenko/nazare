import type { ArtifactGraph, ArtifactIR, Diagnostic } from "@nazare/core";
import {
	missingEdgeEndpoint,
	propArgumentAmbiguous,
	propBindingNotContractProp,
	propBindingTargetMismatch,
	renderTargetResolutionCount,
} from "./diagnostics.js";
import { indexArtifactIR } from "./ir-index.js";

export function validateArtifactIR(ir: ArtifactIR): Diagnostic[] {
	const index = indexArtifactIR(ir);
	return [
		...validateRenderTargetResolutions(index),
		...validateArgumentBindings(index),
		...validatePropBindingTargets(ir, index),
	];
}

export function validateArtifactGraph(graph: ArtifactGraph): Diagnostic[] {
	return validateGraphEdgeEndpoints(graph);
}

type IRIndex = ReturnType<typeof indexArtifactIR>;

function validateRenderTargetResolutions(index: IRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];

	for (const renderSite of index.nodesOfKind("render-site")) {
		const renderTargets = index.renderTargetsBySiteId.get(renderSite.id) ?? [];
		if (renderTargets.length !== 1) {
			issues.push(
				renderTargetResolutionCount(
					renderSite.id,
					renderTargets.length,
					renderSite.span,
				),
			);
		}
	}

	return issues;
}

function validateArgumentBindings(index: IRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];

	for (const argument of index.nodesOfKind("prop-argument")) {
		const bindings = index.propBindingsByArgumentId.get(argument.id) ?? [];
		if (bindings.length <= 1) continue;

		issues.push(
			propArgumentAmbiguous(argument.id, bindings.length, argument.span),
		);
	}

	return issues;
}

function validatePropBindingTargets(
	ir: ArtifactIR,
	index: IRIndex,
): Diagnostic[] {
	const issues: Diagnostic[] = [];

	for (const binding of ir.resolutions) {
		if (binding.kind !== "prop-binding") continue;

		const [renderTarget] =
			index.renderTargetsBySiteId.get(binding.renderSiteId) ?? [];
		if (!renderTarget) continue;

		if (binding.targetComponentSymbolId !== renderTarget.symbolId) {
			issues.push(
				propBindingTargetMismatch(
					binding.argumentId,
					binding.targetComponentSymbolId,
					renderTarget.symbolId,
				),
			);
		}

		const targetProp = index.symbolById.get(binding.propSymbolId);
		if (
			!targetProp ||
			targetProp.ownerSymbolId !== binding.targetComponentSymbolId ||
			targetProp.resolution !== "external-resolved" ||
			targetProp.source !== "compiled-contract"
		) {
			issues.push(propBindingNotContractProp(binding.argumentId));
		}
	}

	return issues;
}

function validateGraphEdgeEndpoints(graph: ArtifactGraph): Diagnostic[] {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const issues: Diagnostic[] = [];

	for (const edge of graph.edges) {
		if (!nodeIds.has(edge.from)) {
			issues.push(missingEdgeEndpoint(edge.id, "from", edge.from, edge.span));
		}

		if (!nodeIds.has(edge.to)) {
			issues.push(missingEdgeEndpoint(edge.id, "to", edge.to, edge.span));
		}
	}

	return issues;
}
