import type { Diagnostic, Id, SourceSpan } from "@nazare/core";

// Every diagnostic the compiler can emit, in one place. Passes call these
// factories instead of inlining severity/code/message at the emit site.

export function parseInvalidImport(
	markup: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_PARSE_IMPORT",
		message: `Invalid Nazare import syntax: ${markup}`,
		span,
	};
}

export function parseInvalidAssetImport(
	path: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_PARSE_ASSET_IMPORT",
		message: `Invalid asset import "${path}"; must be a ./-relative .ts, .js, or .css file inside the component directory`,
		span,
	};
}

export function assetImportNotFound(
	path: string,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "ASSET_IMPORT_NOT_FOUND",
		message: `Imported asset "${path}" could not be read`,
		span,
	};
}

export function parseMalformedPropDeclaration(
	entry: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_PARSE_PROP_DECLARATION",
		message: `Malformed prop declaration "${entry}"; expected "name: typeExpression"`,
		span,
	};
}

export function parseInvalidTypeExpression(
	propName: string,
	reason: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "warning",
		code: "NAZARE_PARSE_TYPE_EXPRESSION",
		message: `Could not parse type expression for prop ${propName}: ${reason}`,
		span,
	};
}

export function parseInvalidRefAttribute(
	reason: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "warning",
		code: "NAZARE_PARSE_REF_ATTRIBUTE",
		message: `Ignored ref attribute: ${reason}`,
		span,
	};
}

export function sectionPropWithoutSetting(
	propName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_SECTION_PROP_NOT_SETTING",
		message: `Section components receive no render arguments, so prop ${propName} has no value source; declare it with .setting() or remove it`,
		nodeId,
		span,
	};
}

export function hoistedAliasReused(
	alias: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_HOISTED_ALIAS_REUSED",
		message: `${alias} is rendered more than once with unfilled settings; each instance needs its own knobs — import the package again under a second alias, or fill the arguments explicitly`,
		nodeId,
		span,
	};
}

export function hoistedSettingCollision(
	settingId: string,
	owner: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_HOISTED_SETTING_COLLISION",
		message: `Hoisted setting id "${settingId}" collides with ${owner}; rename the import alias or the prop`,
		nodeId,
		span,
	};
}

export function unknownPropsReference(
	propName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_UNKNOWN_PROPS_REFERENCE",
		message: `Expression references props.${propName} but no prop ${propName} is declared`,
		nodeId,
		span,
	};
}

export function unknownRef(
	refName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_UNKNOWN_REF",
		message: `Script references ref "${refName}" but no element in the markup declares ref="${refName}"`,
		nodeId,
		span,
	};
}

export function duplicateRef(
	refName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_DUPLICATE_REF",
		message: `ref="${refName}" is declared by more than one element; refs must be unique within a component`,
		nodeId,
		span,
	};
}

export function unknownDataAccess(
	refName: string,
	property: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_UNKNOWN_DATA_ACCESS",
		message: `Script reads data.${refName}.${property} but no data-* binding for it exists on ref "${refName}"`,
		nodeId,
		span,
	};
}

export function unusedDataBinding(
	refName: string,
	property: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "warning",
		code: "CONSTRAINT_UNUSED_DATA_BINDING",
		message: `data binding "${property}" on ref "${refName}" is never read by the component's script`,
		nodeId,
		span,
	};
}

export function unusedRef(
	refName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "warning",
		code: "CONSTRAINT_UNUSED_REF",
		message: `ref="${refName}" is never accessed by the component's script`,
		nodeId,
		span,
	};
}

export function controlFlowNotLowered(span: SourceSpan): Diagnostic {
	return {
		severity: "warning",
		code: "IR_PARTIAL_LOWERING_CONTROL_FLOW",
		message:
			"Control-flow omission means render-site reachability is incomplete; syntax is preserved in LiquidHTML AST",
		span,
	};
}

