import {
	type Node,
	type ParseError,
	parseTree,
	printParseErrorCode,
} from "jsonc-parser";
import type {
	ParsedDocument,
	ParserInput,
	ParserProvider,
	ParserResult,
} from "../parser.js";

export type JsonDocument = ParsedDocument<Node>;

export class JsonParserProvider implements ParserProvider<JsonDocument> {
	readonly id = "jsonc-parser";
	readonly version = 1;
	readonly languages = ["json", "jsonc"] as const;

	accepts(path: string, language?: string): boolean {
		return (
			language === "json" ||
			language === "jsonc" ||
			(!language && (path.endsWith(".json") || path.endsWith(".jsonc")))
		);
	}

	parse(input: ParserInput): ParserResult<JsonDocument> {
		const errors: ParseError[] = [];
		const syntax = parseTree(input.source, errors, {
			allowEmptyContent: false,
			allowTrailingComma: true,
			disallowComments: false,
		});
		const diagnostics = errors.map((error) => ({
			code: `JSON_${printParseErrorCode(error.error)}`,
			message: printParseErrorCode(error.error),
			range: {
				start: error.offset,
				end: error.offset + Math.max(error.length, 1),
			},
		}));
		if (!syntax) return { ok: false, diagnostics };
		return {
			ok: true,
			document: {
				path: input.path,
				language:
					input.language === "jsonc" || input.path.endsWith(".jsonc")
						? "jsonc"
						: "json",
				source: input.source,
				syntax,
				diagnostics,
			},
		};
	}
}
