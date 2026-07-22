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

export interface ThemeAnalysisCacheEntry {
	fingerprint: string;
	facts: ThemeFact[];
	issues: Diagnostic[];
}

export interface ThemeAnalysisCache {
	version: 1;
	entries: Record<string, ThemeAnalysisCacheEntry>;
}

export interface AnalyzeNazareThemeOptions {
	root?: string;
	strictness?: "strict" | "loose";
	plainLiquidParseMode?: "strict" | "tolerant";
	/** Mutable per-file fact cache. Nazare components remain uncached. */
	cache?: ThemeAnalysisCache;
	/**
	 * Theme-relative globs whose files are skipped entirely. Exclusion is a user
	 * policy and is never inferred; every excluded file is reported as
	 * THEME_FILE_EXCLUDED so the graph never omits a file silently.
	 */
	exclude?: string[];
}

export type InspectNazareThemeOptions = AnalyzeNazareThemeOptions;

export type BuildThemeScope =
	| { kind: "workspace" }
	| { kind: "closure"; path: string }
	| { kind: "file"; path: string };

export interface BuildNazareThemeWorkspaceOptions
	extends AnalyzeNazareThemeOptions {
	scope?: BuildThemeScope;
	emitOnError?: boolean;
	/**
	 * Emit name for the scoped entry artifact. Closure dependencies and
	 * workspace artifacts use their own file basenames.
	 */
	name?: string;
}

/**
 * Stable render-call-site identity: file path plus the render tag's start
 * position. Every extractor derives it the same way, so arguments and sites
 * collected by different extractors join on it.
 */
export function renderSiteKey(fromPath: string, span: SourceSpan): string {
	return `${fromPath}@${span.start.line}:${span.start.column}`;
}

export type ThemeFact =
	| { kind: "file"; path: string; fileKind: ThemeFileKind }
	| { kind: "declaresSection"; path: string; name: string }
	| { kind: "declaresSnippet"; path: string; name: string }
	| { kind: "declaresTemplate"; path: string; name: string }
	| { kind: "declaresLayout"; path: string; name: string }
	| { kind: "declaresLocale"; path: string; name: string }
	| { kind: "declaresAsset"; path: string; name: string }
	| { kind: "declaresSectionGroup"; path: string; name: string }
	| { kind: "declaresThemeBlock"; path: string; name: string }
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
			/** Stable per-call-site key (path@line:column); joins arguments to sites. */
			siteId: string;
			invocationKind: "render" | "include";
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
			kind: "containsSectionGroup";
			fromPath: string;
			targetName?: string;
			static: boolean;
			span?: SourceSpan;
	  }
	| {
			kind: "usesLayout";
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
			kind: "definesLocaleKey";
			path: string;
			key: string;
			span?: SourceSpan;
	  }
	| {
			kind: "referencesLocaleKey";
			fromPath: string;
			key?: string;
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
			kind: "sectionInstance";
			templatePath: string;
			instanceId: string;
			sectionType?: string;
			static: boolean;
	  }
	| {
			kind: "blockInstance";
			ownerPath: string;
			sectionInstanceId: string;
			instanceId: string;
			blockType?: string;
			parentInstanceId?: string;
			static: boolean;
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
	  }
	| {
			kind: "declaresBlock";
			path: string;
			blockType: string;
			name?: string;
			span?: SourceSpan;
	  }
	| {
			kind: "definesBlockSetting";
			path: string;
			blockType: string;
			settingId: string;
			settingType?: string;
			span?: SourceSpan;
	  }
	| {
			kind: "readsSetting";
			fromPath: string;
			settingObject: "settings" | "section" | "block";
			settingId: string;
			span?: SourceSpan;
	  }
	| {
			kind: "readsShopifyData";
			fromPath: string;
			object: string;
			propertyPath?: string;
			expression: string;
			span?: SourceSpan;
	  }
	| {
			kind: "passesRenderArgument";
			fromPath: string;
			targetName: string;
			/** The render site this argument belongs to; same key as rendersSnippet. */
			siteId: string;
			argumentName: string;
			valueExpression: string;
			sourceObject?: string;
			sourcePath?: string;
			span?: SourceSpan;
	  }
	| {
			/** A variable read that is neither a Liquid global nor assigned
			 * locally — evidence for an inferred component input. */
			kind: "readsFreeVariable";
			fromPath: string;
			name: string;
			propertyPath?: string;
			expression: string;
			usage: "expression" | "renderArgument";
			span?: SourceSpan;
	  }
	| {
			/** The named object appears in an if/unless/case condition in this
			 * file, so reads of it are treated as guarded (optional). */
			kind: "guardsObject";
			fromPath: string;
			name: string;
	  }
	| {
			kind: "detectsCapability";
			path: string;
			capability: string;
			confidence: number;
			span?: SourceSpan;
	  };