export function htmlNotPromoted(span: SourceSpan): Diagnostic {
	return {
		severity: "info",
		code: "IR_NODE_NOT_PROMOTED_HTML",
		message:
			"HTML elements are not promoted to ArtifactIR in v0; syntax is preserved in LiquidHTML AST",
		span,
	};
}

export function contractResolutionFailed(
	packageId: string,
	reason: string,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "warning",
		code: "CONTRACT_RESOLUTION_FAILED",
		message: `Failed to resolve contract for ${packageId}: ${reason}`,
		span,
	};
}

export function unresolvedExternalContract(
	targetName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "warning",
		code: "CONSTRAINT_UNRESOLVED_EXTERNAL_CONTRACT",
		message: `Cannot validate props for render target ${targetName}; contract not loaded`,
		nodeId,
		span,
	};
}

export function requiredPropMissing(
	targetName: string,
	propName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_REQUIRED_PROP_MISSING",
		message: `Render target ${targetName} requires prop ${propName}`,
		nodeId,
		span,
	};
}

export function unknownPropArgument(
	targetName: string,
	argumentName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_UNKNOWN_PROP_ARGUMENT",
		message: `Render target ${targetName} has no prop ${argumentName}`,
		nodeId,
		span,
	};
}

export function propTypeMismatch(
	argumentName: string,
	expectedKind: string,
	receivedKind: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_PROP_TYPE_MISMATCH",
		message: `Prop ${argumentName} expects ${expectedKind} but received ${receivedKind}`,
		nodeId,
		span,
	};
}

export function propValueOutOfRange(
	argumentName: string,
	value: number,
	reason: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_PROP_VALUE_OUT_OF_RANGE",
		message: `Prop ${argumentName} value ${value} is ${reason}`,
		nodeId,
		span,
	};
}

export function scriptTypeError(
	message: string,
	tsCode: number,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "SCRIPT_TYPE_ERROR",
		message: `TS${tsCode}: ${message}`,
		span,
	};
}

export function emitScriptWithoutRoot(componentName: string): Diagnostic {
	return {
		severity: "warning",
		code: "EMIT_SCRIPT_WITHOUT_ROOT_ELEMENT",
		message: `Component ${componentName} has a script but no top-level HTML element to mount it on; the script will never run`,
	};
}

export function emitScriptWithoutDefaultExport(
	componentName: string,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "warning",
		code: "EMIT_SCRIPT_WITHOUT_DEFAULT_EXPORT",
		message: `Script in ${componentName} has no "export default island(...)"; nothing will be registered`,
		span,
	};
}

export function renderTargetResolutionCount(
	renderSiteId: Id,
	found: number,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_RENDER_TARGET_RESOLUTION_COUNT",
		message: `Render site ${renderSiteId} must resolve to exactly one component symbol; found ${found}`,
		nodeId: renderSiteId,
		span,
	};
}

export function propArgumentAmbiguous(
	argumentId: Id,
	found: number,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_PROP_ARGUMENT_AMBIGUOUS",
		message: `Prop argument ${argumentId} must have at most one prop binding; found ${found}`,
		nodeId: argumentId,
		span,
	};
}

export function propBindingTargetMismatch(
	argumentId: Id,
	boundTargetId: Id,
	renderTargetId: Id,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_PROP_BINDING_TARGET_MISMATCH",
		message: `Prop binding ${argumentId} targets ${boundTargetId}, but render target is ${renderTargetId}`,
		nodeId: argumentId,
	};
}

export function propBindingNotContractProp(argumentId: Id): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_PROP_BINDING_TARGET_NOT_CONTRACT_PROP",
		message: `Prop binding ${argumentId} does not target a resolved contract prop`,
		nodeId: argumentId,
	};
}

export function missingEdgeEndpoint(
	edgeId: Id,
	endpoint: "from" | "to",
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code:
			endpoint === "from"
				? "CONSTRAINT_MISSING_FROM_NODE"
				: "CONSTRAINT_MISSING_TO_NODE",
		message: `Edge ${edgeId} references missing ${endpoint} node ${nodeId}`,
		edgeId,
		span,
	};
}
