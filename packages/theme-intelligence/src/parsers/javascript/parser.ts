import type { AnyNode, Options, Program } from "acorn";
import { parse } from "acorn";
import { fullAncestor } from "acorn-walk";
import type {
	ParsedDocument,
	ParserInput,
	ParserProvider,
	ParserResult,
} from "../parser.js";

export type JavaScriptNode = AnyNode & Record<string, unknown>;
export type JavaScriptDocument = ParsedDocument<Program>;

const JAVASCRIPT_MODULE_PARSE_OPTIONS: Options = {
	ecmaVersion: "latest",
	sourceType: "module",
	locations: true,
};

export class JavaScriptParserProvider
	implements ParserProvider<JavaScriptDocument>
{
	readonly id = "acorn";
	readonly version = 1;
	readonly languages = ["javascript"] as const;

	accepts(path: string, language?: string): boolean {
		return (
			language === "javascript" || (!language && /\.(?:c|m)?js$/.test(path))
		);
	}

	parse(input: ParserInput): ParserResult<JavaScriptDocument> {
		try {
			return {
				ok: true,
				document: {
					path: input.path,
					language: "javascript",
					source: input.source,
					syntax: parse(input.source, JAVASCRIPT_MODULE_PARSE_OPTIONS),
					diagnostics: [],
				},
			};
		} catch (error) {
			if (!isAcornParseError(error)) throw error;
			const range = normalizeParseRange(error, input.source.length);
			return {
				ok: false,
				diagnostics: [
					{
						code: "JAVASCRIPT_PARSE_ERROR",
						message: error.message,
						range,
					},
				],
			};
		}
	}
}

export function walkJavaScript(
	program: Program,
	visit: (
		node: JavaScriptNode,
		parent: JavaScriptNode | undefined,
		ancestors: JavaScriptNode[],
	) => void,
): void {
	fullAncestor(program, (node, _state, ancestors) => {
		visit(
			node as JavaScriptNode,
			ancestors.at(-2) as JavaScriptNode | undefined,
			ancestors as JavaScriptNode[],
		);
	});
}

function normalizeParseRange(
	error: Error & { pos: number; raisedAt: number },
	sourceLength: number,
): { start: number; end: number } {
	const reportedStart = Math.min(error.pos, sourceLength);
	const start =
		reportedStart === sourceLength && sourceLength > 0
			? reportedStart - 1
			: reportedStart;
	return {
		start,
		end: Math.min(
			sourceLength,
			Math.max(error.raisedAt, reportedStart, start + 1),
		),
	};
}

function isAcornParseError(
	error: unknown,
): error is Error & { pos: number; raisedAt: number } {
	return (
		error instanceof Error &&
		typeof (error as { pos?: unknown }).pos === "number" &&
		typeof (error as { raisedAt?: unknown }).raisedAt === "number"
	);
}
