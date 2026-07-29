import type { AnyNode, Options, Program } from "acorn";
import { parse } from "acorn";
import { fullAncestor } from "acorn-walk";

export type JavaScriptNode = AnyNode & Record<string, unknown>;

export type JavaScriptParseFailure = {
	message: string;
	start: number;
	end: number;
};

export type JavaScriptParseResult =
	| { ok: true; program: Program }
	| { ok: false; error: JavaScriptParseFailure };

const JAVASCRIPT_MODULE_PARSE_OPTIONS: Options = {
	ecmaVersion: "latest",
	sourceType: "module",
	locations: true,
};

export function parseJavaScript(source: string): JavaScriptParseResult {
	try {
		return {
			ok: true,
			program: parse(source, JAVASCRIPT_MODULE_PARSE_OPTIONS),
		};
	} catch (error) {
		if (!isAcornParseError(error)) throw error;
		return { ok: false, error: normalizeParseFailure(error, source.length) };
	}
}

export function walkJavaScript(
	program: Program,
	visit: (node: JavaScriptNode, parent: JavaScriptNode | undefined) => void,
): void {
	fullAncestor(program, (node, _state, ancestors) => {
		visit(
			node as JavaScriptNode,
			ancestors.at(-2) as JavaScriptNode | undefined,
		);
	});
}

function normalizeParseFailure(
	error: Error & { pos: number; raisedAt: number },
	sourceLength: number,
): JavaScriptParseFailure {
	const reportedStart = Math.min(error.pos, sourceLength);
	const start =
		reportedStart === sourceLength && sourceLength > 0
			? reportedStart - 1
			: reportedStart;
	return {
		message: error.message,
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
