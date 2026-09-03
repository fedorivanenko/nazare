import type Parser from "tree-sitter";
import Html from "tree-sitter-html";
import type {
	ParsedDocument,
	ParserInput,
	ParserProvider,
	ParserResult,
} from "../parser.js";
import {
	createTreeSitterParser,
	parseTreeSitterSource,
	treeSitterDiagnostics,
} from "../tree-sitter.js";

export type HtmlDocument = ParsedDocument<Parser.Tree>;

export class HtmlParserProvider implements ParserProvider<HtmlDocument> {
	readonly id = "tree-sitter-html";
	readonly version = 1;
	readonly languages = ["html"] as const;

	readonly #parser = createTreeSitterParser(Html);

	accepts(path: string, language?: string): boolean {
		return language === "html" || (!language && path.endsWith(".html"));
	}

	parse(input: ParserInput): ParserResult<HtmlDocument> {
		const syntax = parseTreeSitterSource(this.#parser, input.source);
		return {
			ok: true,
			document: {
				path: input.path,
				language: "html",
				source: input.source,
				syntax,
				diagnostics: treeSitterDiagnostics(syntax, input.source, "HTML"),
			},
		};
	}
}
