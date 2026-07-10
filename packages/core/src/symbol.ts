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
