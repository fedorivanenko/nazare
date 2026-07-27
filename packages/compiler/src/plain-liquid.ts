import type { Diagnostic, SourceSpan } from "@nazare/core";
import type { AuthoredSchema, SettingsRead } from "./ast.js";

export type PlainLiquidParseMode = "strict" | "liquid-only";

export type PlainLiquidOptions = {
	/** Defaults to strict HTML + Liquid validation; liquid-only validates Liquid structure only. */
	parseMode?: PlainLiquidParseMode;
};

export type BuildPlainLiquidOptions = PlainLiquidOptions & {
	/** Defaults to false; set true only for preview/pass-through tooling. */
	emitOnError?: boolean;
};

export type PlainLiquidDependencyKind =
	| "snippet"
	| "section"
	| "section-group"
	| "layout";

export type PlainLiquidDependency = {
	kind: PlainLiquidDependencyKind;
	invocationKind?: "render" | "include";
	path?: string;
	name?: string;
	source: string;
	static: boolean;
	span: SourceSpan;
};

export type PlainLiquidAst = {
	file: string;
	nodes: [];
	schema?: AuthoredSchema;
	settingsReads: SettingsRead[];
	dependencies: PlainLiquidDependency[];
	diagnostics: Diagnostic[];
	notes: [];
	factsCollected: boolean;
	parseMode: PlainLiquidParseMode;
};

export type CompilePlainLiquidResult = {
	ast: PlainLiquidAst;
	issues: Diagnostic[];
	dependencies: PlainLiquidDependency[];
	canEmit: boolean;
};

export type BuildPlainLiquidResult = CompilePlainLiquidResult & {
	emitted: { files: { path: string; contents: string }[]; issues: [] };
	issues: Diagnostic[];
	emittedOnError: boolean;
};

export function plainLiquidFactsSkipped(file: string): Diagnostic {
	const position = { line: 1, column: 1 };
	return {
		severity: "info",
		code: "PLAIN_LIQUID_FACTS_SKIPPED",
		message:
			"Plain Liquid schema, settings, and dependency facts were not collected because parsing failed",
		span: { file, start: position, end: position },
	};
}

export function invalidDependencyName(
	kind: PlainLiquidDependencyKind,
	name: string,
	span: SourceSpan,
	reason: string,
): Diagnostic {
	return {
		severity: "error",
		code: "PLAIN_LIQUID_INVALID_DEPENDENCY_NAME",
		message: `Invalid ${kind} dependency name "${name}": ${reason}`,
		span,
	};
}

export function validateDependencyName(
	kind: PlainLiquidDependencyKind,
	name: string,
): { valid: true } | { valid: false; reason: string } {
	if (kind === "layout" && name === "none") return { valid: true };
	if (name.trim() !== name || name.length === 0) {
		return { valid: false, reason: "must be a non-empty trimmed name" };
	}
	if (name.startsWith("/") || name.includes("..")) {
		return {
			valid: false,
			reason: "must not contain traversal or absolute paths",
		};
	}
	if (/[\\/]/.test(name)) {
		return { valid: false, reason: "must not contain path separators" };
	}
	if (/\.(liquid|json)$/i.test(name)) {
		return { valid: false, reason: "must omit theme file extensions" };
	}
	return { valid: true };
}

export function dependencyPath(
	kind: PlainLiquidDependencyKind,
	name: string,
): string | undefined {
	if (kind === "layout" && name === "none") return undefined;
	if (kind === "snippet") return `snippets/${name}.liquid`;
	if (kind === "section") return `sections/${name}.liquid`;
	if (kind === "section-group") return `sections/${name}.json`;
	return `layout/${name}.liquid`;
}
