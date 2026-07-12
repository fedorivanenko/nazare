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
		message: `Invalid import: ${markup} — every import binds a name to a relative path: {% import Name from "./name.nz.liquid" %} for components, {% import name from "./name.ts|.js|.css" %} for behaviors and styles`,
		span,
	};
}

export function parseInvalidRender(
	markup: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_PARSE_RENDER",
		message: `Invalid Nazare render: ${markup} — expected {% render Component { prop: expression } %}`,
		span,
	};
}

export function importBareSpecifier(
	specifier: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_IMPORT_BARE_SPECIFIER",
		message: `"${specifier}" is not a relative path. Nazare has no packages at compile time — installing copies files into the project, so import them by relative path (./ or ../)`,
		span,
	};
}

export function importOutsideProject(
	specifier: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_IMPORT_OUTSIDE_PROJECT",
		message: `"${specifier}" resolves outside the project root; imports can only reach files inside the project`,
		span,
	};
}

export function importUnsupportedExtension(
	specifier: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_IMPORT_UNSUPPORTED_EXTENSION",
		message: `Cannot import "${specifier}"; importable files are components (.liquid), behaviors (.ts, .js), and styles (.css)`,
		span,
	};
}

export function importComponentCase(
	localName: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_IMPORT_COMPONENT_CASE",
		message: `Component import names are capitalized: rename ${localName} to ${localName.charAt(0).toUpperCase()}${localName.slice(1)}`,
		span,
	};
}

export function importBindingCase(
	localName: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_IMPORT_BINDING_CASE",
		message: `Behavior and style bindings are lowercase (only components are capitalized): rename ${localName} to ${localName.charAt(0).toLowerCase()}${localName.slice(1)}`,
		span,
	};
}

export function importNotFound(
	path: string,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "IMPORT_NOT_FOUND",
		message: `Imported file "${path}" could not be read`,
		span,
	};
}

export function importCycle(
	path: string,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "IMPORT_CYCLE",
		message: `Import cycle: "${path}" is already being compiled while deriving its contract`,
		span,
	};
}

export function parseInvalidBlocksSlot(
	markup: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_PARSE_BLOCKS_SLOT",
		message: `Invalid blocks slot: ${markup} — expected {% blocks %} or {% blocks Notice, Quote %} (names of imported block components)`,
		span,
	};
}

export function blocksSlotUnknownReference(
	name: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_BLOCKS_SLOT_UNKNOWN_REFERENCE",
		message: `{% blocks %} lists ${name}, but no block component is imported under that name; add {% import ${name} from "./${name.toLowerCase()}.nz.liquid" %}`,
		nodeId,
		span,
	};
}

export function blocksSlotNotABlock(
	name: string,
	kind: "snippet" | "section",
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_BLOCKS_SLOT_NOT_A_BLOCK",
		message: `{% blocks %} accepts only block components, but ${name} is a ${kind}; declare it with {% component block %} or offer it differently`,
		nodeId,
		span,
	};
}

export function parseInvalidComponentKind(
	markup: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_PARSE_COMPONENT_KIND",
		message: `Invalid component kind "${markup}"; expected {% component section %}, {% component block %}, or {% component snippet %} (snippet is also the default when the tag is absent)`,
		span,
	};
}

export function parseDuplicateComponent(span: SourceSpan): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_PARSE_DUPLICATE_COMPONENT",
		message:
			"A file declares its kind at most once; remove the extra {% component %} tag",
		span,
	};
}

export function renderTargetNotSnippet(
	targetName: string,
	kind: "section" | "block",
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_RENDER_TARGET_NOT_SNIPPET",
		message: `${targetName} is a ${kind}, which the theme editor places — it cannot be rendered with {% render %}${kind === "block" ? "; offer it through a {% blocks %} slot instead" : ""}`,
		nodeId,
		span,
	};
}

export function parseInvalidStylesheetBinding(
	markup: string,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_PARSE_STYLESHEET_BINDING",
		message: `Invalid stylesheet binding "${markup}"; expected {% stylesheet %} (unscoped pass-through) or {% stylesheet styles %} (css module)`,
		span,
	};
}

export function unknownStyleClass(
	binding: string,
	className: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_UNKNOWN_STYLE_CLASS",
		message: `{{ ${binding}.${className} }} references class ".${className}" but no bound stylesheet defines it`,
		nodeId,
		span,
	};
}

