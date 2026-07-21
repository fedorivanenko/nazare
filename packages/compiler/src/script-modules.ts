// Finds module syntax in behavior scripts that nothing downstream can
// handle. The bundler resolves static relative imports only, so two shapes
// are rejected here: legacy `import x = require(...)`, and dynamic
// `import(...)` — the latter transpiles to a `require` call that does not
// exist in the emitted wrapper and would throw in the shopper's browser.
// Unresolvable specifiers are reported by the bundler (emit) and the
// multi-module type check, which know the resolvers; this fast-path check
// cannot.
import ts from "typescript";

export type ModuleSyntaxFinding = {
	/** The offending expression's leading text, for the diagnostic message. */
	text: string;
	/** Character offsets within the script source. */
	start: number;
	end: number;
};

export function findUnsupportedModuleSyntax(
	source: string,
): ModuleSyntaxFinding[] {
	const sourceFile = ts.createSourceFile(
		"script.ts",
		source,
		ts.ScriptTarget.ES2018,
		true,
	);
	const findings: ModuleSyntaxFinding[] = [];

	const record = (node: ts.Node): void => {
		findings.push({
			text: truncated(node.getText(sourceFile)),
			start: node.getStart(sourceFile),
			end: node.getEnd(),
		});
	};

	const visit = (node: ts.Node): void => {
		if (ts.isImportEqualsDeclaration(node)) record(node);
		if (
			ts.isCallExpression(node) &&
			node.expression.kind === ts.SyntaxKind.ImportKeyword
		) {
			record(node);
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return findings;
}

function truncated(text: string): string {
	return text.length > 60 ? `${text.slice(0, 57)}...` : text.split("\n")[0];
}
