export type Id = string;

export type SourcePosition = {
	line: number;
	column: number;
};

export type SourceSpan = {
	file: string;
	start: SourcePosition;
	end: SourcePosition;
};

export type ArtifactObjectKind =
	| "file"
	| "component"
	| "section"
	| "snippet"
	| "props-interface"
	| "prop"
	| "render-site"
	| "import"
	| "schema"
	| "schema-field"
	| "expression"
	| "style-expression"
	| "behavior";

export type ArtifactMorphismKind =
	| "declares"
	| "imports"
	| "renders"
	| "passes-prop"
	| "expects-prop"
	| "binds-schema"
	| "uses-expression"
	| "computes-style"
	| "attaches-behavior"
	| "depends-on";

export type ArtifactObject = {
	id: Id;
	kind: ArtifactObjectKind;
	name: string;
	data?: Record<string, unknown>;
	span?: SourceSpan;
};

export type ArtifactMorphism = {
	id: Id;
	kind: ArtifactMorphismKind;
	from: Id;
	to: Id;
	data?: Record<string, unknown>;
	span?: SourceSpan;
};

export type ArtifactSemanticGraph = {
	objects: ArtifactObject[];
	morphisms: ArtifactMorphism[];
};

export type ValidationIssue = {
	severity: "error" | "warning";
	code: string;
	message: string;
	objectId?: Id;
	morphismId?: Id;
	span?: SourceSpan;
};

export type SigmaRule = {
	id: string;
	validate(graph: ArtifactSemanticGraph): ValidationIssue[];
};

export type NazareManifest = {
	id: string;
	version: string;
	kind?: "snippet" | "section" | "function";
	entry: string;
	dependencies?: Record<string, string>;
	files: string[];
};

export const packageName = "@nazare/core";
