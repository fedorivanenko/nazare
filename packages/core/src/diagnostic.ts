import type { Id } from "./id.js";
import type { SourceSpan } from "./source.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type Diagnostic = {
	severity: DiagnosticSeverity;
	code: string;
	message: string;
	nodeId?: Id;
	edgeId?: Id;
	span?: SourceSpan;
};

/** @deprecated Use {@link Diagnostic}. */
export type ValidationIssue = Diagnostic;
