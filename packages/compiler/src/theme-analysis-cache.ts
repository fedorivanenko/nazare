import type { Diagnostic, SourceSpan } from "@nazare/core";
import type {
	ThemeAnalysisCache,
	ThemeAnalysisCacheEntry,
	ThemeFact,
} from "./theme-facts.js";

const PERSISTED_THEME_ANALYSIS_CACHE_VERSION = 2;

/** @internal CLI inspect cache contains semantic facts only, never output-bearing build artifacts. */
export function parsePersistedInspectFactCache(
	value: unknown,
): ThemeAnalysisCache {
	if (
		!isRecord(value) ||
		value.version !== PERSISTED_THEME_ANALYSIS_CACHE_VERSION
	) {
		throw new Error(
			`expected persisted theme analysis cache version ${PERSISTED_THEME_ANALYSIS_CACHE_VERSION}`,
		);
	}
	if (!isRecord(value.entries)) throw new Error("expected entries object");
	const entries: Record<string, ThemeAnalysisCacheEntry> = {};
	for (const [path, entry] of Object.entries(value.entries)) {
		if (!isPersistedEntry(entry)) {
			throw new Error(`invalid cache entry for ${JSON.stringify(path)}`);
		}
		entries[path] = entry;
	}
	return { version: 1, entries };
}

/** @internal Serializes only fields consumed by inspect; component artifacts remain memory-only. */
export function serializePersistedInspectFactCache(
	cache: ThemeAnalysisCache,
): string {
	const entries = Object.fromEntries(
		Object.entries(cache.entries).map(([path, entry]) => [
			path,
			{
				fingerprint: entry.fingerprint,
				facts: entry.facts,
				issues: entry.issues,
			},
		]),
	);
	return JSON.stringify({
		version: PERSISTED_THEME_ANALYSIS_CACHE_VERSION,
		entries,
	});
}

function isPersistedEntry(value: unknown): value is ThemeAnalysisCacheEntry {
	return (
		isRecord(value) &&
		typeof value.fingerprint === "string" &&
		Array.isArray(value.facts) &&
		value.facts.every(isThemeFact) &&
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
