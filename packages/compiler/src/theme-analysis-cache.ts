import type { Diagnostic, SourceSpan } from "@nazare/core";
import { THEME_FACT_CACHE_REVISION } from "./fact-cache-revision.js";
import { themeFactSourcePath } from "./theme-fact-store.js";
import type {
	ThemeAnalysisCache,
	ThemeAnalysisCacheEntry,
	ThemeFact,
} from "./theme-facts.js";
import {
	isUnsafeThemePath,
	normalizeThemePath,
} from "./theme-file-classifier.js";
import type { ThemeFileImpact } from "./theme-queries.js";

const PERSISTED_THEME_INSPECTION_CACHE_VERSION = 4;

export type PersistedThemeInspection = {
	inputFingerprint: string;
	root: string;
	issues: Diagnostic[];
	impacts: Record<string, ThemeFileImpact>;
	factCache: ThemeAnalysisCache;
};

/** @internal Parses the complete CLI inspect cache without loading compiler frontends. */
export function parsePersistedThemeInspection(
	value: unknown,
): PersistedThemeInspection {
	if (
		!isRecord(value) ||
		value.version !== PERSISTED_THEME_INSPECTION_CACHE_VERSION
	) {
		throw new Error(
			`expected persisted theme inspection cache version ${PERSISTED_THEME_INSPECTION_CACHE_VERSION}`,
		);
	}
	if (value.factRevision !== THEME_FACT_CACHE_REVISION) {
		throw new Error(
			`expected fact revision ${THEME_FACT_CACHE_REVISION}, got ${String(value.factRevision)}`,
		);
	}
	if (
		!isString(value.inputFingerprint) ||
		value.inputFingerprint.length === 0
	) {
		throw new Error("expected non-empty inputFingerprint");
	}
	if (!isSafeThemeRoot(value.root)) throw new Error("expected safe theme root");
	if (!Array.isArray(value.issues) || !value.issues.every(isDiagnostic)) {
		throw new Error("expected issues array");
	}
	if (!isRecord(value.entries)) throw new Error("expected entries object");
	if (!isRecord(value.impacts)) throw new Error("expected impacts object");

	const entries: Record<string, ThemeAnalysisCacheEntry> = Object.create(null);
	for (const [path, entry] of Object.entries(value.entries)) {
		assertSafeThemePath(path, "cache entry");
		if (!isPersistedEntry(entry, path)) {
			throw new Error(`invalid cache entry for ${JSON.stringify(path)}`);
		}
		entries[path] = entry;
	}
	const impacts: Record<string, ThemeFileImpact> = Object.create(null);
	for (const [path, impact] of Object.entries(value.impacts)) {
		assertSafeThemePath(path, "impact");
		if (!isThemeFileImpact(impact, path)) {
			throw new Error(`invalid impact for ${JSON.stringify(path)}`);
		}
		impacts[path] = impact;
	}
	const factFilePaths = Object.values(entries)
		.flatMap((entry) => entry.facts)
		.filter(
			(fact): fact is Extract<ThemeFact, { kind: "file" }> =>
				fact.kind === "file",
		)
		.map((fact) => fact.path)
		.sort((left, right) => left.localeCompare(right));
	const impactPaths = Object.keys(impacts).sort((left, right) =>
		left.localeCompare(right),
	);
	if (JSON.stringify(factFilePaths) !== JSON.stringify(impactPaths)) {
		throw new Error("impact paths do not match cached file facts");
	}
	return {
		inputFingerprint: value.inputFingerprint,
		root: value.root,
		issues: value.issues,
		impacts,
		factCache: { version: 1, entries },
	};
}

/** @internal Serializes facts and compiler-owned query projections atomically. */
export function serializePersistedThemeInspection(
	inspection: PersistedThemeInspection,
): string {
	const entries = Object.fromEntries(
		Object.entries(inspection.factCache.entries)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([path, entry]) => [
				path,
				{
					fingerprint: entry.fingerprint,
					facts: entry.facts,
					issues: entry.issues,
				},
			]),
	);
	const impacts = Object.fromEntries(
		Object.entries(inspection.impacts).sort(([left], [right]) =>
			left.localeCompare(right),
		),
	);
	return JSON.stringify({
		version: PERSISTED_THEME_INSPECTION_CACHE_VERSION,
		factRevision: THEME_FACT_CACHE_REVISION,
		inputFingerprint: inspection.inputFingerprint,
		root: inspection.root,
		issues: inspection.issues,
		entries,
		impacts,
	});
}

function assertSafeThemePath(path: string, subject: string): void {
	const normalizedPath = normalizeThemePath(path);
	if (normalizedPath !== path || isUnsafeThemePath(path)) {
		throw new Error(`unsafe ${subject} path ${JSON.stringify(path)}`);
	}
}

