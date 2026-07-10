// Symbol-layer records: the named things syntax declares or references
// (components, import aliases, props, settings), each carrying where it
// resolved from. Symbols are identity — one symbol may have many declaring
// syntax nodes, or none when it comes from a contract or is unresolved.
import type { Id } from "./id.js";
import type { SemanticType } from "./semantic.js";

export type ArtifactSymbolKind = "component" | "alias" | "prop" | "setting";

export type ArtifactSymbolResolution =
	| "local"
	| "external-resolved"
	| "external-unresolved";

export type ArtifactSymbolSource =
	| "syntax"
	| "manifest"
	| "compiled-contract"
	| "registry";

export type ArtifactSymbol = {
	id: Id;
	kind: ArtifactSymbolKind;
	name: string;
	declarations: Id[];
	resolution: ArtifactSymbolResolution;
	source: ArtifactSymbolSource;
	packageId?: string;
	ownerSymbolId?: Id;
	semanticType?: SemanticType;
};
