/** Ranges are half-open UTF-16 offsets. Positions are one-based when supplied. */
export type SourceAnchor = {
	path: string;
	range: SourceRange;
	start?: SourcePosition;
	end?: SourcePosition;
	role?: "primary" | "supporting" | "derivation-input";
};

export type SourceRange = {
	start: number;
	end: number;
};

export type SourcePosition = {
	line: number;
	character: number;
};
