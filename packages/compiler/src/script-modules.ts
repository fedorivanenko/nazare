// Finds module syntax in behavior scripts that would break at runtime:
// emission wraps scripts in an IIFE and no bundler exists yet, so a real
// import or a named export survives transpilation and throws in the theme.
// Only `export default island(...)` (rewritten at emit) and type-only
// imports (erased by transpilation) are allowed. Uses the TS parser, not a
// regex — comments, strings, and type-only forms are distinguished
// correctly.
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
		if (ts.isImportDeclaration(statement)) {
			if (statement.importClause?.isTypeOnly) continue;
			findings.push(finding(sourceFile, statement));
			continue;
		}
		if (ts.isImportEqualsDeclaration(statement)) {
			findings.push(finding(sourceFile, statement));
			continue;
		}
		// export default island(...) is the entry point; everything else that
		// exports breaks inside the emitted IIFE.
		if (ts.isExportAssignment(statement)) continue;
		if (ts.isExportDeclaration(statement)) {
			if (statement.isTypeOnly) continue;
			findings.push(finding(sourceFile, statement));
			continue;
		}
		if (
			ts.canHaveModifiers(statement) &&
			ts
				.getModifiers(statement)
				?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
		) {
			findings.push(finding(sourceFile, statement));
		}
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