function isSafeThemeRoot(value: unknown): value is string {
	return (
		isString(value) &&
		(value === "." ||
			(normalizeThemePath(value) === value && !isUnsafeThemePath(value)))
	);
}

function isThemeFileImpact(
	value: unknown,
	path: string,
): value is ThemeFileImpact {
	return (
		isRecord(value) &&
		value.version === 1 &&
		value.path === path &&
		isThemeFileKind(value.fileKind) &&
		["entry", "used", "unused", "unknown"].includes(String(value.usage)) &&
		["complete", "partial"].includes(String(value.certainty)) &&
		Array.isArray(value.uncertainty) &&
		value.uncertainty.every(isString) &&
		Array.isArray(value.dependencies) &&
		value.dependencies.every(isString) &&
		Array.isArray(value.dependents) &&
		value.dependents.every(isString) &&
		Array.isArray(value.affectedPages) &&
		value.affectedPages.every(isString) &&
		Array.isArray(value.issues) &&
		value.issues.every(isDiagnostic)
	);
}

function isPersistedEntry(
	value: unknown,
	path: string,
): value is ThemeAnalysisCacheEntry {
	return (
		isRecord(value) &&
		typeof value.fingerprint === "string" &&
		value.fingerprint.length > 0 &&
		Array.isArray(value.facts) &&
		value.facts.every(
			(fact) => isThemeFact(fact) && themeFactSourcePath(fact) === path,
		) &&
		Array.isArray(value.issues) &&
		value.issues.every(isDiagnostic) &&
		value.artifact === undefined
	);
}

function isThemeFact(value: unknown): value is ThemeFact {
	if (!isRecord(value) || typeof value.kind !== "string") return false;
	const pathAndName = () => isString(value.path) && isString(value.name);
	const reference = () =>
		isString(value.fromPath) &&
		isOptionalString(value.targetName) &&
		isBoolean(value.static) &&
		isOptionalSpan(value.span);
	switch (value.kind) {
		case "file":
			return isString(value.path) && isThemeFileKind(value.fileKind);
		case "sourceAnalysis":
			return (
				isString(value.path) &&
				isThemeSourceLanguage(value.language) &&
				["complete", "partial", "failed"].includes(
					String(value.completeness),
				) &&
				Array.isArray(value.uncertainty) &&
				value.uncertainty.every(isString)
			);
		case "behavior":
			return isThemeBehaviorFact(value);
		case "declaresSection":
		case "declaresSnippet":
		case "declaresTemplate":
		case "declaresLayout":
		case "declaresLocale":
		case "declaresAsset":
		case "declaresSectionGroup":
		case "declaresThemeBlock":
			return pathAndName();
		case "declaresComponent":
			return pathAndName() && isOptionalString(value.componentKind);
		case "rendersSnippet":
			return (
				reference() &&
				isString(value.siteId) &&
				(value.invocationKind === "render" ||
					value.invocationKind === "include")
			);
		case "containsSection":
		case "containsSectionGroup":
		case "usesLayout":
		case "referencesAsset":
			return reference();
		case "definesLocaleKey":
			return (
				isString(value.path) &&
				isString(value.key) &&
				isOptionalSpan(value.span)
			);
		case "referencesLocaleKey":
			return (
				isString(value.fromPath) &&
				isOptionalString(value.key) &&
				isBoolean(value.static) &&
				isOptionalSpan(value.span)
			);
		case "importsComponent":
			return (
				isString(value.fromPath) &&
				isString(value.targetPath) &&
				isString(value.localName) &&
				isOptionalSpan(value.span)
			);
		case "sectionInstance":
			return (
				isString(value.templatePath) &&
				isString(value.instanceId) &&
				isOptionalString(value.sectionType) &&
				isBoolean(value.static)
			);
		case "blockInstance":
			return (
				isString(value.ownerPath) &&
				isString(value.sectionInstanceId) &&
				isString(value.instanceId) &&
				isOptionalString(value.blockType) &&
				isOptionalString(value.parentInstanceId) &&
				isBoolean(value.static)
			);
		case "definesSchema":
			return (
				isString(value.path) &&
				isString(value.schemaPath) &&
				isOptionalSpan(value.span)
			);
		case "definesSetting":
			return (
				isString(value.path) &&
				isString(value.schemaPath) &&
				isString(value.settingId) &&
				isOptionalString(value.settingType) &&
				isOptionalSpan(value.span)
			);
		case "declaresBlock":
			return (
				isString(value.path) &&
				isString(value.blockType) &&
				isOptionalString(value.name) &&
				isOptionalSpan(value.span)
			);
		case "definesBlockSetting":
			return (
				isString(value.path) &&
				isString(value.blockType) &&
				isString(value.settingId) &&
				isOptionalString(value.settingType) &&
				isOptionalSpan(value.span)
			);
		case "readsSetting":
			return (
				isString(value.fromPath) &&
				["settings", "section", "block"].includes(
					String(value.settingObject),
				) &&
				isString(value.settingId) &&
				isOptionalSpan(value.span)
			);
		case "readsShopifyData":
			return (
				isString(value.fromPath) &&
				isString(value.object) &&
				isOptionalString(value.propertyPath) &&
				isString(value.expression) &&
				isOptionalBoolean(value.conditional) &&
				isOptionalSpan(value.span)
			);
		case "passesRenderArgument":
			return (
				isString(value.fromPath) &&
				isString(value.targetName) &&
				isString(value.siteId) &&
				isString(value.argumentName) &&
				isString(value.valueExpression) &&
				isOptionalString(value.sourceObject) &&
				isOptionalString(value.sourcePath) &&
				isOptionalSpan(value.span)
			);
		case "readsFreeVariable":
			return (
				isString(value.fromPath) &&
				isString(value.name) &&
				isOptionalString(value.propertyPath) &&
				isString(value.expression) &&
				(value.usage === "expression" || value.usage === "renderArgument") &&
				isOptionalSpan(value.span)
			);
		case "guardsObject":
			return (
				isString(value.fromPath) &&
				isString(value.name) &&
				(value.via === "guard" || value.via === "default")
			);
		case "declaresInput":
			return (
				isString(value.path) &&
				isString(value.name) &&
				isBoolean(value.required) &&
				isOptionalString(value.paramType) &&
				isOptionalSpan(value.span)
			);
		case "declaresDocParam":
			return (
				isString(value.path) &&
				isString(value.name) &&
				isBoolean(value.required) &&
				isOptionalString(value.paramType) &&
				isOptionalString(value.description) &&
				isOptionalSpan(value.span)
			);
		case "detectsCapability":
			return (
				isString(value.path) &&
				isString(value.capability) &&
				["direct", "strong", "suggestive"].includes(
					String(value.evidenceStrength),
				) &&
				isOptionalSpan(value.span)
			);
		default:
			return false;
	}
}

