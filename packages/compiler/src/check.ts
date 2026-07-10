// Check pass: judges the IR against imported package contracts — missing
// required props, unknown arguments, type assignability, and value-level
// range constraints. Every diagnostic about *user* code at a render site
// originates here; structural self-invariants live in validate.ts. Owns the
// assignability relation between SemanticTypes.
import type {
	ArtifactContract,
	ArtifactIR,
	Diagnostic,
	ExpressionSyntaxNode,
	PropArgumentSyntaxNode,
	RenderSiteSyntaxNode,
	SemanticType,
} from "@nazare/core";
import { dataChannelFromIR } from "./data-channel.js";
import {
	duplicateRef,
	propTypeMismatch,
	propValueOutOfRange,
	requiredPropMissing,
	unknownDataAccess,
	unknownPropArgument,
	unknownPropsReference,
	unknownRef,
	unresolvedExternalContract,
	unusedDataBinding,
	unusedRef,
} from "./diagnostics.js";
import { type ArtifactIRIndex, indexArtifactIR } from "./ir-index.js";

export function checkArtifactIR(
	ir: ArtifactIR,
	contracts: ArtifactContract[] = [],
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const index = indexArtifactIR(ir);
	const contractsByComponentSymbolId = new Map(
		contracts.map((contract) => [contract.componentSymbolId, contract]),
	);
	const settingTypesByName = new Map(
		ir.symbols
			.filter((symbol) => symbol.kind === "setting")
			.map((symbol) => [symbol.name, symbol.semanticType]),
	);
	for (const node of index.nodesOfKind("prop-declaration")) {
		settingTypesByName.set(`props.${node.name}`, node.typeInfo.valueType);
	}

	for (const node of index.nodesOfKind("render-site")) {
		const [renderTarget] = index.renderTargetsBySiteId.get(node.id) ?? [];
		if (!renderTarget) continue;

		const contract = contractsByComponentSymbolId.get(renderTarget.symbolId);
		if (!contract) {
			issues.push(
				unresolvedExternalContract(node.targetName, node.id, node.span),
			);
			continue;
		}

		issues.push(
			...checkRenderSiteAgainstContract(index, node, contract, settingTypesByName),
		);
	}

	issues.push(...checkRefs(index));
	issues.push(...checkPropsReferences(index));
	issues.push(...checkDataChannel(ir, index));

	return issues;
}

/**
 * Data-channel linkage: every data.<ref>.<property> read must have a
 * matching data-* binding on that ref; bindings never read warn when a
 * script exists. Binding expressions are ordinary props reads, so
 * checkPropsReferences does not cover them — undeclared props are caught
 * here through the element-ref bindings themselves.
 */
function checkDataChannel(
	ir: ArtifactIR,
	index: ArtifactIRIndex,
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const channel = dataChannelFromIR(ir);
	const declaredProps = new Set(
		index.nodesOfKind("prop-declaration").map((node) => node.name),
	);
	const readProperties = new Set<string>();
	const scripts = index.nodesOfKind("script");

	for (const script of scripts) {
		for (const access of script.dataAccesses ?? []) {
			readProperties.add(`${access.ref}.${access.property}`);
			if (channel.get(access.ref)?.has(access.property)) continue;
			issues.push(
				unknownDataAccess(access.ref, access.property, script.id, access.span),
			);
		}
	}

	for (const node of index.nodesOfKind("element-ref")) {
		for (const binding of node.dataBindings ?? []) {
			const propsRead = binding.expression.trim().match(/^props\.([\w$]+)$/);
			if (propsRead && !declaredProps.has(propsRead[1])) {
				issues.push(
					unknownPropsReference(propsRead[1], node.id, binding.span),
				);
			}
			if (
				scripts.length > 0 &&
				!readProperties.has(`${node.name}.${binding.property}`)
			) {
				issues.push(
					unusedDataBinding(node.name, binding.property, node.id, binding.span),
				);
			}
		}
	}

	return issues;
}

/** Every props.<name> read in a modeled expression must be declared. */
function checkPropsReferences(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const declared = new Set(
		index.nodesOfKind("prop-declaration").map((node) => node.name),
	);

	for (const expression of index.nodesOfKind("expression")) {
		for (const match of expression.source.matchAll(
			/\bprops\.([A-Za-z_$][\w$]*)/g,
		)) {
			if (declared.has(match[1])) continue;
			issues.push(
				unknownPropsReference(match[1], expression.id, expression.span),
			);
		}
	}

	return issues;
}

/**
 * The ref linkage guarantee: every refs.<name> access in a script resolves
 * to exactly one ref="name" element in the markup, and declared refs are
 * actually used (only warned about when the component has a script at all).
 */
function checkRefs(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const declarations = index.nodesOfKind("element-ref");
	const accesses = index.nodesOfKind("ref-access");
	const declaredNames = new Set(declarations.map((node) => node.name));
	const accessedNames = new Set(accesses.map((node) => node.name));
	const seenNames = new Set<string>();

	for (const declaration of declarations) {
		if (seenNames.has(declaration.name)) {
			issues.push(
				duplicateRef(declaration.name, declaration.id, declaration.span),
			);
			continue;
		}
		seenNames.add(declaration.name);
	}

	for (const access of accesses) {
		if (declaredNames.has(access.name)) continue;
		issues.push(unknownRef(access.name, access.id, access.span));
	}

	const hasScript = index.nodesOfKind("script").length > 0;
	if (hasScript) {
		for (const declaration of declarations) {
			if (accessedNames.has(declaration.name)) continue;
			issues.push(
				unusedRef(declaration.name, declaration.id, declaration.span),
			);
		}
	}

	return issues;
}

