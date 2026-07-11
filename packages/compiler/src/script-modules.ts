// Finds module syntax in behavior scripts that nothing downstream can
// handle. Since the bundler resolves both relative files and function
// packages, only legacy `import x = require(...)` remains unsupported.
// Unresolvable specifiers are reported by the bundler (emit) and the
// multi-module type check, which know the resolvers; this fast-path check
// cannot.
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
		if (!ts.isImportEqualsDeclaration(statement)) continue;
		const start = statement.getStart(sourceFile);
		const position = sourceFile.getLineAndCharacterOfPosition(start);
		const text = statement.getText(sourceFile);
		findings.push({
			text: text.length > 60 ? `${text.slice(0, 57)}...` : text.split("\n")[0],
			line: position.line,
			character: position.character,
		});
	}

	return findings;
}
