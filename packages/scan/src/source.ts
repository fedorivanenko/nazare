// Source positions, shared by every scanner in this package.
//
// Scanners use JavaScript string offsets (UTF-16 code units); line and column
// are derived on demand from one table per source.

export type Position = { line: number; column: number };

export type Span = {
	file: string;
	start: Position;
	end: Position;
};

/** UTF-16 code-unit offsets, before resolution to line and column. */
export type Range = { start: number; end: number };

/**
 * Line starts for one source. Building it is O(n) once; every lookup after is
 * a binary search, so a scanner that reports thousands of spans pays for the
 * scan of the file only once.
 */
export class LineIndex {
	private readonly starts: number[];
	private readonly sourceLength: number;

	constructor(source: string) {
		const starts = [0];
		for (let index = 0; index < source.length; index += 1) {
			if (source.charCodeAt(index) === 10) starts.push(index + 1);
		}
		this.starts = starts;
		this.sourceLength = source.length;
	}

	positionAt(offset: number): Position {
		if (!Number.isInteger(offset) || offset < 0 || offset > this.sourceLength) {
			throw new RangeError(
				`Source offset ${offset} is outside 0..${this.sourceLength}`,
			);
		}
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
		if (range.start > range.end) {
			throw new RangeError(
				`Source range start ${range.start} exceeds end ${range.end}`,
			);
		}
		return {
			file,
			start: this.positionAt(range.start),
			end: this.positionAt(range.end),
		};
	}
}
