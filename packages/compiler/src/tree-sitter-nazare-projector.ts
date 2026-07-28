import type { Diagnostic } from "@nazare/core";
import {
	createDefaultSourceParserRegistry,
	htmlMarkupFacts,
	type NazareSyntaxFact,
	nazareSyntaxFacts,
	parseSourceDocument,
} from "@nazare/source";
import type { NazareAst, NazareNode } from "./ast.js";
import {
	controlFlowNotLowered,
	htmlNotPromoted,
	importBindingCase,
	parseDuplicateComponent,
	parseDuplicateImport,
	parseInvalidBlocksSlot,
	parseInvalidComponentKind,
	parseInvalidImport,
	parseInvalidRefAttribute,
	parseInvalidRender,
	parseInvalidStylesheetBinding,
	parseLiquidCrash,
	parseUnclosedRawBlock,
} from "./diagnostics.js";
import {
	parseNazareImportTag,
	parsePassedProps,
	parseProps,
} from "./nazare-tag-parser.js";
import { scanScript } from "./script-scan.js";
import { rangeOfTextWithinRange, spanFromOffsets } from "./source.js";

export type TreeSitterNazareProjection = {
	ast: NazareAst;
	authoritative: boolean;
	factCount: number;
};

/** Projects mechanical CST facts into the existing semantic AST boundary. */
export function projectTreeSitterNazareAst(
	source: string,
	file: string,
): TreeSitterNazareProjection {
	const document = parseSourceDocument(
		createDefaultSourceParserRegistry(),
		file,
		"nazare-liquid",
		source,
	);
	const syntax = nazareSyntaxFacts(document);
	const markup = htmlMarkupFacts(document);
	const problemDiagnostics = syntax.problems.map((problem) => {
		const span = spanFromOffsets(source, file, problem.range);
		switch (problem.kind) {
			case "unclosed-raw-block":
				return parseUnclosedRawBlock(
					problem.block,
					problem.block === "script" ? "endscript" : "endstylesheet",
					span,
				);
			case "component":
				return parseInvalidComponentKind(problem.markup, span);
			case "import":
				return parseInvalidImport(problem.markup, span);
			case "render":
				return parseInvalidRender(problem.markup, span);
			case "blocks":
				return parseInvalidBlocksSlot(problem.markup, span);
			case "stylesheet":
				return parseInvalidStylesheetBinding(problem.markup, span);
			case "script-language":
				return {
					severity: "error" as const,
					code: "NAZARE_PARSE_SCRIPT_LANGUAGE",
					message: `Unsupported script language ${problem.value}; expected "js" or "ts"`,
					span,
				};
			case "attribute":
				return parseInvalidRefAttribute(
					problem.reason === "dynamic"
						? `${problem.attribute} value must be a static string, not Liquid output`
						: `${problem.attribute} value "${problem.value}" is not a valid identifier`,
					span,
				);
			default:
				return assertNever(problem);
		}
	});
	const treeIssues: Diagnostic[] = document.issues
		.filter(
			(issue) =>
				!syntax.problems.some(
					(problem) =>
						issue.range.start < problem.range.end &&
						problem.range.start < issue.range.end,
				),
		)
		.map((issue) =>
			parseLiquidCrash(
				`${issue.code}: ${issue.message}`,
				spanFromOffsets(source, file, issue.range),
			),
		);
	const projected = syntax.authoritative
		? projectFacts(syntax.facts, source, file)
		: { nodes: [], diagnostics: [] };
	const settingsReads = syntax.authoritative
		? syntax.liquid.settingsReads.map((read) => {
				const range = rangeOfTextWithinRange(source, read.name, read.range);
				return {
					object: read.object,
					name: read.name,
					span: spanFromOffsets(source, file, range),
				};
			})
		: [];
	const htmlElements = syntax.authoritative
		? syntax.facts
				.filter((fact) => fact.kind === "html-element")
				.map((fact) => ({
					tagName: fact.tagName.toLowerCase(),
					span: spanFromOffsets(source, file, fact.range),
				}))
		: [];
	const htmlRoots = syntax.authoritative
		? syntax.facts
				.filter((fact) => fact.kind === "html-root")
				.map((fact) => ({
					tagEnd: fact.tagEnd,
					tagName: fact.tagName,
					marker: fact.markerRange,
				}))
		: [];
	const schema = syntax.liquid.schema
		? {
				source: syntax.liquid.schema.body,
				span: spanFromOffsets(source, file, syntax.liquid.schema.range),
			}
		: undefined;

	return {
		ast: {
			file,
			source,
			htmlElements,
			htmlRoots,
			liquidFacts: syntax.liquid,
			markupFacts: markup,
			nodes: projected.nodes,
			settingsReads,
			schema,
			diagnostics: [
				...projected.diagnostics,
				...problemDiagnostics,
				...treeIssues,
			],
			notes: syntaxNotes(syntax, source, file),
		},
		authoritative: syntax.authoritative,
		factCount: syntax.facts.length,
	};
}

function assertNever(value: never): never {
	throw new Error(`Unhandled Nazare syntax problem: ${JSON.stringify(value)}`);
}

