import type {
	ArtifactContract,
	ArtifactIR,
	ExpressionSyntaxNode,
	Id,
	PropArgumentSyntaxNode,
	RenderSiteSyntaxNode,
	SemanticType,
	ValidationIssue,
} from "@nazare/core";

export function checkArtifactIR(
	ir: ArtifactIR,
	contracts: ArtifactContract[] = [],
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const contractsByComponentSymbolId = new Map(
		contracts.map((contract) => [contract.componentSymbolId, contract]),
	);
	const settingTypesByName = new Map(
		ir.symbols
			.filter((symbol) => symbol.kind === "setting")
			.map((symbol) => [symbol.name, symbol.semanticType]),
	);
	const renderTargetsBySiteId = new Map<Id, Id>();
	for (const resolution of ir.resolutions) {
		if (resolution.kind === "render-target") {
			renderTargetsBySiteId.set(resolution.renderSiteId, resolution.symbolId);
		}
	}

	for (const node of ir.syntax) {
		if (node.kind !== "render-site") continue;

		const targetSymbolId = renderTargetsBySiteId.get(node.id);
		if (!targetSymbolId) continue;

		const contract = contractsByComponentSymbolId.get(targetSymbolId);
		if (!contract) {
			issues.push({
				severity: "warning",
				code: "CONSTRAINT_UNRESOLVED_EXTERNAL_CONTRACT",
				message: `Cannot validate props for render target ${node.targetName}; contract not loaded`,
				nodeId: node.id,
				span: node.span,
			});
			continue;
		}

		issues.push(
			...checkRenderSiteAgainstContract(
				ir,
				node,
				contract,
				settingTypesByName,
			),
		);
	}

	return issues;
}

function checkRenderSiteAgainstContract(
	ir: ArtifactIR,
	renderSite: RenderSiteSyntaxNode,
	contract: ArtifactContract,
	settingTypesByName: Map<string, SemanticType | undefined>,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const arguments_ = argumentsForRender(ir, renderSite);
	const argumentNames = new Set(arguments_.map((argument) => argument.name));

	for (const contractProp of contract.props) {
		if (
			!contractProp.required ||
			contractProp.hasDefault ||
			argumentNames.has(contractProp.name)
		)
			continue;
		issues.push({
			severity: "error",
			code: "CONSTRAINT_REQUIRED_PROP_MISSING",
			message: `Render target ${renderSite.targetName} requires prop ${contractProp.name}`,
			nodeId: renderSite.id,
			span: renderSite.span,
		});
	}

	for (const argument of arguments_) {
		const contractProp = contract.props.find(
			(prop) => prop.name === argument.name,
		);
		if (!contractProp) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_UNKNOWN_PROP_ARGUMENT",
				message: `Render target ${renderSite.targetName} has no prop ${argument.name}`,
				nodeId: argument.id,
				span: argument.span,
			});
			continue;
		}

		const expression = expressionForArgument(ir, argument);
		const expressionType = inferExpressionType(expression, settingTypesByName);
		if (!isAssignable(expressionType, contractProp.typeInfo.valueType)) {
			issues.push({
				severity: "error",
				code: "CONSTRAINT_PROP_TYPE_MISMATCH",
				message: `Prop ${argument.name} expects ${contractProp.typeInfo.valueType.kind} but received ${expressionType?.kind ?? "unknown"}`,
				nodeId: argument.id,
				span: argument.span,
			});
		}
	}

	return issues;
}

function argumentsForRender(
	ir: ArtifactIR,
	renderSite: RenderSiteSyntaxNode,
): PropArgumentSyntaxNode[] {
	const argumentIds = new Set(renderSite.argumentIds);
	return ir.syntax.filter(
		(node): node is PropArgumentSyntaxNode =>
			node.kind === "prop-argument" && argumentIds.has(node.id),
	);
}

function expressionForArgument(
	ir: ArtifactIR,
	argument: PropArgumentSyntaxNode,
): ExpressionSyntaxNode | undefined {
	return ir.syntax.find(
		(node): node is ExpressionSyntaxNode =>
			node.kind === "expression" && node.id === argument.expressionId,
	);
}

function inferExpressionType(
	expression: ExpressionSyntaxNode | undefined,
	settingTypesByName: Map<string, SemanticType | undefined>,
): SemanticType | undefined {
	if (!expression) return { kind: "unknown" };
	if (expression.inferredType) return expression.inferredType;
	return (
		settingTypesByName.get(expression.source.trim()) ?? { kind: "unknown" }
	);
}

function isAssignable(
	from: SemanticType | undefined,
	to: SemanticType | undefined,
): boolean {
	if (!from || !to) return true;
	if (from.kind === "unknown" || to.kind === "unknown") return true;
	if (from.kind === "string-literal" && to.kind === "string") return true;
	if (from.kind === "number-literal" && to.kind === "number") return true;
	if (from.kind === "literal") return true;
	if (from.kind === "array" && to.kind === "array") {
		return isAssignable(from.element, to.element);
	}
	if (from.kind === "object" && to.kind === "object") {
		return isObjectAssignable(from, to);
	}
	return from.kind === to.kind;
}

function isObjectAssignable(
	from: Extract<SemanticType, { kind: "object" }>,
	to: Extract<SemanticType, { kind: "object" }>,
): boolean {
	if (from.name && to.name) return from.name === to.name;
	if (!to.fields) return true;
	if (!from.fields) return false;
	return Object.entries(to.fields).every(([fieldName, fieldType]) =>
		isAssignable(from.fields?.[fieldName], fieldType),
	);
}
