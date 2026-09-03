export type SourceRange = {
	start: number;
	end: number;
};

export type ParserInput = {
	path: string;
	source: string;
	language?: string;
};

export type ParserDiagnostic = {
	code: string;
	message: string;
	range: SourceRange;
};

export type ParsedDocument<Syntax> = {
	path: string;
	language: string;
	source: string;
	syntax: Syntax;
	diagnostics: readonly ParserDiagnostic[];
};

export type ParserResult<Document> =
	| { ok: true; document: Document }
	| {
			ok: false;
			diagnostics: readonly ParserDiagnostic[];
	  };

/** Parser provider owns one syntax implementation and exposes no semantic facts. */
export interface ParserProvider<Document> {
	readonly id: string;
	readonly version: number;
	readonly languages: readonly string[];

	accepts(path: string, language?: string): boolean;
	parse(input: ParserInput): ParserResult<Document>;
}
