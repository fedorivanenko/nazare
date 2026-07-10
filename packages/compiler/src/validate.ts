import type {
	ArtifactGraph,
	ArtifactIR,
	ArtifactSymbol,
	PropArgumentSyntaxNode,
	RenderSiteSyntaxNode,
	ValidationIssue,
} from "@nazare/core";

export function validateArtifactIR(ir: ArtifactIR): ValidationIssue[] {
	return [
		...ir.diagnostics,
		...validateRenderTargetResolutions(ir),
		...validateArgumentBindings(ir),
		...validatePropBindingTargets(ir),
	];
}

export function validateArtifactGraph(graph: ArtifactGraph): ValidationIssue[] {
	return validateGraphEdgeEndpoints(graph);
}

function validateRenderTargetResolutions(ir: ArtifactIR): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const renderSites = ir.syntax.filter(
		(node): node is RenderSiteSyntaxNode => node.kind === "render-site",
	);

	for (const renderSite of renderSites) {
		const renderTargetResolutions = ir.resolutions.filter(
			(resolution) =>
				resolution.kind === "render-target" &&
				resolution.renderSiteId === renderSite.id,
		);
		if (renderTargetResolutions.length !== 1) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_RENDER_TARGET_RESOLUTION_COUNT",
				message: `Render site ${renderSite.id} must resolve to exactly one component symbol; found ${renderTargetResolutions.length}`,
				nodeId: renderSite.id,
				span: renderSite.span,
			});
		}
	}

	return issues;
}

function validateArgumentBindings(ir: ArtifactIR): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const arguments_ = ir.syntax.filter(
		(node): node is PropArgumentSyntaxNode => node.kind === "prop-argument",
	);

	for (const argument of arguments_) {
		const bindings = ir.resolutions.filter(
			(resolution) =>
				resolution.kind === "prop-binding" &&
				resolution.argumentId === argument.id,
		);
		const hasDiagnostic = ir.diagnostics.some(
			(diagnostic) => diagnostic.nodeId === argument.id,
		);
		const renderHasUnresolvedContractDiagnostic = ir.diagnostics.some(
			(diagnostic) =>
				diagnostic.code === "CONSTRAINT_UNRESOLVED_EXTERNAL_CONTRACT" &&
				diagnostic.nodeId === argument.renderSiteId,
		);
		if (
			bindings.length === 1 ||
			hasDiagnostic ||
			renderHasUnresolvedContractDiagnostic
		) {
			continue;
		}

		issues.push({
			severity: "error",
			code:
				bindings.length > 1
					? "CONSTRAINT_PROP_ARGUMENT_AMBIGUOUS"
					: "CONSTRAINT_PROP_ARGUMENT_UNRESOLVED",
			message: `Prop argument ${argument.id} must have exactly one prop binding or diagnostic; found ${bindings.length}`,
			nodeId: argument.id,
			span: argument.span,
		});
	}

	return issues;
}

function validatePropBindingTargets(ir: ArtifactIR): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const symbolsById = symbolMap(ir.symbols);

	for (const binding of ir.resolutions) {
		if (binding.kind !== "prop-binding") continue;

		const renderTarget = ir.resolutions.find(
			(resolution) =>
				resolution.kind === "render-target" &&
				resolution.renderSiteId === binding.renderSiteId,
		);
		if (renderTarget?.kind !== "render-target") continue;

		if (binding.targetComponentSymbolId !== renderTarget.symbolId) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_PROP_BINDING_TARGET_MISMATCH",
				message: `Prop binding ${binding.argumentId} targets ${binding.targetComponentSymbolId}, but render target is ${renderTarget.symbolId}`,
				nodeId: binding.argumentId,
			});
		}

		const targetProp = symbolsById.get(binding.propSymbolId);
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

function symbolMap(symbols: ArtifactSymbol[]): Map<string, ArtifactSymbol> {
	return new Map(symbols.map((symbol) => [symbol.id, symbol]));
}
