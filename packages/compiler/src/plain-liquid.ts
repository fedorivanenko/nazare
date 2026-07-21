// Plain Shopify Liquid frontend: parse/validate/pass through existing theme files
// without interpreting Nazare-only syntax. This is the coexistence seam for
// `.liquid` files in migrated themes: Liquid structure and authored schema are
// checked, static theme dependencies are indexed, and emit preserves source.
import type { Diagnostic, SourceSpan } from "@nazare/core";
import {
	type DocumentNode,
	NodeTypes,
	toLiquidHtmlAST,
	walk,
} from "@shopify/liquid-html-parser";
import type { AuthoredSchema, SettingsRead } from "./ast.js";
import {
	extractAuthoredSchema,
	isLiquidString,
	isVariableLookup,
	liquidTagMarkup,
	parseLiquidError,
} from "./liquid-ast.js";
import { scanSettingsReadsFromLiquidAst } from "./settings-reads.js";
import { spanFromOffsets } from "./source.js";

export type PlainLiquidParseMode = "strict" | "tolerant";

export type PlainLiquidOptions = {
	/** Defaults to strict for build/validation; use tolerant for editor previews. */
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
	/** Shopify theme-relative path when statically known and valid. */
	path?: string;
	/** Static dependency name. `layout none` intentionally has no path. */
	name?: string;
	/** Raw Liquid expression/tag markup that produced this dependency. */
	source: string;
	/** True for literal names, false for dynamic expressions. */
	static: boolean;
	span: SourceSpan;
};

