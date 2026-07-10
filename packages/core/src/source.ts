export type SourcePosition = {
	line: number;
	column: number;
};

export type SourceSpan = {
	file: string;
	start: SourcePosition;
	end: SourcePosition;
};
