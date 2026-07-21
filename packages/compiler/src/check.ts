// Check pass: judges the IR against imported package contracts — missing
// required props, unknown arguments, type assignability, and value-level
// range constraints. Every diagnostic about *user* code at a render site
// originates here; structural self-invariants live in validate.ts. The
// assignability relation itself lives in assignability.ts.
import type {
	ArtifactContract,
	ArtifactIR,
	ComponentKind,
	Diagnostic,
	ExpressionSyntaxNode,
	Id,
	PropArgumentSyntaxNode,
	RenderSiteSyntaxNode,
	SemanticType,
	SourceSpan,
} from "@nazare/core";
import { isAssignable, literalValueViolation } from "./assignability.js";
import { cssClassTokens } from "./css-modules.js";
import {
	dataChannelFromIR,
	propTypesByExpression,
	resolveDataBinding,
} from "./data-channel.js";
import {
	blocksSlotNotABlock,
	blocksSlotOutsideSection,
	blocksSlotUnknownReference,
	duplicateIsland,
	duplicateRef,
	importBasenameCollision,
	multipleBlocksSlots,
	propTypeMismatch,
	propValueInvalid,
	propValueOutOfRange,
	renderTargetNotSnippet,
	requiredPropMissing,
	scriptModuleSyntaxUnsupported,
	scriptReservedContextShadowed,
	sectionPropWithoutSetting,
	settingTypeUnsupported,
	uncheckedDataBindingType,
	uncheckedPropArgumentType,
	unknownDataAccess,
	unknownIsland,
	unknownPropArgument,
	unknownPropsReference,
	unknownRef,
	unknownStyleClass,
	unresolvedExternalContract,
	unusedDataBinding,
	unusedRef,
	unusedStyleClass,
} from "./diagnostics.js";
import { resolveHoistedSettings } from "./hoist.js";
import { type ArtifactIRIndex, indexArtifactIR } from "./ir-index.js";
import { baseNameOf } from "./paths.js";
import { settingInputFor } from "./schema.js";
import { findUnsupportedModuleSyntax } from "./script-modules.js";
import { findReservedContextShadows } from "./script-scan.js";
import { spanWithinBody } from "./source.js";
import { componentKindFromIR } from "./symbols.js";

export type CompilerMode = "loose" | "strict";

export type CheckArtifactIROptions = {
	/** strict keeps component-author guarantees; loose keeps only contract/build basics. */
	mode?: CompilerMode;
};

export type CheckRule = {
	/** Stable identifier for the rule group. */
	name: string;
	/** Modes this rule runs in. */
	modes: readonly CompilerMode[];
	run: (
		ir: ArtifactIR,
		contracts: ArtifactContract[],
		mode: CompilerMode,
	) => Diagnostic[];
};

/**
 * The single source of truth for what each mode checks. Reading this list
 * answers "what does loose mode do?" — loose keeps the contract and script
 * guarantees a build needs; strict adds component-authoring and css-module
 * linkage. Nothing is checked-then-filtered elsewhere.
 */
export const CHECK_RULES: readonly CheckRule[] = [
	{
		name: "contract-constraints",
		modes: ["loose", "strict"],
		run: (ir, contracts, mode) =>
			checkContractConstraints(ir, contracts, {
				reportUncheckedExpressionTypes: mode === "strict",
			}),
	},
	{
		name: "script-constraints",
		modes: ["loose", "strict"],
		run: (ir) => checkScriptConstraints(ir),
	},
	{
		name: "emit-name-constraints",
		modes: ["loose", "strict"],
		run: (ir) => checkEmitNameConstraints(indexArtifactIR(ir)),
	},
	{
		name: "component-authoring-constraints",
		modes: ["strict"],
		run: (ir, contracts) => checkComponentAuthoringConstraints(ir, contracts),
	},
	{
		name: "style-constraints",
		modes: ["strict"],
		run: (ir) => checkStyleConstraints(ir),
	},
];

export function checkArtifactIR(
	ir: ArtifactIR,
	contracts: ArtifactContract[] = [],
	options: CheckArtifactIROptions = {},
): Diagnostic[] {
	const mode = options.mode ?? "strict";
	return CHECK_RULES.filter((rule) => rule.modes.includes(mode)).flatMap(
		(rule) => rule.run(ir, contracts, mode),
	);
}

export type CheckContractConstraintsOptions = {
	reportUncheckedExpressionTypes: boolean;
};

