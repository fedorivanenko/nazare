import type { Diagnostic } from "@nazare/core";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { spanFromOffsets } from "../source.js";
import type {
	AnalyzedSourceFact,
	SourceAnalysisUncertainty,
} from "../source-analysis-types.js";

export type ThemeCssAnalysis = {
	facts: AnalyzedSourceFact[];
	issues: Diagnostic[];
	uncertainty: SourceAnalysisUncertainty[];
};

export function analyzeThemeCss(
	path: string,
	source: string,
): ThemeCssAnalysis {
	let root: postcss.Root;
	try {
		root = postcss.parse(source, { from: path });
	} catch (error) {
		return {
			facts: [],
			issues: [cssParseIssue(path, source, error)],
			uncertainty: [],
		};
	}
	const facts: AnalyzedSourceFact[] = [];
	const issues: Diagnostic[] = [];
	const uncertainty: SourceAnalysisUncertainty[] = [];
	const lineStarts = lineStartOffsets(source);
	root.walkRules((rule) => {
		const ruleOffset = rule.source?.start
			? offsetFromLineColumn(
					lineStarts,
					rule.source.start.line,
					rule.source.start.column,
				)
			: source.indexOf(rule.selector);
		try {
			const selectors = selectorParser().astSync(rule.selector);
			selectors.walkClasses((node) => {
				pushDomFact("class", node.value, node.sourceIndex ?? 0);
			});
			selectors.walkIds((node) => {
				pushDomFact("id", node.value, node.sourceIndex ?? 0);
			});
			selectors.walkAttributes((node) => {
				if (node.attribute)
					pushDomFact("attribute", node.attribute, node.sourceIndex ?? 0);
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			issues.push({
				severity: "error",
				code: "THEME_CSS_SELECTOR_PARSE_ERROR",
				message: `Invalid CSS selector in ${path}: ${message}`,
				phase: "parse",
				span: spanFromOffsets(source, path, {
					start: Math.max(0, ruleOffset),
					end: Math.max(0, ruleOffset) + rule.selector.length,
				}),
			});
		}

		function pushDomFact(
			hookKind: "class" | "id" | "attribute",
			name: string,
			selectorOffset: number,
		): void {
			const start = Math.max(0, ruleOffset + selectorOffset);
			facts.push({
				kind: "behavior",
				fromPath: path,
				subjectKind: "domHook",
				hookKind,
				operation: "selects",
				name,
				span: spanFromOffsets(source, path, {
					start,
					end: Math.min(source.length, start + name.length + 1),
				}),
				extractor: "postcss-selector-parser",
			});
		}
	});
	root.walkDecls((declaration) => {
		const declarationOffset = declaration.source?.start
			? offsetFromLineColumn(
					lineStarts,
					declaration.source.start.line,
					declaration.source.start.column,
				)
			: 0;
		const declarationSpan = spanFromOffsets(source, path, {
			start: declarationOffset,
			end: Math.min(
				source.length,
				declarationOffset + declaration.toString().length,
			),
		});
		if (declaration.prop.startsWith("--")) {
			facts.push({
				kind: "behavior",
				fromPath: path,
				subjectKind: "customProperty",
				operation: "defines",
				name: declaration.prop,
				span: declarationSpan,
				extractor: "postcss",
			});
		}
		for (const name of cssVariableReads(declaration.value)) {
			facts.push({
				kind: "behavior",
				fromPath: path,
				subjectKind: "customProperty",
				operation: "reads",
				name,
				span: declarationSpan,
				extractor: "postcss",
			});
		}
	});
	return { facts, issues, uncertainty };
}

function cssVariableReads(value: string): string[] {
	const names: string[] = [];
	const pattern = /\bvar\(\s*(--[A-Za-z0-9_-]+)/g;
	let match = pattern.exec(value);
	while (match) {
		if (match[1]) names.push(match[1]);
		match = pattern.exec(value);
	}
	return names;
}

function cssParseIssue(
	path: string,
	source: string,
	error: unknown,
): Diagnostic {
	const candidate = error as {
		message?: unknown;
		line?: unknown;
		column?: unknown;
	};
	const message =
		typeof candidate.message === "string" ? candidate.message : String(error);
	const line = typeof candidate.line === "number" ? candidate.line : 1;
	const column = typeof candidate.column === "number" ? candidate.column : 1;
	const starts = lineStartOffsets(source);
	const start = offsetFromLineColumn(starts, line, column);
	return {
		severity: "error",
		code: "THEME_CSS_PARSE_ERROR",
		message: `Invalid CSS in ${path}: ${message}`,
		phase: "parse",
		span: spanFromOffsets(source, path, {
			start,
			end: Math.min(source.length, start + 1),
		}),
	};
}

function lineStartOffsets(source: string): number[] {
	const offsets = [0];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === "\n") offsets.push(index + 1);
	}
	return offsets;
}

function offsetFromLineColumn(
	lineStarts: number[],
	line: number,
	column: number,
): number {
	return (lineStarts[line - 1] ?? 0) + Math.max(0, column - 1);
}
