import type Parser from "tree-sitter";
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
import Liquid from "./grammar.cjs";

export type LiquidDocument = ParsedDocument<Parser.Tree>;

export class LiquidParserProvider implements ParserProvider<LiquidDocument> {
	readonly id = "tree-sitter-liquid";
	readonly version = 1;
	readonly languages = ["liquid"] as const;

	readonly #parser = createTreeSitterParser(Liquid);

	accepts(path: string, language?: string): boolean {
		return language === "liquid" || (!language && path.endsWith(".liquid"));
	}

	parse(input: ParserInput): ParserResult<LiquidDocument> {
		const syntax = parseTreeSitterSource(this.#parser, input.source);
		return {
			ok: true,
			document: {
				path: input.path,
				language: "liquid",
				source: input.source,
				syntax,
				diagnostics: treeSitterDiagnostics(syntax, input.source, "Liquid"),
			},
		};
	}
}
