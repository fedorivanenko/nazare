// Converts character offsets (what the Liquid parser reports) into
// line/column SourceSpans (what diagnostics and editors consume), and back.
//
// Conversions are hot — every span of every node goes through here — so the
// line-start table for a source text is computed once and reused while
// consecutive calls stay on the same text (which is how every pass calls it:
// many spans against one file). The cache holds only the last text seen; a
// different text recomputes. Results are unaffected by the cache.
import type { SourceSpan } from "@nazare/core";

type OffsetPosition = {
	start: number;
	end: number;
};

let cachedSource: string | undefined;
let cachedLineStarts: number[] | undefined;

function lineStartsOf(source: string): number[] {
	if (source === cachedSource && cachedLineStarts) return cachedLineStarts;
	const starts = [0];
	for (let index = 0; index < source.length; index += 1) {
		if (source[index] === "\n") starts.push(index + 1);
	}
	cachedSource = source;
	cachedLineStarts = starts;
	return starts;
}

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

export function offsetFromPosition(
	source: string,
	position: { line: number; column: number },
): number {
	const starts = lineStartsOf(source);
	if (position.line < 1) return 0;
	if (position.line > starts.length) return source.length;
	return Math.min(starts[position.line - 1] + position.column - 1, source.length);
}

export function lineColumnFromOffset(source: string, offset: number) {
	const starts = lineStartsOf(source);
	// Binary search: the greatest line start at or before the offset.
	let low = 0;
	let high = starts.length - 1;
	while (low < high) {
		const middle = (low + high + 1) >> 1;
		if (starts[middle] <= offset) low = middle;
		else high = middle - 1;
	}
	return { line: low + 1, column: offset - starts[low] + 1 };
}

/**
 * Maps an offset range inside an embedded body (a script or style block)
 * onto file coordinates, given the span the body occupies in the file.
 */
export function spanWithinBody(
	bodySource: string,
	bodySpan: SourceSpan | undefined,
	range: { start: number; end: number },
): SourceSpan | undefined {
	if (!bodySpan) return undefined;
	const { line: bodyLine, column: bodyColumn } = lineColumnFromOffset(
		bodySource,
		range.start,
	);
	const line = bodySpan.start.line + bodyLine - 1;
	const column =
		bodyLine === 1 ? bodySpan.start.column + bodyColumn - 1 : bodyColumn;
	return {
		file: bodySpan.file,
		start: { line, column },
		end: { line, column: column + (range.end - range.start) },
	};
}
