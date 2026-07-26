import type { Diagnostic } from "@nazare/core";
import {
	createDefaultSourceParserRegistry,
	type NazareSyntaxFact,
	nazareSyntaxFacts,
	parseSourceDocument,
} from "@nazare/source";
import type { NazareAst, NazareNode } from "./ast.js";
import { parseLiquidCrash } from "./diagnostics.js";
import {
	parseNazareImportTag,
	parseNazareLiquid,
	parsePassedProps,
	parseProps,
} from "./parser.js";
import { scanScript } from "./script-scan.js";
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
): TreeSitterNazareProjection {
	// Temporary compatibility parse owns Shopify's opaque LiquidHTML tree,
	// authored schema, settings reads, notes, and semantic parse diagnostics.
	// It does not own the returned Nazare nodes.
	const compatibility = parseNazareLiquid(source, file);
	const document = parseSourceDocument(
		createDefaultSourceParserRegistry(),
		file,
		"nazare-liquid",
		source,
	);
	const syntax = nazareSyntaxFacts(document);
	const treeIssues: Diagnostic[] = document.issues.map((issue) =>
		parseLiquidCrash(
			`${issue.code}: ${issue.message}`,
			spanFromOffsets(source, file, issue.range),
		),
	);
	const nodes = syntax.authoritative
		? projectFacts(syntax.facts, source, file)
		: [];

	return {
		ast: {
			...compatibility,
			nodes,
			diagnostics: [...compatibility.diagnostics, ...treeIssues],
		},
		authoritative: syntax.authoritative,
		factCount: syntax.facts.length,
	};
}

function projectFacts(
	facts: readonly NazareSyntaxFact[],
	source: string,
	file: string,
): NazareNode[] {
	const nodes: NazareNode[] = [];
	const semanticDiagnostics: Diagnostic[] = [];
	let componentDeclared = false;

	for (const fact of facts) {
		const span = spanFromOffsets(source, file, fact.range);
		switch (fact.kind) {
			case "component":
				if (!componentDeclared) {
					componentDeclared = true;
					nodes.push({
						type: "NazareComponent",
						componentKind: fact.componentKind,
						span,
					});
				}
				break;
			case "import": {
				const imported = parseNazareImportTag(
					`${fact.localName} from ${JSON.stringify(fact.specifier)}`,
					file,
					span,
					semanticDiagnostics,
				);
				if (imported) nodes.push(imported);
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

	return nodes.sort(
		(left, right) =>
			left.span.start.line - right.span.start.line ||
			left.span.start.column - right.span.start.column,
	);
}
