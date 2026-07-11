// AST-based scanning of behavior scripts. refs.<name> and data.<ref>.<prop>
// accesses are real property-access expressions — occurrences in comments,
// strings, or unrelated identifiers do not count. Parse-only (no type
// checking), so this stays in the fast compile path. Shadowing a context
// name with a local variable called refs/data is not scope-analyzed; don't.
import ts from "typescript";

export type ScannedRefAccess = {
	name: string;
	start: number;
	end: number;
};

export type ScannedDataAccess = {
	ref: string;
	property: string;
	start: number;
	end: number;
};

export type ScriptScan = {
	refAccesses: ScannedRefAccess[];
	dataAccesses: ScannedDataAccess[];
};

export function scanScript(source: string): ScriptScan {
	const sourceFile = parse(source);
	const refAccesses: ScannedRefAccess[] = [];
	const dataAccesses: ScannedDataAccess[] = [];

	const visit = (node: ts.Node): void => {
		if (ts.isPropertyAccessExpression(node)) {
			const base = node.expression;
			if (ts.isIdentifier(base) && base.text === "refs") {
				refAccesses.push({
					name: node.name.text,
					start: node.getStart(sourceFile),
					end: node.getEnd(),
				});
			}
			if (
				ts.isPropertyAccessExpression(base) &&
				ts.isIdentifier(base.expression) &&
				base.expression.text === "data"
			) {
				dataAccesses.push({
					ref: base.name.text,
					property: node.name.text,
					start: node.getStart(sourceFile),
					end: node.getEnd(),
				});
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);

	return { refAccesses, dataAccesses };
}

export function hasDefaultExport(source: string): boolean {
	return parse(source).statements.some(
		(statement) =>
			ts.isExportAssignment(statement) && !statement.isExportEquals,
	);
}

function parse(source: string): ts.SourceFile {
	return ts.createSourceFile(
		"script.ts",
		source,
		ts.ScriptTarget.ES2018,
		true,
	);
}