export function checkContractConstraints(
	ir: ArtifactIR,
	contracts: ArtifactContract[] = [],
	options: CheckContractConstraintsOptions,
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const index = indexArtifactIR(ir);
	const contractsByComponentSymbolId = new Map(
		contracts.map((contract) => [contract.componentSymbolId, contract]),
	);

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

		// Sections and blocks are placed by the theme editor, not rendered.
		if (contract.kind !== "snippet") {
			issues.push(
				renderTargetNotSnippet(
					node.targetName,
					contract.kind,
					node.id,
					node.span,
				),
			);
		}

		issues.push(
			...checkRenderSiteAgainstContract(index, node, contract, options),
		);
	}

	return issues;
}

export function checkComponentAuthoringConstraints(
	ir: ArtifactIR,
	contracts: ArtifactContract[] = [],
): Diagnostic[] {
	const index = indexArtifactIR(ir);
	const kind = componentKindFromIR(ir);
	return [
		...checkRefs(index),
		...checkIslands(index),
		...checkBlocksReferences(index, contracts),
		...checkPropsReferences(index),
		...checkDataChannel(ir, index),
		...checkPropProvenanceForKind(index, kind),
		...checkSettingProjections(index),
		...resolveHoistedSettings(ir, contracts).issues,
	];
}

/**
 * Emitted theme files are named by file basename, so two imported components
 * with the same basename would overwrite each other's emitted snippet and
 * every {% render %} of either would target whichever file emitted last.
 */
function checkEmitNameConstraints(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const firstPathByBaseName = new Map<string, string>();

	for (const node of index.nodesOfKind("import")) {
		const baseName = baseNameOf(node.path);
		const firstPath = firstPathByBaseName.get(baseName);
		if (firstPath === undefined) {
			firstPathByBaseName.set(baseName, node.path);
			continue;
		}
		// The same file imported twice is one emitted file — no clobbering.
		if (firstPath === node.path) continue;
		issues.push(
			importBasenameCollision(
				firstPath,
				node.path,
				baseName,
				node.id,
				node.span,
			),
		);
	}

	return issues;
}

/**
 * Every prop that opted into a setting must have a type the theme editor can
 * input; otherwise schema emission would drop the setting with no trace.
 */
function checkSettingProjections(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];

	for (const prop of index.nodesOfKind("prop-declaration")) {
		if (!prop.typeInfo.setting) continue;
		if (settingInputFor(prop.typeInfo.valueType)) continue;
		issues.push(
			settingTypeUnsupported(
				prop.name,
				prop.typeInfo.valueType.kind,
				prop.id,
				prop.span,
			),
		);
	}

	return issues;
}

export function checkScriptConstraints(ir: ArtifactIR): Diagnostic[] {
	const index = indexArtifactIR(ir);
	return [
		...checkScriptReservedContexts(index),
		...checkScriptModuleSyntax(index),
	];
}

export function checkStyleConstraints(ir: ArtifactIR): Diagnostic[] {
	return checkStyleBindings(indexArtifactIR(ir));
}

/**
 * Css-module linkage, the same guarantee refs give scripts: every
 * {{ styles.x }} read must name a class a bound stylesheet defines, and
 * every defined class must be read somewhere. Unbound stylesheets opt out
 * of the mechanism entirely and are not inspected.
 */
function checkStyleBindings(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const boundStyles = index
		.nodesOfKind("style")
		.filter((style) => style.bindingName !== undefined);
	if (boundStyles.length === 0) return [];

	const definitions = new Map<
		string,
		{
			className: string;
			styleId: Id;
			span: SourceSpan | undefined;
		}
	>();
	for (const style of boundStyles) {
		const bindingName = style.bindingName;
		if (bindingName === undefined) continue;
		for (const token of cssClassTokens(style.source)) {
			const key = `${bindingName}:${token.name}`;
			if (definitions.has(key)) continue;
			definitions.set(key, {
				className: token.name,
				styleId: style.id,
				span: spanWithinBody(style.source, style.bodySpan, token),
			});
		}
	}

	const referenced = new Set<string>();
	for (const reference of index.nodesOfKind("reference")) {
		if (reference.target !== "style") continue;
		const key = `${reference.binding}:${reference.name}`;
		referenced.add(key);
		if (!definitions.has(key)) {
			issues.push(
				unknownStyleClass(
					reference.binding,
					reference.name,
					reference.id,
					reference.span,
				),
			);
		}
	}

	for (const [key, definition] of definitions) {
		if (referenced.has(key)) continue;
		issues.push(
			unusedStyleClass(
				definition.className,
				definition.styleId,
				definition.span,
			),
		);
	}

	return issues;
}

