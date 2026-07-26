import type { Diagnostic } from "@nazare/core";
import type { EmbeddedRegion } from "@nazare/source";
import {
	type DocumentNode,
	type LiquidHtmlNode,
	NodeTypes,
	toLiquidHtmlAST,
	walk,
} from "@shopify/liquid-html-parser";
import { controlFlowNotLowered, htmlNotPromoted } from "./diagnostics.js";
import { parseLiquidError } from "./liquid-ast.js";
import { spanFromOffsets } from "./source.js";

export type ShopifyCompatibilityResult = {
	ast: DocumentNode;
	diagnostics: Diagnostic[];
	notes: Diagnostic[];
};

/** Temporary opaque LiquidHTML tree; Nazare facts never come from this parse. */
export function parseShopifyCompatibility(
	source: string,
	file: string,
	embeddedRegions: readonly EmbeddedRegion[],
): ShopifyCompatibilityResult {
	const masked = maskEmbeddedRegions(source, embeddedRegions);
	let ast: DocumentNode;
	const diagnostics: Diagnostic[] = [];
	try {
		ast = toLiquidHtmlAST(masked, {
			mode: "tolerant",
			allowUnclosedDocumentNode: true,
		});
	} catch (error) {
		diagnostics.push(parseLiquidError(error, file));
		ast = toLiquidHtmlAST("", {
			mode: "tolerant",
			allowUnclosedDocumentNode: true,
		});
	}
	return { ast, diagnostics, notes: compatibilityNotes(ast, source, file) };
}

function maskEmbeddedRegions(
	source: string,
	regions: readonly EmbeddedRegion[],
): string {
	const masked = source.split("");
	for (const region of regions) {
		const end = region.closeRange?.end ?? source.length;
		for (let offset = region.openRange.start; offset < end; offset += 1) {
			if (masked[offset] !== "\n" && masked[offset] !== "\r") {
				masked[offset] = " ";
			}
		}
	}
	return masked.join("");
}

function compatibilityNotes(
	ast: DocumentNode,
	source: string,
	file: string,
): Diagnostic[] {
	let controlFlow: LiquidHtmlNode | undefined;
	let html: LiquidHtmlNode | undefined;
	walk(ast, (node) => {
		if (!controlFlow && isControlFlow(node)) controlFlow = node;
		if (!html && isHtml(node)) html = node;
	});
	const notes: Diagnostic[] = [];
	if (controlFlow) {
		notes.push(
			controlFlowNotLowered(
				spanFromOffsets(source, file, controlFlow.position),
			),
		);
	}
	if (html) {
		notes.push(htmlNotPromoted(spanFromOffsets(source, file, html.position)));
	}
	return notes;
}

function isControlFlow(node: LiquidHtmlNode): boolean {
	if (node.type === NodeTypes.LiquidBranch) return true;
	if (node.type !== NodeTypes.LiquidTag) return false;
	const name = (node as { name?: unknown }).name;
	return name === "if" || name === "unless" || name === "case";
}

function isHtml(node: LiquidHtmlNode): boolean {
	return (
		node.type === NodeTypes.HtmlElement ||
		node.type === NodeTypes.HtmlVoidElement ||
		node.type === NodeTypes.HtmlSelfClosingElement
	);
}
