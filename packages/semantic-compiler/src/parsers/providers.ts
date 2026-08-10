import { type CssDocument, CssParserProvider } from "./css/parser.js";
import {
	type GraphqlDocument,
	GraphqlParserProvider,
} from "./graphql/parser.js";
import { type HtmlDocument, HtmlParserProvider } from "./html/parser.js";
import {
	type JavaScriptDocument,
	JavaScriptParserProvider,
} from "./javascript/parser.js";
import { type JsonDocument, JsonParserProvider } from "./json/parser.js";
import { type LiquidDocument, LiquidParserProvider } from "./liquid/parser.js";
import type { ParserProvider } from "./parser.js";

export type SupportedDocument =
	| CssDocument
	| GraphqlDocument
	| HtmlDocument
	| JavaScriptDocument
	| JsonDocument
	| LiquidDocument;

export function createDefaultParserProviders(): readonly ParserProvider<SupportedDocument>[] {
	return [
		new LiquidParserProvider(),
		new HtmlParserProvider(),
		new JavaScriptParserProvider(),
		new JsonParserProvider(),
		new CssParserProvider(),
		new GraphqlParserProvider(),
	];
}