function checkRenderSiteAgainstContract(
	index: ArtifactIRIndex,
	renderSite: RenderSiteSyntaxNode,
	contract: ArtifactContract,
	settingTypesByName: Map<string, SemanticType | undefined>,
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const arguments_ = renderSite.argumentIds
		.map((argumentId) => index.nodeById.get(argumentId))
		.filter(
			(node): node is PropArgumentSyntaxNode =>
				node?.kind === "prop-argument",
		);
	const argumentNames = new Set(arguments_.map((argument) => argument.name));

	for (const contractProp of contract.props) {
		if (
			!contractProp.required ||
			contractProp.hasDefault ||
			argumentNames.has(contractProp.name)
		)
			continue;
		issues.push(
			requiredPropMissing(
				renderSite.targetName,
				contractProp.name,
				renderSite.id,
				renderSite.span,
			),
		);
	}

	for (const argument of arguments_) {
		const contractProp = contract.props.find(
			(prop) => prop.name === argument.name,
		);
		if (!contractProp) {
			issues.push(
				unknownPropArgument(
					renderSite.targetName,
					argument.name,
					argument.id,
					argument.span,
				),
			);
			continue;
		}

		const expressionNode = index.nodeById.get(argument.expressionId);
		const expression =
			expressionNode?.kind === "expression"
				? (expressionNode as ExpressionSyntaxNode)
				: undefined;
		const expressionType = inferExpressionType(expression, settingTypesByName);
		if (!isAssignable(expressionType, contractProp.typeInfo.valueType)) {
			issues.push(
				propTypeMismatch(
					argument.name,
					contractProp.typeInfo.valueType.kind,
					expressionType?.kind ?? "unknown",
					argument.id,
					argument.span,
				),
			);
			continue;
		}

		if (expressionType?.kind === "number-literal") {
			const violation = rangeViolation(
				expressionType.value,
				contractProp.typeInfo.valueType,
			);
			if (violation) {
				issues.push(
					propValueOutOfRange(
						argument.name,
						expressionType.value,
						violation,
						argument.id,
						argument.span,
					),
				);
			}
		}
	}

	return issues;
}

function inferExpressionType(
	expression: ExpressionSyntaxNode | undefined,
	settingTypesByName: Map<string, SemanticType | undefined>,
): SemanticType | undefined {
	if (!expression) return { kind: "unknown" };
	if (expression.inferredType) return expression.inferredType;
	return settingTypesByName.get(expression.source.trim()) ?? { kind: "unknown" };
}

/**
 * Checks a known numeric value against the constraints of the target number
 * type. Returns the reason the value is rejected, or undefined when the
 * value is accepted by at least one (possibly unconstrained) number member.
 */
function rangeViolation(
	value: number,
	target: SemanticType,
): string | undefined {
	const numberMembers =
		target.kind === "number"
			? [target]
			: target.kind === "union"
				? target.members.filter((member) => member.kind === "number")
				: [];
	if (numberMembers.length === 0) return undefined;

	let reason: string | undefined;
	for (const member of numberMembers) {
		const constraints = member.constraints;
		if (!constraints) return undefined;
		if (constraints.min !== undefined && value < constraints.min) {
			reason ??= `below minimum ${constraints.min}`;
			continue;
		}
		if (constraints.max !== undefined && value > constraints.max) {
			reason ??= `above maximum ${constraints.max}`;
			continue;
		}
		if (constraints.step !== undefined && constraints.step > 0) {
			const offset = value - (constraints.min ?? 0);
			const remainder = Math.abs(offset % constraints.step);
			if (remainder > 1e-9 && constraints.step - remainder > 1e-9) {
				reason ??= `not aligned to step ${constraints.step}`;
				continue;
			}
		}
		return undefined;
	}

	return reason;
}

function isAssignable(
	from: SemanticType | undefined,
	to: SemanticType | undefined,
): boolean {
	if (!from || !to) return true;
	if (from.kind === "unknown" || to.kind === "unknown") return true;
	if (to.kind === "union") {
		return to.members.some((member) => isAssignable(from, member));
	}
	if (from.kind === "union") {
		return from.members.every((member) => isAssignable(member, to));
	}
	if (from.kind === "string-literal" && to.kind === "string-literal") {
		return from.value === to.value;
	}
	if (from.kind === "number-literal" && to.kind === "number-literal") {
		return from.value === to.value;
	}
	if (from.kind === "string-literal" && to.kind === "string") return true;
	if (from.kind === "number-literal" && to.kind === "number") return true;
	if (from.kind === "literal") return true;
	if (from.kind === "array" && to.kind === "array") {
		return isAssignable(from.element, to.element);
	}
	if (from.kind === "function" && to.kind === "function") {
		return isAssignable(from.returns, to.returns);
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
