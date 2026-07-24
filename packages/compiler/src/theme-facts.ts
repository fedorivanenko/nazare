import type {
	ArtifactContract,
	ArtifactIR,
	Diagnostic,
	SourceSpan,
} from "@nazare/core";
import type { NazareAst } from "./ast.js";
import type { EmitResult } from "./emit.js";
import type { ThemeFileKind } from "./theme-file-classifier.js";

export interface ThemeInputFile {
	path: string;
	contents: string;
}

export interface AnalyzeNazareThemeOptions {
	root?: string;
	strictness?: "strict" | "loose";
}

export interface InspectNazareThemeOptions extends AnalyzeNazareThemeOptions {
	format?: "json";
}

export type BuildThemeScope =
	| { kind: "workspace" }
	| { kind: "file"; path: string };

export interface BuildNazareThemeWorkspaceOptions
	extends AnalyzeNazareThemeOptions {
	scope?: BuildThemeScope;
	emitOnError?: boolean;
	name?: string;
}

export type ThemeFact =
	| { kind: "file"; path: string; fileKind: ThemeFileKind }
	| { kind: "declaresSection"; path: string; name: string }
	| { kind: "declaresSnippet"; path: string; name: string }
	| { kind: "declaresTemplate"; path: string; name: string }
	| { kind: "declaresAsset"; path: string; name: string }
	| {
			kind: "declaresComponent";
			path: string;
			name: string;
			componentKind?: string;
	  }
	| {
			kind: "rendersSnippet";
			fromPath: string;
			targetName?: string;
			static: boolean;
			span?: SourceSpan;
	  }
	| {
			kind: "containsSection";
			fromPath: string;
			targetName?: string;
			static: boolean;
			span?: SourceSpan;
	  }
	| {
			kind: "referencesAsset";
			fromPath: string;
			targetName?: string;
			static: boolean;
			span?: SourceSpan;
	  }
	| {
			kind: "importsComponent";
			fromPath: string;
			targetPath: string;
			localName: string;
			span?: SourceSpan;
	  }
	| {
			kind: "definesSchema";
			path: string;
			schemaPath: string;
			span?: SourceSpan;
	  }
	| {
			kind: "definesSetting";
			path: string;
			schemaPath: string;
			settingId: string;
			settingType?: string;
			span?: SourceSpan;
	  };

export type ThemeFileRecord = {
	id: string;
	path: string;
	fileKind: ThemeFileKind;
};

export type ThemeDeclaration = {
	id: string;
	kind: "section" | "snippet" | "template" | "asset" | "component";
	path: string;
	name: string;
	componentKind?: string;
};

export type ThemeReference = {
	id: string;
	kind:
		| "rendersSnippet"
		| "containsSection"
		| "referencesAsset"
		| "importsComponent";
	fromPath: string;
	targetKind: "snippet" | "section" | "asset" | "component";
	targetName?: string;
	targetPath?: string;
	resolvedDeclarationId?: string;
	static: boolean;
	span?: SourceSpan;
};

export type ThemeSchemaRecord = {
	id: string;
	path: string;
	schemaPath: string;
	span?: SourceSpan;
};

export type ThemeSettingRecord = {
	id: string;
	path: string;
	schemaPath: string;
	settingId: string;
	settingType?: string;
	span?: SourceSpan;
};

export interface ThemeSemanticModel {
	version: 1;
	root: string;
	files: ThemeFileRecord[];
	declarations: ThemeDeclaration[];
	references: ThemeReference[];
	schemas: ThemeSchemaRecord[];
	settings: ThemeSettingRecord[];
	issues: Diagnostic[];
}

export interface ThemeAnalysis {
	ir: ThemeSemanticModel;
	artifacts: ThemeBuiltArtifact[];
	issues: Diagnostic[];
}

export type ThemeBuiltArtifact = {
	path: string;
	source: string;
	ast: NazareAst;
	ir: ArtifactIR;
	contract: ArtifactContract;
	contracts: ArtifactContract[];
	canEmit: boolean;
	notes: Diagnostic[];
};

export interface ThemeBuildResult {
	analysis: ThemeAnalysis;
	artifacts: ThemeBuiltArtifact[];
	emitted: EmitResult;
	issues: Diagnostic[];
	emittedOnError: boolean;
}

export type SemanticThemeGraphNode =
	| { id: string; kind: "file"; path: string; fileKind: ThemeFileKind }
	| { id: string; kind: "section"; name: string; path: string }
	| { id: string; kind: "snippet"; name: string; path: string }
	| { id: string; kind: "template"; name: string; path: string }
	| { id: string; kind: "asset"; name: string; path: string }
	| {
			id: string;
			kind: "component";
			name: string;
			path: string;
			componentKind?: string;
	  }
	| { id: string; kind: "schema"; path: string; schemaPath: string }
	| {
			id: string;
			kind: "setting";
			path: string;
			schemaPath: string;
			settingId: string;
			settingType?: string;
	  }
	| {
			id: string;
			kind: "unresolved";
			targetKind: "snippet" | "section" | "asset" | "component";
			name?: string;
	  };

export type SemanticThemeGraphEdge =
	| { id: string; kind: "declares"; from: string; to: string }
	| {
			id: string;
			kind: "renders";
			from: string;
			to: string;
			targetName?: string;
	  }
	| { id: string; kind: "imports"; from: string; to: string; specifier: string }
	| {
			id: string;
			kind: "referencesAsset";
			from: string;
			to: string;
			targetName?: string;
	  }
	| { id: string; kind: "definesSchema"; from: string; to: string }
	| { id: string; kind: "definesSetting"; from: string; to: string }
	| {
			id: string;
			kind: "templateContainsSection";
			from: string;
			to: string;
			targetName?: string;
	  };

export interface InspectNazareThemeResult {
	version: 1;
	root: string;
	nodes: SemanticThemeGraphNode[];
	edges: SemanticThemeGraphEdge[];
	issues: Diagnostic[];
}
