// Finds module syntax that Nazare's JavaScript bundler cannot execute.
import type { Program } from "acorn";
import { type JavaScriptNode, walkJavaScript } from "./javascript-ast.js";

export type ModuleSyntaxFinding = {
	text: string;
	start: number;
	end: number;
};

export function findUnsupportedModuleSyntax(
	source: string,
	program: Program,
): ModuleSyntaxFinding[] {
	const findings: ModuleSyntaxFinding[] = [];
	walkJavaScript(program, (node) => {
		if (node.type === "ImportExpression") record(node);
		if (
			node.type === "CallExpression" &&
			identifierName(node.callee) === "require"
		) {
			record(node);
		}
	});
	return findings;

	function record(node: JavaScriptNode): void {
		findings.push({
			text: truncated(source.slice(node.start, node.end)),
			start: node.start,
			end: node.end,
		});
	}
}

function identifierName(value: unknown): string | undefined {
	return value &&
		typeof value === "object" &&
		"type" in value &&
		value.type === "Identifier" &&
		"name" in value &&
		typeof value.name === "string"
		? value.name
		: undefined;
}

function truncated(text: string): string {
	return text.length > 60 ? `${text.slice(0, 57)}...` : text.split("\n")[0];
}