function checkScriptReservedContexts(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];

	for (const script of index.nodesOfKind("script")) {
		for (const shadow of findReservedContextShadows(script.source)) {
			issues.push(
				scriptReservedContextShadowed(
					shadow.name,
					script.id,
					spanWithinBody(script.source, script.bodySpan, shadow),
				),
			);
		}
	}

	return issues;
}

/** Module syntax in behavior scripts that nothing downstream can handle. */
function checkScriptModuleSyntax(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];

	for (const script of index.nodesOfKind("script")) {
		for (const found of findUnsupportedModuleSyntax(script.source)) {
			const span =
				spanWithinBody(script.source, script.bodySpan, found) ?? script.span;
			issues.push(scriptModuleSyntaxUnsupported(found.text, script.id, span));
		}
	}

	return issues;
}

/**
 * Kind-specific rules. Sections and blocks are instantiated by the theme
 * editor and receive no render arguments, so a non-setting prop has no
 * value source — Liquid renders it silently blank. (Setting-props on
 * snippets are fine: they hoist into the consuming section's schema.)
 * The {% blocks %} slot only makes sense in a section, at most once.
 */
function checkPropProvenanceForKind(
	index: ArtifactIRIndex,
	kind: ComponentKind,
): Diagnostic[] {
	const issues: Diagnostic[] = [];

	if (kind === "section" || kind === "block") {
		for (const prop of index.nodesOfKind("prop-declaration")) {
			if (prop.typeInfo.setting) continue;
			issues.push(
				sectionPropWithoutSetting(kind, prop.name, prop.id, prop.span),
			);
		}
	}

	const slots = index.nodesOfKind("blocks-slot");
	if (kind !== "section") {
		for (const slot of slots) {
			issues.push(blocksSlotOutsideSection(slot.id, slot.span));
		}
	}
	for (const slot of slots.slice(1)) {
		issues.push(multipleBlocksSlots(slot.id, slot.span));
	}

	return issues;
}

/**
 * Data-channel linkage: every data.<ref>.<property> read must have a
 * matching data-* binding on that ref; bindings never read warn when a
 * script exists. (Undeclared props inside a binding are located reference
 * nodes, so checkPropsReferences reports those.)
 */
