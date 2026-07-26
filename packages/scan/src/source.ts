// Source positions, shared by every scanner in this package.
//
// Scanners work in byte offsets because that is what a single pass produces
// cheaply; line and column are derived on demand from one table per source.

export type Position = { line: number; column: number };

export type Span = {
	file: string;
	start: Position;
	end: Position;
};

/** Byte offsets, before they are resolved to line and column. */
export type Range = { start: number; end: number };

/**
 * Line starts for one source. Building it is O(n) once; every lookup after is
 * a binary search, so a scanner that reports thousands of spans pays for the
 * scan of the file only once.
 */
export class LineIndex {
	private readonly starts: number[];

	constructor(source: string) {
		const starts = [0];
		for (let index = 0; index < source.length; index += 1) {
			if (source.charCodeAt(index) === 10) starts.push(index + 1);
		}
		this.starts = starts;
	}

	positionAt(offset: number): Position {
		const starts = this.starts;
		let low = 0;
		let high = starts.length - 1;
		while (low < high) {
			const middle = (low + high + 1) >> 1;
			if ((starts[middle] as number) <= offset) low = middle;
			else high = middle - 1;
		}
		return { line: low + 1, column: offset - (starts[low] as number) + 1 };
	}

	spanAt(file: string, range: Range): Span {
		return {
			file,
			start: this.positionAt(range.start),
			end: this.positionAt(range.end),
		};
	}
}
