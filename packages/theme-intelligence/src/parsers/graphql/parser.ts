import { type DocumentNode, GraphQLError, parse } from "graphql";
import type {
	ParsedDocument,
	ParserInput,
	ParserProvider,
	ParserResult,
} from "../parser.js";

export type GraphqlDocument = ParsedDocument<DocumentNode>;

export class GraphqlParserProvider implements ParserProvider<GraphqlDocument> {
	readonly id = "graphql";
	readonly version = 1;
	readonly languages = ["graphql"] as const;

	accepts(path: string, language?: string): boolean {
		return (
			language === "graphql" ||
			(!language && (path.endsWith(".graphql") || path.endsWith(".gql")))
		);
	}

	parse(input: ParserInput): ParserResult<GraphqlDocument> {
		try {
			return {
				ok: true,
				document: {
					path: input.path,
					language: "graphql",
					source: input.source,
					syntax: parse(input.source),
					diagnostics: [],
				},
			};
		} catch (error) {
			if (!(error instanceof GraphQLError)) throw error;
			const start = error.positions?.[0] ?? 0;
			return {
				ok: false,
				diagnostics: [
					{
						code: "GRAPHQL_PARSE_ERROR",
						message: error.message,
						range: {
							start,
							end: Math.min(input.source.length, start + 1),
						},
					},
				],
			};
		}
	}
}