function checkDataChannel(
	ir: ArtifactIR,
	index: ArtifactIRIndex,
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const channel = dataChannelFromIR(ir);
	const readProperties = new Set<string>();
	const scripts = index.nodesOfKind("script");
	const propTypes = propTypesByExpression(ir);

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
			const bindingType = propTypes.get(binding.expression.trim());
			const bindingResolution = resolveDataBinding(
				binding.property,
				bindingType,
			);
			if (!bindingResolution.checked) {
				issues.push(
					uncheckedDataBindingType(
						node.name,
						binding.property,
						binding.expression,
						node.id,
						binding.span,
					),
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

/** Every located props.<name> reference must name a declared prop. */
function checkPropsReferences(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const declared = new Set(
		index.nodesOfKind("prop-declaration").map((node) => node.name),
	);

	for (const reference of index.nodesOfKind("reference")) {
		if (reference.target !== "prop" || declared.has(reference.name)) continue;
		issues.push(
			unknownPropsReference(reference.name, reference.id, reference.span),
		);
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
	// Reading a ref's data channel uses the ref too.
	for (const script of index.nodesOfKind("script")) {
		for (const access of script.dataAccesses ?? []) {
			accessedNames.add(access.ref);
		}
	}
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

/**
 * Blocks-slot linkage: every name in {% blocks A, B %} must be an imported
 * component whose kind is block. Reuses the derived contracts (kind travels
 * on them), so offering a section or snippet as a block is caught here.
 * Unresolved imports are skipped — IMPORT_NOT_FOUND already reported them.
 */
function checkBlocksReferences(
	index: ArtifactIRIndex,
	contracts: ArtifactContract[],
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const slots = index.nodesOfKind("blocks-slot");
	if (slots.length === 0) return [];

	const pathByImportName = new Map(
		index.nodesOfKind("import").map((node) => [node.localName, node.path]),
	);
	const contractByPath = new Map(contracts.map((c) => [c.path, c]));

	for (const slot of slots) {
		for (const name of slot.blockNames) {
			const path = pathByImportName.get(name);
			if (path === undefined) {
				issues.push(blocksSlotUnknownReference(name, slot.id, slot.span));
				continue;
			}
			const contract = contractByPath.get(path);
			if (!contract) continue; // unresolved import, already reported
			if (contract.kind !== "block") {
				issues.push(
					blocksSlotNotABlock(name, contract.kind, slot.id, slot.span),
				);
			}
		}
	}

	return issues;
}

/**
 * Island placement linkage: every island="name" must name an imported
 * behavior (a script with that binding name), and a behavior can be placed
 * at most once — refs are component-global in v1, so a second placement
 * would fight over the same ref elements.
 */
function checkIslands(index: ArtifactIRIndex): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const placements = index.nodesOfKind("island-placement");
	if (placements.length === 0) return [];

	const behaviorNames = new Set(
		index
			.nodesOfKind("script")
			.map((script) => script.bindingName)
			.filter((name): name is string => name !== undefined),
	);
	const seen = new Set<string>();

	for (const placement of placements) {
		if (!behaviorNames.has(placement.name)) {
			issues.push(unknownIsland(placement.name, placement.id, placement.span));
			continue;
		}
		if (seen.has(placement.name)) {
			issues.push(
				duplicateIsland(placement.name, placement.id, placement.span),
			);
			continue;
		}
		seen.add(placement.name);
	}

	return issues;
}

function checkRenderSiteAgainstContract(
	index: ArtifactIRIndex,
	renderSite: RenderSiteSyntaxNode,
	contract: ArtifactContract,
	options: CheckContractConstraintsOptions,
): Diagnostic[] {
	const issues: Diagnostic[] = [];
	const arguments_ = renderSite.argumentIds
		.map((argumentId) => index.nodeById.get(argumentId))
		.filter(
			(node): node is PropArgumentSyntaxNode => node?.kind === "prop-argument",
		);
	const argumentNames = new Set(arguments_.map((argument) => argument.name));

	for (const contractProp of contract.props) {
		if (
			!contractProp.required ||
			contractProp.hasDefault ||
			argumentNames.has(contractProp.name) ||
			// Unfilled setting-props hoist into the consumer's schema.
			contractProp.typeInfo.setting !== undefined
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
		// Explicitly filling a setting the dependency hoisted is the opt-out.
		const contractProp =
			contract.props.find((prop) => prop.name === argument.name) ??
			(contract.hoisted ?? []).find((entry) => entry.name === argument.name);
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
		const expressionType = inferExpressionType(expression, index);
		if (
			options.reportUncheckedExpressionTypes &&
			typeHasUnknown(expressionType) &&
			!typeHasUnknown(contractProp.typeInfo.valueType)
		) {
			issues.push(
				uncheckedPropArgumentType(
					argument.name,
					contractProp.typeInfo.valueType.kind,
					argument.id,
					argument.span,
				),
			);
		}

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

		const literalViolation = literalValueViolation(
			expressionType,
			contractProp.typeInfo.valueType,
		);
		if (literalViolation) {
			if (expressionType?.kind === "number-literal") {
				issues.push(
					propValueOutOfRange(
						argument.name,
						expressionType.value,
						literalViolation,
						argument.id,
						argument.span,
					),
				);
			}
			if (expressionType?.kind === "string-literal") {
				issues.push(
					propValueInvalid(
						argument.name,
						expressionType.value,
						literalViolation,
						argument.id,
						argument.span,
					),
				);
			}
		}
	}

	return issues;
}

function typeHasUnknown(type: SemanticType | undefined): boolean {
	if (!type) return true;
	if (type.kind === "unknown") return true;
	if (type.kind === "union") return type.members.some(typeHasUnknown);
	if (type.kind === "array") return typeHasUnknown(type.element);
	if (type.kind === "function") return typeHasUnknown(type.returns);
	if (type.kind === "object" && type.fields) {
		return Object.values(type.fields).some(typeHasUnknown);
	}
	return false;
}

/**
 * A render argument's type: the syntactic inference for literals, otherwise
 * the symbol the bind pass resolved the expression to (props.x or
 * section.settings.x — the one place that resolution is decided). Anything
 * bind could not resolve is unknown.
 */
function inferExpressionType(
	expression: ExpressionSyntaxNode | undefined,
	index: ArtifactIRIndex,
): SemanticType | undefined {
	if (!expression) return { kind: "unknown" };
	if (expression.inferredType) return expression.inferredType;
	const [reference] =
		index.symbolReferencesByExpressionId.get(expression.id) ?? [];
	const symbol = reference
		? index.symbolById.get(reference.symbolId)
		: undefined;
	return symbol?.semanticType ?? { kind: "unknown" };
}
