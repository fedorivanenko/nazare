import type {
	ArtifactObject,
	ArtifactSemanticGraph,
	ValidationIssue,
} from "@nazare/core";

export function validateArtifactGraph(
	graph: ArtifactSemanticGraph,
): ValidationIssue[] {
	return [
		...validateMorphismEndpoints(graph),
		...validateRenderSites(graph),
		...validatePassesPropOrigins(graph),
		...validateExpectsPropOrigins(graph),
	];
}

function validateMorphismEndpoints(
	graph: ArtifactSemanticGraph,
): ValidationIssue[] {
	const objectIds = new Set(graph.objects.map((object) => object.id));
	const issues: ValidationIssue[] = [];

	for (const morphism of graph.morphisms) {
		if (!objectIds.has(morphism.from)) {
			issues.push({
				severity: "error",
				code: "SIGMA_MISSING_FROM_OBJECT",
				message: `Morphism ${morphism.id} references missing from object ${morphism.from}`,
				morphismId: morphism.id,
				span: morphism.span,
			});
		}

		if (!objectIds.has(morphism.to)) {
			issues.push({
				severity: "error",
				code: "SIGMA_MISSING_TO_OBJECT",
				message: `Morphism ${morphism.id} references missing to object ${morphism.to}`,
				morphismId: morphism.id,
				span: morphism.span,
			});
		}
	}

	return issues;
}

function validateRenderSites(graph: ArtifactSemanticGraph): ValidationIssue[] {
	const renderSites = graph.objects.filter(
		(object) => object.kind === "render-site",
	);
	const issues: ValidationIssue[] = [];

	for (const renderSite of renderSites) {
		const rendersEdges = graph.morphisms.filter(
			(morphism) =>
				morphism.kind === "renders" && morphism.from === renderSite.id,
		);
		if (rendersEdges.length !== 1) {
			issues.push({
				severity: "error",
				code: "SIGMA_RENDER_SITE_RENDERS_COUNT",
				message: `Render site ${renderSite.id} must have exactly one renders edge; found ${rendersEdges.length}`,
				objectId: renderSite.id,
				span: renderSite.span,
			});
		}
	}

	return issues;
}

function validatePassesPropOrigins(
	graph: ArtifactSemanticGraph,
): ValidationIssue[] {
	const objectsById = objectMap(graph.objects);
	const issues: ValidationIssue[] = [];

	for (const morphism of graph.morphisms) {
		if (morphism.kind !== "passes-prop") continue;

		const fromObject = objectsById.get(morphism.from);
		if (fromObject?.kind !== "render-site") {
			issues.push({
				severity: "error",
				code: "SIGMA_PASSES_PROP_ORIGIN",
				message: `passes-prop morphism ${morphism.id} must originate from render-site`,
				morphismId: morphism.id,
				span: morphism.span,
			});
		}
	}

	return issues;
}

function validateExpectsPropOrigins(
	graph: ArtifactSemanticGraph,
): ValidationIssue[] {
	const objectsById = objectMap(graph.objects);
	const allowedKinds = new Set([
		"component",
		"section",
		"snippet",
		"props-interface",
	]);
	const issues: ValidationIssue[] = [];

	for (const morphism of graph.morphisms) {
		if (morphism.kind !== "expects-prop") continue;

		const fromObject = objectsById.get(morphism.from);
		if (!fromObject || !allowedKinds.has(fromObject.kind)) {
			issues.push({
				severity: "error",
				code: "SIGMA_EXPECTS_PROP_ORIGIN",
				message: `expects-prop morphism ${morphism.id} must originate from component, section, snippet, or props-interface`,
				morphismId: morphism.id,
				span: morphism.span,
			});
		}
	}

	return issues;
}

function objectMap(objects: ArtifactObject[]): Map<string, ArtifactObject> {
	return new Map(objects.map((object) => [object.id, object]));
}