export function unusedStyleClass(
	className: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "warning",
		code: "CONSTRAINT_UNUSED_STYLE_CLASS",
		message: `Class ".${className}" is defined in a bound stylesheet but never referenced by the markup`,
		nodeId,
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
		severity: "error",
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

export function schemaInvalidJson(
	reason: string,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "NAZARE_SCHEMA_INVALID_JSON",
		message: `The {% schema %} block is not valid JSON: ${reason}`,
		span,
	};
}

export function unknownSettingRead(
	object: "section" | "block",
	settingId: string,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_UNKNOWN_SETTING_READ",
		message: `${object}.settings.${settingId} is read but the schema declares no setting "${settingId}"; it will render blank`,
		span,
	};
}

export function sectionPropWithoutSetting(
	kind: "section" | "block",
	propName: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_SECTION_PROP_NOT_SETTING",
		message: `${kind === "block" ? "Block" : "Section"} components receive no render arguments, so prop ${propName} has no value source; declare it with .setting() or remove it`,
		nodeId,
		span,
	};
}

export function blocksSlotOutsideSection(
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_BLOCKS_SLOT_OUTSIDE_SECTION",
		message:
			"{% blocks %} is only valid in section components; blocks are leaves in v1",
		nodeId,
		span,
	};
}

export function multipleBlocksSlots(
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_MULTIPLE_BLOCKS_SLOTS",
		message:
			"A section can have only one {% blocks %} slot; merge the slots or split the section",
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

export function unknownIsland(
	name: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_UNKNOWN_ISLAND",
		message: `island="${name}" names no imported behavior; import one with {% import ${name} from "./${name}.ts" %}, or remove the attribute`,
		nodeId,
		span,
	};
}

export function duplicateIsland(
	name: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "CONSTRAINT_DUPLICATE_ISLAND",
		message: `behavior "${name}" is placed on more than one element; in v1 refs are component-global, so a behavior mounts on a single subtree`,
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

export function scriptReservedContextShadowed(
	name: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "SCRIPT_RESERVED_CONTEXT_SHADOWED",
		message: `Behavior script declares "${name}", but Nazare reserves that context name for island setup; rename the local binding`,
		nodeId,
		span,
	};
}

export function scriptModuleSyntaxUnsupported(
	statementText: string,
	nodeId: Id,
	span: SourceSpan | undefined,
): Diagnostic {
	return {
		severity: "error",
		code: "SCRIPT_MODULE_SYNTAX_UNSUPPORTED",
		message: `Unsupported module syntax in behavior script: ${statementText}`,
		nodeId,
		span,
	};
}

export function scriptImportNotFound(
	specifier: string,
	importer: string,
): Diagnostic {
	return {
		severity: "error",
		code: "SCRIPT_IMPORT_NOT_FOUND",
		message: `Cannot bundle "${specifier}" imported by ${importer}; the file could not be read`,
	};
}

export function scriptImportInvalid(
	specifier: string,
	importer: string,
): Diagnostic {
	return {
		severity: "error",
		code: "SCRIPT_IMPORT_INVALID",
		message: `Cannot bundle "${specifier}" imported by ${importer}; imports must be relative .ts or .js paths inside the project`,
	};
}

export function scriptImportBare(
	specifier: string,
	importer: string,
): Diagnostic {
	return {
		severity: "error",
		code: "SCRIPT_IMPORT_BARE",
		message: `Cannot bundle "${specifier}" imported by ${importer}; Nazare has no packages at build time — import the file by relative path`,
	};
}

export function scriptImportCycle(
	moduleId: string,
	importer: string,
): Diagnostic {
	return {
		severity: "error",
		code: "SCRIPT_IMPORT_CYCLE",
		message: `Import cycle: ${importer} imports ${moduleId}, which is already loading`,
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

export function emitAmbiguousRoot(
	componentName: string,
	stampedTag: string,
	topLevelCount: number,
): Diagnostic {
	return {
		severity: "warning",
		code: "EMIT_AMBIGUOUS_ROOT_ELEMENT",
		message: `Component ${componentName} has ${topLevelCount} top-level elements; the first (<${stampedTag}>) was stamped data-nz-component, so scripts and scoped styles only reach that subtree — wrap the markup in a single root element or mark one with nz-root`,
	};
}

export function emitMultipleRootMarkers(
	componentName: string,
	markerCount: number,
): Diagnostic {
	return {
		severity: "warning",
		code: "EMIT_MULTIPLE_ROOT_MARKERS",
		message: `Component ${componentName} has ${markerCount} nz-root markers; the first one is used as the runtime root`,
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