export type PlainLiquidAst = {
	file: string;
	liquidAst: DocumentNode;
	/** No Nazare nodes are produced by this frontend; kept for shared schema checks. */
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

type LiquidTagLike = {
	name?: unknown;
	markup?: unknown;
	position: { start: number; end: number };
};

type RenderMarkupLike = {
	type: "RenderMarkup";
	snippet?: unknown;
};

type DependencyExtraction =
	| { kind: "static"; name: string }
	| { kind: "dynamic" }
	| { kind: "layout-none" }
	| { kind: "unsupported" };

export function parsePlainLiquid(
	source: string,
	file: string,
	options: PlainLiquidOptions = {},
): PlainLiquidAst {
	const parseMode = options.parseMode ?? "strict";
	const diagnostics: Diagnostic[] = [];
	let ast: DocumentNode;
	let factsCollected = true;
	try {
		ast = toLiquidHtmlAST(source, {
			mode: parseMode,
			allowUnclosedDocumentNode: parseMode === "tolerant",
		});
	} catch (error) {
		factsCollected = false;
		diagnostics.push(parseLiquidError(error, file));
		diagnostics.push(plainLiquidFactsSkipped(file));
		ast = emptyAst();
	}

	const schema = factsCollected
		? extractAuthoredSchema(ast, source, file)
		: undefined;
	const settingsScan = factsCollected
		? scanSettingsReadsFromLiquidAst(ast, source, file)
		: { reads: [], diagnostics: [] };
	const dependencyCollection = factsCollected
		? collectDependencies(ast, source, file)
		: { dependencies: [], diagnostics: [] };
	diagnostics.push(
		...settingsScan.diagnostics,
		...dependencyCollection.diagnostics,
	);

	return {
		file,
		liquidAst: ast,
		nodes: [],
		schema,
		settingsReads: settingsScan.reads,
		dependencies: dependencyCollection.dependencies,
		diagnostics,
		notes: [],
		factsCollected,
		parseMode,
	};
}

function plainLiquidFactsSkipped(file: string): Diagnostic {
	const position = { line: 1, column: 1 };
	return {
		severity: "info",
		code: "PLAIN_LIQUID_FACTS_SKIPPED",
		message:
			"Plain Liquid schema, settings, and dependency facts were not collected because parsing failed",
		span: { file, start: position, end: position },
	};
}

function invalidDependencyName(
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

function unsupportedDependencyMarkup(
	kind: PlainLiquidDependencyKind,
	span: SourceSpan,
): Diagnostic {
	return {
		severity: "error",
		code: "PLAIN_LIQUID_UNSUPPORTED_DEPENDENCY_MARKUP",
		message: `Could not classify ${kind} dependency markup; dependency facts are incomplete`,
		span,
	};
}

function emptyAst(): DocumentNode {
	return toLiquidHtmlAST("", {
		mode: "tolerant",
		allowUnclosedDocumentNode: true,
	});
}

function collectDependencies(
	ast: DocumentNode,
	source: string,
	file: string,
): { dependencies: PlainLiquidDependency[]; diagnostics: Diagnostic[] } {
	const dependencies: PlainLiquidDependency[] = [];
	const diagnostics: Diagnostic[] = [];
	walk(ast, (node) => {
		if (!isLiquidTag(node)) return;
		if (typeof node.name !== "string") return;
		if (!isDependencyTag(node.name)) return;

		const kind = dependencyKind(node.name);
		const extraction = dependencyExtraction(kind, node.markup);
		const span = spanFromOffsets(source, file, node.position);
		if (extraction.kind === "unsupported") {
			diagnostics.push(unsupportedDependencyMarkup(kind, span));
		}
		const name = dependencyName(extraction);
		const validation = name
			? validateDependencyName(kind, name)
			: { valid: true as const };
		if (!validation.valid) {
			diagnostics.push(
				invalidDependencyName(kind, name ?? "", span, validation.reason),
			);
		}
		dependencies.push({
			kind,
			name,
			path: name && validation.valid ? dependencyPath(kind, name) : undefined,
			source: liquidTagMarkup(source, node.position, node.name),
			static: extraction.kind === "static" || extraction.kind === "layout-none",
			span,
		});
	});
	return { dependencies, diagnostics };
}

function isLiquidTag(node: unknown): node is LiquidTagLike {
	return (
		!!node &&
		(node as { type?: unknown }).type === NodeTypes.LiquidTag &&
		typeof (node as { position?: { start?: unknown; end?: unknown } }).position
			?.start === "number" &&
		typeof (node as { position?: { start?: unknown; end?: unknown } }).position
			?.end === "number"
	);
}

function dependencyExtraction(
	kind: PlainLiquidDependencyKind,
	markup: unknown,
): DependencyExtraction {
	const target = isRenderMarkup(markup) ? markup.snippet : markup;
	if (isLiquidString(target)) return { kind: "static", name: target.value };
	if (isVariableLookup(target)) {
		if (kind === "layout" && target.name === "none") {
			return { kind: "layout-none" };
		}
		return { kind: "dynamic" };
	}
	return { kind: "unsupported" };
}

function dependencyName(extraction: DependencyExtraction): string | undefined {
	if (extraction.kind === "static") return extraction.name;
	if (extraction.kind === "layout-none") return "none";
	return undefined;
}

function isRenderMarkup(markup: unknown): markup is RenderMarkupLike {
	return !!markup && (markup as { type?: unknown }).type === "RenderMarkup";
}

function isDependencyTag(tagName: string): boolean {
	return (
		tagName === "render" ||
		tagName === "include" ||
		tagName === "section" ||
		tagName === "sections" ||
		tagName === "layout"
	);
}

function dependencyKind(tagName: string): PlainLiquidDependencyKind {
	if (tagName === "render" || tagName === "include") return "snippet";
	if (tagName === "section") return "section";
	if (tagName === "sections") return "section-group";
	return "layout";
}

function validateDependencyName(
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

function dependencyPath(
	kind: PlainLiquidDependencyKind,
	name: string,
): string | undefined {
	if (kind === "layout" && name === "none") return undefined;
	if (kind === "snippet") return `snippets/${name}.liquid`;
	if (kind === "section") return `sections/${name}.liquid`;
	if (kind === "section-group") return `sections/${name}.json`;
	return `layout/${name}.liquid`;
}