function isThemeBehaviorFact(value: Record<string, unknown>): boolean {
	if (
		!isString(value.fromPath) ||
		!isString(value.name) ||
		!isString(value.extractor) ||
		!isOptionalSpan(value.span)
	) {
		return false;
	}
	if (value.subjectKind === "domHook") {
		return (
			["class", "id", "attribute"].includes(String(value.hookKind)) &&
			["emits", "selects", "queries", "mutates"].includes(
				String(value.operation),
			)
		);
	}
	if (value.subjectKind === "customProperty") {
		return ["defines", "reads"].includes(String(value.operation));
	}
	if (value.subjectKind === "customEvent") {
		return ["dispatches", "listens"].includes(String(value.operation));
	}
	if (value.subjectKind === "customElement") {
		return ["defines", "uses"].includes(String(value.operation));
	}
	return false;
}

function isThemeSourceLanguage(value: unknown): boolean {
	return [
		"nazare-liquid",
		"liquid",
		"css",
		"javascript",
		"json",
		"asset",
		"other",
	].includes(String(value));
}

function isDiagnostic(value: unknown): value is Diagnostic {
	return (
		isRecord(value) &&
		["error", "warning", "info"].includes(String(value.severity)) &&
		isString(value.code) &&
		isString(value.message) &&
		(value.phase === undefined ||
			["parse", "resolve", "check", "validate", "emit"].includes(
				String(value.phase),
			)) &&
		isOptionalString(value.nodeId) &&
		isOptionalString(value.edgeId) &&
		isOptionalSpan(value.span)
	);
}

function isSourceSpan(value: unknown): value is SourceSpan {
	return (
		isRecord(value) &&
		isString(value.file) &&
		isPosition(value.start) &&
		isPosition(value.end)
	);
}

function isPosition(value: unknown): boolean {
	return (
		isRecord(value) &&
		Number.isSafeInteger(value.line) &&
		Number(value.line) >= 1 &&
		Number.isSafeInteger(value.column) &&
		Number(value.column) >= 1
	);
}

function isThemeFileKind(value: unknown): boolean {
	return [
		"section",
		"sectionGroup",
		"snippet",
		"themeBlock",
		"templateJson",
		"templateLiquid",
		"layout",
		"locale",
		"asset",
		"settingsSchema",
		"settingsData",
		"nazareComponent",
		"other",
	].includes(String(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
	return typeof value === "boolean";
}

function isOptionalString(value: unknown): boolean {
	return value === undefined || isString(value);
}

function isOptionalBoolean(value: unknown): boolean {
	return value === undefined || isBoolean(value);
}

function isOptionalSpan(value: unknown): boolean {
	return value === undefined || isSourceSpan(value);
}
