import type { Diagnostic } from "@nazare/core";
import {
	createDefaultSourceParserRegistry,
	type NazareSyntaxFact,
	nazareSyntaxFacts,
	parseSourceDocument,
} from "@nazare/source";
import { toLiquidHtmlAST } from "@shopify/liquid-html-parser";
import type { NazareAst, NazareNode } from "./ast.js";
import {
	controlFlowNotLowered,
	htmlNotPromoted,
	importBindingCase,
	parseDuplicateComponent,
	parseDuplicateImport,
	parseLiquidCrash,
} from "./diagnostics.js";
import {
	parseNazareImportTag,
	parsePassedProps,
	parseProps,
} from "./parser.js";
import { scanScript } from "./script-scan.js";
import { parseShopifyCompatibility } from "./shopify-compatibility.js";
import { spanFromOffsets } from "./source.js";

export type TreeSitterNazareProjection = {
	ast: NazareAst;
	authoritative: boolean;
	factCount: number;
};

/** Projects mechanical CST facts into the existing semantic AST boundary. */
export function projectTreeSitterNazareAst(
	source: string,
	file: string,
	options: { compatibilityAst?: boolean } = {},
): TreeSitterNazareProjection {
	const document = parseSourceDocument(
		createDefaultSourceParserRegistry(),
		file,
		"nazare-liquid",
		source,
	);
	const syntax = nazareSyntaxFacts(document);
	// Theme inference still consumes the opaque Shopify tree. Ordinary compiler
	// projection and emission use Tree-sitter facts only and skip this parse.
	const compatibility = options.compatibilityAst
		? parseShopifyCompatibility(source, file, document.embeddedRegions)
		: {
				ast: toLiquidHtmlAST("", {
					mode: "tolerant",
					allowUnclosedDocumentNode: true,
				}),
				diagnostics: [],
				notes: syntaxNotes(syntax, source, file),
			};
	const treeIssues: Diagnostic[] = document.issues.map((issue) =>
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
				const text = source.slice(read.range.start, read.range.end);
				const nameOffset = text.lastIndexOf(read.name);
				const range =
					nameOffset < 0
						? read.range
						: {
								start: read.range.start + nameOffset,
								end: read.range.start + nameOffset + read.name.length,
							};
				return {
					object: read.object,
					name: read.name,
					span: spanFromOffsets(source, file, range),
				};
			})
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
			htmlRoots,
			liquidAst: compatibility.ast,
			nodes: projected.nodes,
			settingsReads,
			schema,
			diagnostics: [
				...compatibility.diagnostics,
				...projected.diagnostics,
				...treeIssues,
			],
			notes: compatibility.notes,
		},
		authoritative: syntax.authoritative,
		factCount: syntax.facts.length,
	};
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
					// Compiler compatibility keeps historical default-TypeScript behavior;
					// source injection still classifies only explicit lang=ts as TypeScript.
					lang: /\blang\s*=\s*["']?js["']?/.test(
						source.slice(fact.range.start, fact.bodyRange.start),
					)
						? "js"
						: "ts",
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
