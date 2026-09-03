import postcss, { type Root } from "postcss";
import scssParser from "postcss-scss";
import type {
	ParsedDocument,
	ParserDiagnostic,
	ParserInput,
	ParserProvider,
	ParserResult,
} from "../parser.js";

export type CssDocument = ParsedDocument<Root>;

export class CssParserProvider implements ParserProvider<CssDocument> {
	readonly id = "postcss";
	readonly version = 1;
	readonly languages = ["css", "scss"] as const;

	accepts(path: string, language?: string): boolean {
		return (
			language === "css" ||
			language === "scss" ||
			(!language && (path.endsWith(".css") || path.endsWith(".scss")))
		);
	}

	parse(input: ParserInput): ParserResult<CssDocument> {
		const language =
			input.language === "scss" || input.path.endsWith(".scss")
				? "scss"
				: "css";
		try {
			const syntax =
				language === "scss"
					? scssParser.parse(input.source, { from: input.path })
					: postcss.parse(input.source, { from: input.path });
			return {
				ok: true,
				document: {
					path: input.path,
					language,
					source: input.source,
					syntax,
					diagnostics: [],
				},
			};
		} catch (error) {
			return {
				ok: false,
				diagnostics: [cssDiagnostic(input.source, error)],
			};
		}
	}
}

function cssDiagnostic(source: string, error: unknown): ParserDiagnostic {
	const candidate = error as {
		message?: unknown;
		reason?: unknown;
		line?: unknown;
		column?: unknown;
		endLine?: unknown;
		endColumn?: unknown;
	};
	const line = numberValue(candidate.line) ?? 1;
	const column = numberValue(candidate.column) ?? 1;
	const start = offsetFromLineColumn(source, line, column);
	const endLine = numberValue(candidate.endLine) ?? line;
	const endColumn = numberValue(candidate.endColumn) ?? column + 1;
	return {
		code: "CSS_PARSE_ERROR",
		message: String(candidate.reason ?? candidate.message ?? error),
		range: {
			start,
			end: Math.max(start, offsetFromLineColumn(source, endLine, endColumn)),
		},
	};
}

function offsetFromLineColumn(
	source: string,
	oneBasedLine: number,
	oneBasedColumn: number,
): number {
	let offset = 0;
	for (let line = 1; line < oneBasedLine && offset < source.length; line++) {
		const newline = source.indexOf("\n", offset);
		if (newline < 0) return source.length;
		offset = newline + 1;
	}
	return Math.min(source.length, offset + Math.max(0, oneBasedColumn - 1));
}

function numberValue(value: unknown): number | undefined {
	return typeof value === "number" ? value : undefined;
}
