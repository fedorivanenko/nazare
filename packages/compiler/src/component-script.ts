import type { ArtifactIR, Diagnostic } from "@nazare/core";
import type { Program } from "acorn";
import {
	scriptJavaScriptParseError,
	scriptTypeScriptUnsupported,
} from "./diagnostics.js";
import { parseJavaScript } from "./javascript-ast.js";
import { spanWithinBody } from "./source.js";

export type ComponentScriptNode = Extract<
	ArtifactIR["syntax"][number],
	{ kind: "script" }
>;

export type ParsedComponentScript =
	| { ok: true; program: Program }
	| { ok: false; issue: Diagnostic };

export function parseComponentScript(
	script: ComponentScriptNode,
): ParsedComponentScript {
	if (script.lang === "ts") {
		return {
			ok: false,
			issue: scriptTypeScriptUnsupported(script.bodySpan ?? script.span),
		};
	}
	const parsed = parseJavaScript(script.source);
	if (parsed.ok) return parsed;
	return {
		ok: false,
		issue: scriptJavaScriptParseError(
			parsed.error.message,
			spanWithinBody(script.source, script.bodySpan, parsed.error) ??
				script.bodySpan ??
				script.span,
		),
	};
}