function syntaxNotes(
	syntax: ReturnType<typeof nazareSyntaxFacts>,
	source: string,
	file: string,
): Diagnostic[] {
	if (!syntax.authoritative) return [];
	const candidates: { start: number; diagnostic: Diagnostic }[] = [];
	const conditional = syntax.liquid.conditionals[0];
	if (conditional) {
		candidates.push({
			start: conditional.range.start,
			diagnostic: controlFlowNotLowered(
				spanFromOffsets(source, file, conditional.range),
			),
		});
	}
	const htmlElements = syntax.facts.filter(
		(fact) => fact.kind === "html-element",
	);
	const html = htmlElements.find((fact) => fact.leaf) ?? htmlElements[0];
	if (html) {
		candidates.push({
			start: html.range.start,
			diagnostic: htmlNotPromoted(spanFromOffsets(source, file, html.range)),
		});
	}
	return candidates
		.sort((left, right) => left.start - right.start)
		.map((candidate) => candidate.diagnostic);
}

function projectFacts(
	facts: readonly NazareSyntaxFact[],
	source: string,
	file: string,
): { nodes: NazareNode[]; diagnostics: Diagnostic[] } {
	const nodes: NazareNode[] = [];
	const semanticDiagnostics: Diagnostic[] = [];
	const importLocalNames = new Set<string>();
	let componentDeclared = false;

	for (const fact of facts) {
		const span = spanFromOffsets(source, file, fact.range);
		switch (fact.kind) {
			case "component":
				if (componentDeclared) {
					semanticDiagnostics.push(parseDuplicateComponent(span));
					break;
				}
				componentDeclared = true;
				nodes.push({
					type: "NazareComponent",
					componentKind: fact.componentKind,
					span,
				});
				break;
			case "import": {
				const imported = parseNazareImportTag(
					`${fact.localName} from ${JSON.stringify(fact.specifier)}`,
					file,
					span,
					semanticDiagnostics,
				);
				if (imported) {
					if (importLocalNames.has(imported.localName)) {
						semanticDiagnostics.push(
							parseDuplicateImport(imported.localName, span),
						);
					} else {
						importLocalNames.add(imported.localName);
					}
					nodes.push(imported);
				}
				break;
			}
			case "props":
				nodes.push({
					type: "NazareProps",
					props: parseProps(
						fact.payload,
						source,
						file,
						fact.payloadRange.start,
						semanticDiagnostics,
					),
					span,
				});
				break;
			case "render": {
				const body = fact.payload.slice(1, -1);
				nodes.push({
					type: "NazareRender",
					target: fact.target,
					props: parsePassedProps(
						body,
						source,
						file,
						fact.payloadRange.start + 1,
						semanticDiagnostics,
					),
					reachability: fact.reachability,
					span,
				});
				break;
			}
			case "blocks":
				nodes.push({
					type: "NazareBlocks",
					blockNames: fact.blockNames,
					span,
				});
				break;
			case "script": {
				const scan = scanScript(fact.body);
				nodes.push({
					type: "NazareScript",
					lang: fact.language === "javascript" ? "js" : "ts",
					source: fact.body,
					refAccesses: scan.refAccesses.map((access) => ({
						name: access.name,
						span: spanFromOffsets(source, file, {
							start: fact.bodyRange.start + access.start,
							end: fact.bodyRange.start + access.end,
						}),
					})),
					dataAccesses: scan.dataAccesses.map((access) => ({
						ref: access.ref,
						property: access.property,
						span: spanFromOffsets(source, file, {
							start: fact.bodyRange.start + access.start,
							end: fact.bodyRange.start + access.end,
						}),
					})),
					span,
					bodySpan: spanFromOffsets(source, file, fact.bodyRange),
				});
				break;
			}
			case "stylesheet":
				if (fact.bindingName && /^[A-Z]/.test(fact.bindingName)) {
					semanticDiagnostics.push(importBindingCase(fact.bindingName, span));
				}
				nodes.push({
					type: "NazareStyle",
					source: fact.body,
					bindingName: fact.bindingName,
					span,
					bodySpan: spanFromOffsets(source, file, fact.bodyRange),
				});
				break;
			case "reference":
				nodes.push({
					type: "NazareReference",
					target: fact.target,
					binding: fact.binding,
					name: fact.name,
					form: fact.form,
					span,
				});
				break;
			case "element-ref":
				nodes.push({
					type: "NazareElementRef",
					name: fact.name,
					tagName: fact.tagName,
					dataBindings: fact.dataBindings.map((binding) => ({
						attribute: binding.attribute,
						property: binding.property,
						expression: binding.expression,
						span: spanFromOffsets(source, file, binding.range),
					})),
					span,
				});
				break;
			case "html-element":
			case "html-root":
				break;
			case "root-marker":
				nodes.push({ type: "NazareRootMarker", tagName: fact.tagName, span });
				break;
			case "island":
				nodes.push({
					type: "NazareIsland",
					name: fact.name,
					tagName: fact.tagName,
					span,
				});
				break;
		}
	}

	return {
		nodes: nodes.sort(
			(left, right) =>
				left.span.start.line - right.span.start.line ||
				left.span.start.column - right.span.start.column,
		),
		diagnostics: semanticDiagnostics,
	};
}