export type ThemeFileRecord = {
	id: string;
	path: string;
	fileKind: ThemeFileKind;
};

export type ThemeDeclaration = {
	id: string;
	kind:
		| "section"
		| "snippet"
		| "template"
		| "layout"
		| "locale"
		| "asset"
		| "sectionGroup"
		| "themeBlock"
		| "component";
	path: string;
	name: string;
	componentKind?: string;
};

export type ThemeReference = {
	id: string;
	kind:
		| "rendersSnippet"
		| "containsSection"
		| "containsSectionGroup"
		| "usesLayout"
		| "referencesAsset"
		| "importsComponent";
	fromPath: string;
	targetKind:
		| "snippet"
		| "section"
		| "sectionGroup"
		| "layout"
		| "asset"
		| "component";
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

export type ThemeSectionInstanceRecord = {
	id: string;
	templatePath: string;
	instanceId: string;
	sectionType?: string;
	resolvedDeclarationId?: string;
	static: boolean;
};

export type ThemePageRecord = {
	id: string;
	path: string;
	name: string;
	pageType: string;
	templateDeclarationId: string;
};

export type ThemeBlockInstanceRecord = {
	id: string;
	ownerPath: string;
	sectionInstanceId: string;
	instanceId: string;
	blockType?: string;
	parentInstanceId?: string;
	resolvedBlockId?: string;
	static: boolean;
};

export type ThemeBlockRecord = {
	id: string;
	path: string;
	blockType: string;
	name?: string;
	span?: SourceSpan;
};

export type ThemeBlockSettingRecord = {
	id: string;
	path: string;
	blockType: string;
	settingId: string;
	settingType?: string;
	span?: SourceSpan;
};

export type ThemeLocaleKeyRecord = {
	id: string;
	key: string;
};

export type ThemeLocaleTranslationRecord = {
	id: string;
	path: string;
	key: string;
	localeKeyId: string;
	span?: SourceSpan;
};

export type ThemeLocaleReferenceRecord = {
	id: string;
	fromPath: string;
	key?: string;
	resolvedLocaleKeyIds: string[];
	static: boolean;
	span?: SourceSpan;
};

export type ThemeSettingReadRecord = {
	id: string;
	fromPath: string;
	settingObject: "settings" | "section" | "block";
	settingId: string;
	resolvedSettingId?: string;
	candidateSettingIds?: string[];
	span?: SourceSpan;
};

export type ThemeDataAccessRecord = {
	id: string;
	fromPath: string;
	object: string;
	propertyPath?: string;
	expression: string;
	origin?: "direct" | "renderArgument";
	sourceRenderArgumentId?: string;
	inputName?: string;
	span?: SourceSpan;
};

export type ThemeRenderArgumentRecord = {
	id: string;
	fromPath: string;
	targetName: string;
	siteId: string;
	argumentName: string;
	valueExpression: string;
	sourceObject?: string;
	sourcePath?: string;
	span?: SourceSpan;
};

/** A free (non-global, unassigned) variable read; evidence for expected inputs. */
export type ThemeVariableReadRecord = {
	id: string;
	fromPath: string;
	name: string;
	propertyPath?: string;
	expression: string;
	usage: "expression" | "renderArgument";
	span?: SourceSpan;
};

export type ThemeCapabilityRecord = {
	id: string;
	path: string;
	capability: string;
	confidence: number;
	evidenceIds: string[];
};

export type ThemeCapabilitySignalRecord = {
	id: string;
	path: string;
	capability: string;
	confidence: number;
	span?: SourceSpan;
};

export type ThemeClassificationRecord = {
	id: string;
	path: string;
	label: string;
	confidence: number;
	evidenceIds: string[];
	uncertainty: string[];
};

export type ThemeEvidenceRecord = {
	id: string;
	kind:
		| "schema"
		| "schemaSetting"
		| "settingRead"
		| "dataRead"
		| "renderCall"
		| "renderArgument"
		| "templateConfig"
		| "dependency";
	file: string;
	span?: SourceSpan;
	extractor: string;
};

export type ThemeExpectedInputRecord = {
	id: string;
	path: string;
	name: string;
	/** Compatibility projection. True only when source proves caller input need. */
	required: boolean;
	requirement: "required" | "optional" | "unknown";
	origin: "freeVariable" | "ambientShopifyContext";
	propertyPaths: string[];
	evidenceIds: string[];
};

export type ThemeRenderSiteRecord = {
	id: string;
	fromPath: string;
	targetName?: string;
	resolvedDeclarationId?: string;
	invocationKind: "render" | "include";
	argumentIds: string[];
	span?: SourceSpan;
};

export interface ThemeSemanticModel {
	version: 2;
	root: string;
	files: ThemeFileRecord[];
	declarations: ThemeDeclaration[];
	references: ThemeReference[];
	schemas: ThemeSchemaRecord[];
	settings: ThemeSettingRecord[];
	blocks: ThemeBlockRecord[];
	blockSettings: ThemeBlockSettingRecord[];
	sectionInstances: ThemeSectionInstanceRecord[];
	blockInstances: ThemeBlockInstanceRecord[];
	pages: ThemePageRecord[];
	localeKeys: ThemeLocaleKeyRecord[];
	localeTranslations: ThemeLocaleTranslationRecord[];
	localeReferences: ThemeLocaleReferenceRecord[];
	settingReads: ThemeSettingReadRecord[];
	dataAccesses: ThemeDataAccessRecord[];
	variableReads: ThemeVariableReadRecord[];
	renderArguments: ThemeRenderArgumentRecord[];
	expectedInputs: ThemeExpectedInputRecord[];
	renderSites: ThemeRenderSiteRecord[];
	capabilitySignals: ThemeCapabilitySignalRecord[];
	capabilities: ThemeCapabilityRecord[];
	classifications: ThemeClassificationRecord[];
	evidence: ThemeEvidenceRecord[];
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
	/** This artifact's own emitted files; set by buildNazareThemeWorkspace. */
	emitted?: EmitResult;
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
	| { id: string; kind: "page"; name: string; path: string; pageType: string }
	| { id: string; kind: "layout"; name: string; path: string }
	| { id: string; kind: "locale"; name: string; path: string }
	| { id: string; kind: "localeKey"; key: string; translationPaths: string[] }
	| { id: string; kind: "asset"; name: string; path: string }
	| { id: string; kind: "sectionGroup"; name: string; path: string }
	| { id: string; kind: "themeBlock"; name: string; path: string }
	| {
			id: string;
			kind: "sectionInstance";
			templatePath: string;
			instanceId: string;
			sectionType?: string;
	  }
	| {
			id: string;
			kind: "blockInstance";
			ownerPath: string;
			sectionInstanceId: string;
			instanceId: string;
			blockType?: string;
			parentInstanceId?: string;
	  }
	| {
			id: string;
			kind: "renderSite";
			fromPath: string;
			targetName?: string;
			invocationKind: "render" | "include";
	  }
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
			kind: "block";
			path: string;
			blockType: string;
			name?: string;
	  }
	| {
			id: string;
			kind: "blockSetting";
			path: string;
			blockType: string;
			settingId: string;
			settingType?: string;
	  }
	| {
			id: string;
			kind: "setting";
			path: string;
			schemaPath: string;
			settingId: string;
			settingType?: string;
	  }
	| { id: string; kind: "shopifyObject"; object: string }
	| {
			id: string;
			kind: "shopifyProperty";
			object: string;
			propertyPath: string;
	  }
	| {
			id: string;
			kind: "renderArgument";
			argumentName: string;
			valueExpression: string;
			fromPath: string;
			targetName: string;
	  }
	| {
			id: string;
			kind: "expectedInput";
			path: string;
			name: string;
			required: boolean;
			requirement: "required" | "optional" | "unknown";
			origin: "freeVariable" | "ambientShopifyContext";
			propertyPaths: string[];
			evidenceIds: string[];
	  }
	| {
			id: string;
			kind: "capability";
			capability: string;
			confidence: number;
			evidenceIds: string[];
	  }
	| {
			id: string;
			kind: "classification";
			label: string;
			confidence: number;
			evidenceIds: string[];
			uncertainty: string[];
	  }
	| {
			id: string;
			kind: "unresolved";
			targetKind:
				| "snippet"
				| "section"
				| "sectionGroup"
				| "layout"
				| "themeBlock"
				| "asset"
				| "component"
				| "setting"
				| "localeKey";
			name?: string;
	  };

export type SemanticThemeGraphEdge = (
	| { id: string; kind: "declares"; from: string; to: string }
	| { id: string; kind: "implementedBy"; from: string; to: string }
	| { id: string; kind: "invokes"; from: string; to: string }
	| { id: string; kind: "resolvesRenderTarget"; from: string; to: string }
	| { id: string; kind: "hasArgument"; from: string; to: string }
	| { id: string; kind: "satisfiesInput"; from: string; to: string }
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
	| {
			id: string;
			kind: "containsSectionGroup";
			from: string;
			to: string;
			targetName?: string;
	  }
	| {
			id: string;
			kind: "usesLayout";
			from: string;
			to: string;
			targetName?: string;
	  }
	| {
			id: string;
			kind: "referencesLocaleKey";
			from: string;
			to: string;
			key?: string;
	  }
	| { id: string; kind: "definesSchema"; from: string; to: string }
	| { id: string; kind: "definesSetting"; from: string; to: string }
	| { id: string; kind: "definesBlock"; from: string; to: string }
	| { id: string; kind: "definesBlockSetting"; from: string; to: string }
	| { id: string; kind: "pageUsesTemplate"; from: string; to: string }
	| {
			id: string;
			kind: "pageContainsSectionInstance";
			from: string;
			to: string;
	  }
	| {
			id: string;
			kind: "sectionInstanceContainsBlockInstance";
			from: string;
			to: string;
	  }
	| {
			id: string;
			kind: "blockInstanceContainsBlockInstance";
			from: string;
			to: string;
	  }
	| { id: string; kind: "instanceOfBlock"; from: string; to: string }
	| { id: string; kind: "readsSetting"; from: string; to: string }
	| { id: string; kind: "argumentReadsSetting"; from: string; to: string }
	| {
			id: string;
			kind: "accessesData";
			from: string;
			to: string;
			expression: string;
	  }
	| {
			id: string;
			kind: "passesArgument";
			from: string;
			to: string;
			argumentName: string;
			valueExpression: string;
	  }
	| { id: string; kind: "hasCapability"; from: string; to: string }
	| { id: string; kind: "classifiedAs"; from: string; to: string }
	| { id: string; kind: "expectsInput"; from: string; to: string }
	| {
			id: string;
			kind: "templateContainsSection";
			from: string;
			to: string;
			targetName?: string;
	  }
	| {
			id: string;
			kind: "templateContainsSectionInstance";
			from: string;
			to: string;
	  }
	| {
			id: string;
			kind: "instanceOf";
			from: string;
			to: string;
			targetName?: string;
	  }
) & { evidenceIds?: string[] };

export type ThemeGraphView = {
	nodeIds: string[];
	edgeIds: string[];
};

export type ThemeGraphViews = {
	themeStructure: ThemeGraphView;
	shopifyData: ThemeGraphView;
	storefrontArchitecture: ThemeGraphView;
	configuration: ThemeGraphView;
	changeImpact: ThemeGraphView;
};

export type ThemeImpactSummary = {
	dependencies: Record<string, string[]>;
	dependents: Record<string, string[]>;
	affectedPages: Record<string, string[]>;
	unusedFiles: string[];
};

export interface InspectNazareThemeResult {
	version: 2;
	root: string;
	nodes: SemanticThemeGraphNode[];
	edges: SemanticThemeGraphEdge[];
	evidence: ThemeEvidenceRecord[];
	impact: ThemeImpactSummary;
	views: ThemeGraphViews;
	issues: Diagnostic[];
}
