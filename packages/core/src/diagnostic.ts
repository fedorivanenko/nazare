// The one diagnostic shape shared by every compiler pass — parse errors,
// contract checks, and structural validation all emit this. Codes are plain
// strings; the compiler's diagnostics.ts catalogs the actual values.
import type { Id } from "./id.js";
import type { SourceSpan } from "./source.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type DiagnosticPhase =
	| "parse"
	| "resolve"
	| "check"
	| "validate"
	| "emit";

export type Diagnostic = {
	severity: DiagnosticSeverity;
	code: string;
	message: string;
	phase?: DiagnosticPhase;
	nodeId?: Id;
	edgeId?: Id;
	span?: SourceSpan;
};

/** @deprecated Use {@link Diagnostic}. */
export type ValidationIssue = Diagnostic;
