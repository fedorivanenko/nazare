// Finds module syntax in behavior scripts that the bundler cannot resolve:
// bare (package) specifiers — only ./-relative files inside the component
// directory are bundleable. Relative imports, named exports, type-only
// imports, and `export default island(...)` are all fine. Uses the TS
// parser, not a regex — comments, strings, and type-only forms are
// distinguished correctly.
import ts from "typescript";

export type ModuleSyntaxFinding = {
	/** The offending statement's leading text, for the diagnostic message. */
	text: string;
	/** 0-based line/character within the script source. */
	line: number;
	character: number;
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

	for (const statement of sourceFile.statements) {
		if (ts.isImportEqualsDeclaration(statement)) {
			findings.push(finding(sourceFile, statement));
			continue;
		}

		let specifier: ts.Expression | undefined;
		if (ts.isImportDeclaration(statement)) {
			if (statement.importClause?.isTypeOnly) continue;
			specifier = statement.moduleSpecifier;
		}
		if (ts.isExportDeclaration(statement)) {
			if (statement.isTypeOnly || !statement.moduleSpecifier) continue;
			specifier = statement.moduleSpecifier;
		}
		if (!specifier) continue;
		if (ts.isStringLiteral(specifier) && specifier.text.startsWith(".")) {
			continue; // relative: the bundler resolves it
		}
		findings.push(finding(sourceFile, statement));
	}

	return findings;
}

function finding(
	sourceFile: ts.SourceFile,
	statement: ts.Statement,
): ModuleSyntaxFinding {
	const start = statement.getStart(sourceFile);
	const position = sourceFile.getLineAndCharacterOfPosition(start);
	const text = statement.getText(sourceFile);
	return {
		text: text.length > 60 ? `${text.slice(0, 57)}...` : text.split("\n")[0],
		line: position.line,
		character: position.character,
	};
}
