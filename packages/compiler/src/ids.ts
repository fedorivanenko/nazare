import type { Id } from "@nazare/core";

// Single owner of every artifact-layer ID format (syntax and symbol layers).
// Theme-graph IDs are the other namespace and live in theme-model.ts. IDs are
// opaque outside their owning module: construct them there, never parse data
// back out of one.

// Syntax layer

export function fileSyntaxId(file: string): Id {
	return `syntax:file:${file}`;
}

export function componentSyntaxId(file: string): Id {
	return `syntax:component:${file}`;
}

export function propsInterfaceSyntaxId(file: string): Id {
	return `syntax:props-interface:${file}`;
}

export function propDeclarationSyntaxId(
	file: string,
	name: string,
	index: number,
): Id {
	return `syntax:prop-declaration:${file}:${index}:${name}`;
}

export function importSyntaxId(
	file: string,
	localName: string,
	index: number,
): Id {
	return `syntax:import:${file}:${index}:${localName}`;
}

export function renderSiteSyntaxId(file: string, renderIndex: number): Id {
	return `syntax:render-site:${file}:${renderIndex}`;
}

export function referenceSyntaxId(file: string, index: number): Id {
	return `syntax:reference:${file}:${index}`;
}

export function argumentExpressionSyntaxId(
	file: string,
	renderIndex: number,
	argumentIndex: number,
	propName: string,
): Id {
	return `syntax:expression:${file}:${renderIndex}:${argumentIndex}:${propName}`;
}

export function propArgumentSyntaxId(
	file: string,
	renderIndex: number,
	argumentIndex: number,
	propName: string,
): Id {
	return `syntax:prop-argument:${file}:${renderIndex}:${argumentIndex}:${propName}`;
}

export function elementRefSyntaxId(file: string, index: number): Id {
	return `syntax:element-ref:${file}:${index}`;
}

export function rootMarkerSyntaxId(file: string, index: number): Id {
	return `syntax:root-marker:${file}:${index}`;
}

export function scriptSyntaxId(file: string, index: number): Id {
	return `syntax:script:${file}:${index}`;
}

export function styleSyntaxId(file: string, index: number): Id {
	return `syntax:style:${file}:${index}`;
}

export function blocksSlotSyntaxId(file: string, index: number): Id {
	return `syntax:blocks-slot:${file}:${index}`;
}

export function refAccessSyntaxId(
	file: string,
	scriptIndex: number,
	index: number,
): Id {
	return `syntax:ref-access:${file}:${scriptIndex}:${index}`;
}

export function islandPlacementSyntaxId(file: string, index: number): Id {
	return `syntax:island-placement:${file}:${index}`;
}

// Symbol layer. `scope` is what a component symbol is keyed by: the
// project-relative file path (for local and imported components alike — an
// imported component's symbol id equals the id its own compile produces),
// or a bare target name when a render site references something unknown.

export function componentSymbolId(scope: string): Id {
	return `symbol:component:${scope}#default`;
}

export function componentSymbolIdForFile(path: string): Id {
	return componentSymbolId(path);
}

export function propSymbolId(scope: string, propName: string): Id {
	return `symbol:prop:${scope}#default.${propName}`;
}

export function settingSymbolId(scope: string, settingName: string): Id {
	return `symbol:setting:${scope}#default.${settingName}`;
}

export function aliasSymbolId(file: string, localName: string): Id {
	return `symbol:alias:${file}.${localName}`;
}

export function refSymbolId(scope: string, refName: string): Id {
	return `symbol:ref:${scope}#default.${refName}`;
}
