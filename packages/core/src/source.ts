// Positions in source files, line/column based (1-indexed), as consumed by
// diagnostics and editor tooling. Every node and diagnostic that can point
// at source carries an optional SourceSpan.
export type SourcePosition = {
	line: number;
	column: number;
};

export type SourceSpan = {
	file: string;
	start: SourcePosition;
	end: SourcePosition;
};
