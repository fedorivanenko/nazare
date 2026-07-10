import type {
	ArtifactGraph,
	ArtifactIR,
	ValidationIssue,
} from "@nazare/core";
import { indexArtifactIR } from "./ir-index.js";

export function validateArtifactIR(ir: ArtifactIR): ValidationIssue[] {
	const index = indexArtifactIR(ir);
	return [
		...ir.diagnostics,
		...validateRenderTargetResolutions(index),
		...validateArgumentBindings(index),
		...validatePropBindingTargets(ir, index),
	];
}

export function validateArtifactGraph(graph: ArtifactGraph): ValidationIssue[] {
	return validateGraphEdgeEndpoints(graph);
}

type IRIndex = ReturnType<typeof indexArtifactIR>;

function validateRenderTargetResolutions(index: IRIndex): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const renderSite of index.nodesOfKind("render-site")) {
		const renderTargets = index.renderTargetsBySiteId.get(renderSite.id) ?? [];
		if (renderTargets.length !== 1) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_RENDER_TARGET_RESOLUTION_COUNT",
				message: `Render site ${renderSite.id} must resolve to exactly one component symbol; found ${renderTargets.length}`,
				nodeId: renderSite.id,
				span: renderSite.span,
			});
		}
	}

	return issues;
}

function validateArgumentBindings(index: IRIndex): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const argument of index.nodesOfKind("prop-argument")) {
		const bindings = index.propBindingsByArgumentId.get(argument.id) ?? [];
		if (bindings.length <= 1) continue;

		issues.push({
			severity: "error",
			code: "CONSTRAINT_PROP_ARGUMENT_AMBIGUOUS",
			message: `Prop argument ${argument.id} must have at most one prop binding; found ${bindings.length}`,
			nodeId: argument.id,
			span: argument.span,
		});
	}

	return issues;
}

function validatePropBindingTargets(
	ir: ArtifactIR,
	index: IRIndex,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	for (const binding of ir.resolutions) {
		if (binding.kind !== "prop-binding") continue;

		const [renderTarget] =
			index.renderTargetsBySiteId.get(binding.renderSiteId) ?? [];
		if (!renderTarget) continue;

		if (binding.targetComponentSymbolId !== renderTarget.symbolId) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_PROP_BINDING_TARGET_MISMATCH",
				message: `Prop binding ${binding.argumentId} targets ${binding.targetComponentSymbolId}, but render target is ${renderTarget.symbolId}`,
				nodeId: binding.argumentId,
			});
		}

		const targetProp = index.symbolById.get(binding.propSymbolId);
		if (
			!targetProp ||
			targetProp.ownerSymbolId !== binding.targetComponentSymbolId ||
			targetProp.resolution !== "external-resolved" ||
			targetProp.source !== "compiled-contract"
		) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_PROP_BINDING_TARGET_NOT_CONTRACT_PROP",
				message: `Prop binding ${binding.argumentId} does not target a resolved contract prop`,
				nodeId: binding.argumentId,
			});
		}
	}

	return issues;
}

function validateGraphEdgeEndpoints(graph: ArtifactGraph): ValidationIssue[] {
	const nodeIds = new Set(graph.nodes.map((node) => node.id));
	const issues: ValidationIssue[] = [];

	for (const edge of graph.edges) {
		if (!nodeIds.has(edge.from)) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_MISSING_FROM_NODE",
				message: `Edge ${edge.id} references missing from node ${edge.from}`,
				edgeId: edge.id,
				span: edge.span,
			});
		}

		if (!nodeIds.has(edge.to)) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_MISSING_TO_NODE",
				message: `Edge ${edge.id} references missing to node ${edge.to}`,
				edgeId: edge.id,
				span: edge.span,
			});
		}
	}

	return issues;
}
