// Converts character offsets (what the Liquid parser reports) into
// line/column SourceSpans (what diagnostics and editors consume).
import type { SourceSpan } from "@nazare/core";

type OffsetPosition = {
	start: number;
	end: number;
};

export function spanFromOffsets(
	source: string,
	file: string,
	position: OffsetPosition,
): SourceSpan {
	return {
		file,
		start: lineColumnFromOffset(source, position.start),
		end: lineColumnFromOffset(source, position.end),
	};
}

export function lineColumnFromOffset(source: string, offset: number) {
	let line = 1;
	let column = 1;

	for (let index = 0; index < offset; index += 1) {
		if (source[index] === "\n") {
			line += 1;
			column = 1;
			continue;
		}

		column += 1;
	}

	return { line, column };
}
